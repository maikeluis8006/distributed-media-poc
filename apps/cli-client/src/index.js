const readline = require("readline");
const { request } = require("undici");

function getEnvString(variableName, defaultValue) {
  const value = process.env[variableName];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return defaultValue;
}

async function httpJson(method, url, body) {
  const response = await request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.body.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { statusCode: response.statusCode, json };
}

async function getInventoryFromCoordinator(coordinatorBaseUrl) {
  const { statusCode, json } = await httpJson("POST", `${coordinatorBaseUrl}/command`, { action: "LIST_TARGETS" });
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`LIST_TARGETS failed: ${JSON.stringify(json)}`);
  }
  return json;
}

async function parseUtterance(llmAdapterBaseUrl, utterance, context) {
  const { statusCode, json } = await httpJson("POST", `${llmAdapterBaseUrl}/parse`, { utterance, context });
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`parse failed: ${JSON.stringify(json)}`);
  }
  return json.output;
}

async function executeCommand(coordinatorBaseUrl, command) {
  const { statusCode, json } = await httpJson("POST", `${coordinatorBaseUrl}/command`, command);
  return { statusCode, json };
}

async function start() {
  const coordinatorBaseUrl = getEnvString("COORDINATOR_BASE_URL", "http://localhost:8080").replace(/\/+$/, "");
  const llmAdapterBaseUrl = getEnvString("LLM_ADAPTER_BASE_URL", "http://localhost:8092").replace(/\/+$/, "");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const promptText = "> ";

  process.stdout.write("Distributed Media CLI (type 'exit' to quit)\n");
  process.stdout.write(promptText);

  rl.on("line", async (line) => {
    const utterance = String(line || "").trim();
    if (!utterance) {
      process.stdout.write(promptText);
      return;
    }

    if (utterance.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    try {
      const inventory = await getInventoryFromCoordinator(coordinatorBaseUrl);
      const parseOutput = await parseUtterance(llmAdapterBaseUrl, utterance, inventory);

      if (parseOutput.clarificationQuestion) {
        process.stdout.write(`${parseOutput.clarificationQuestion}\n`);
        process.stdout.write(promptText);
        return;
      }

      if (!parseOutput.command) {
        process.stdout.write("No command returned.\n");
        process.stdout.write(promptText);
        return;
      }

      const execution = await executeCommand(coordinatorBaseUrl, parseOutput.command);
      process.stdout.write(`${JSON.stringify({ command: parseOutput.command, coordinator: execution.json }, null, 2)}\n`);
      process.stdout.write(promptText);
    } catch (error) {
      process.stdout.write(`${error.message}\n`);
      process.stdout.write(promptText);
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

start().catch(() => process.exit(1));
