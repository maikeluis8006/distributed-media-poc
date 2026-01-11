require("dotenv").config();

const Fastify = require("fastify");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const app = Fastify({ logger: true });

function getEnvString(variableName, defaultValue) {
  const value = process.env[variableName];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return defaultValue;
}

function createTempFilePath(extension) {
  const randomPart = Math.random().toString(16).slice(2);
  const timePart = Date.now().toString(16);
  return path.join(os.tmpdir(), `stt_${timePart}_${randomPart}${extension}`);
}

function decodeBase64ToBuffer(base64Value) {
  const normalizedBase64 = String(base64Value || "").trim();
  return Buffer.from(normalizedBase64, "base64");
}

function runWhisperCli({ whisperBinaryPath, whisperModelPath, inputWavPath, outputTextPath, languageCode }) {
  return new Promise((resolve, reject) => {
    const args = [
       "-t", String(Number(process.env.WHISPER_THREADS || "20")),
      "-m", whisperModelPath,
      "-f", inputWavPath,
      "-otxt",
      "-of", outputTextPath.replace(/\.txt$/, "")
    ];

    if (languageCode) {
      args.push("-l", languageCode);
    }

    const childProcess = spawn(whisperBinaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdoutText = "";
    let stderrText = "";

    childProcess.stdout.on("data", (chunk) => {
      stdoutText += chunk.toString("utf-8");
    });

    childProcess.stderr.on("data", (chunk) => {
      stderrText += chunk.toString("utf-8");
    });

    childProcess.on("error", (error) => {
      reject(new Error(`Failed to start whisper.cpp binary: ${error.message}`));
    });

    childProcess.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`whisper.cpp exited with code ${exitCode}. stderr: ${stderrText || "n/a"}`));
        return;
      }
      resolve({ stdoutText, stderrText });
    });
  });
}

function readTextFileIfExists(textFilePath) {
  if (!fs.existsSync(textFilePath)) return "";
  return fs.readFileSync(textFilePath, "utf-8");
}

app.get("/health", async () => {
  return { status: "ok" };
});

app.post("/transcribe", async (request, reply) => {
  const { audioWavBase64, languageCode } = request.body || {};

  if (!audioWavBase64) {
    return reply.code(400).send({ error: "audioWavBase64 is required" });
  }

  const whisperBinaryPath = getEnvString("WHISPER_BINARY_PATH", "");
  const whisperModelPath = getEnvString("WHISPER_MODEL_PATH", "");

  if (!whisperBinaryPath || !whisperModelPath) {
    return reply.code(500).send({ error: "WHISPER_BINARY_PATH and WHISPER_MODEL_PATH must be set" });
  }

  const inputWavPath = createTempFilePath(".wav");
  const outputTextPath = createTempFilePath(".txt");

  try {
    const wavBuffer = decodeBase64ToBuffer(audioWavBase64);
    if (!wavBuffer || wavBuffer.length === 0) {
      return reply.code(400).send({ error: "Invalid audioWavBase64" });
    }

    fs.writeFileSync(inputWavPath, wavBuffer);

    await runWhisperCli({
      whisperBinaryPath,
      whisperModelPath,
      inputWavPath,
      outputTextPath,
      languageCode: languageCode || null
    });

    const transcriptionText = readTextFileIfExists(outputTextPath).trim();

    return {
      accepted: true,
      transcriptionText
    };
  } catch (error) {
    return reply.code(502).send({ error: error.message });
  } finally {
    try { if (fs.existsSync(inputWavPath)) fs.unlinkSync(inputWavPath); } catch {}
    try { if (fs.existsSync(outputTextPath)) fs.unlinkSync(outputTextPath); } catch {}
  }
});

const port = Number(process.env.PORT || "8093");
app.listen({ port, host: "0.0.0.0" }).catch(() => process.exit(1));
