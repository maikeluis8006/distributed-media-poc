require("dotenv").config();

const Fastify = require("fastify");
const { request } = require("undici");

const app = Fastify({ logger: true });

function buildParseResult(command, clarificationQuestion) {
  return {
    command: command || null,
    clarificationQuestion: clarificationQuestion || null
  };
}

function getEnvString(variableName, defaultValue) {
  const value = process.env[variableName];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return defaultValue;
}

function getEnvBoolean(variableName, defaultValue) {
  const rawValue = process.env[variableName];
  if (typeof rawValue !== "string") return defaultValue;
  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parseRuleBased(utteranceText) {
  const normalizedText = String(utteranceText || "").trim().toLowerCase();

  if (!normalizedText) {
    return buildParseResult(null, "¿Qué quieres reproducir y en qué TV?");
  }

  if (normalizedText.includes("lista") && (normalizedText.includes("tv") || normalizedText.includes("tvs"))) {
    return buildParseResult({ action: "LIST_TARGETS" }, null);
  }

  if (normalizedText.includes("pon") || normalizedText.includes("play")) {
    return buildParseResult(
      {
        action: "PLAY",
        targetTvId: "tv_living_room",
        contentRef: "demo-video",
        audioRoute: "tv"
      },
      null
    );
  }

  if (normalizedText.includes("volumen")) {
    const numberMatch = normalizedText.match(/(\d{1,3})/);
    const volumeLevel = numberMatch ? Number(numberMatch[1]) : null;

    if (typeof volumeLevel !== "number" || Number.isNaN(volumeLevel)) {
      return buildParseResult(null, "¿Qué volumen (0 a 100) y en qué zona?");
    }

    return buildParseResult(
      {
        action: "SET_VOLUME",
        audioZoneId: "zone_living_room",
        volumeLevel
      },
      null
    );
  }

  return buildParseResult(null, "No entendí el comando. ¿Quieres reproducir o cambiar volumen?");
}

function removeNullAndUndefinedProperties(objectValue) {
  return Object.fromEntries(
    Object.entries(objectValue).filter(
      ([, value]) => value !== null && value !== undefined
    )
  );
}

async function parseWithTabbyApi(utterance, context) {
  const tabbyBaseUrl = getEnvString("TABBY_BASE_URL", "");
  const tabbyApiKey = getEnvString("TABBY_API_KEY", "");
  const tabbyModel = getEnvString("TABBY_MODEL", "");

  if (!tabbyBaseUrl || !tabbyModel) {
    return buildParseResult(null, "TabbyAPI no está configurado. Define TABBY_BASE_URL y TABBY_MODEL.");
  }

    const systemInstruction = [
    "You are a strict JSON command generator for a distributed media controller.",
    "Return ONLY valid JSON. No markdown. No explanations. No extra text.",
    "",
    "Output schema:",
    "{",
    '  "command": object | null,',
    '  "clarificationQuestion": string | null',
    "}",
    "",
    "Important rules:",
    "1) The command object MUST contain only these allowed properties (no others):",
    "   action, sessionId, contentRef, targetTvId, audioRoute, audioZoneId, audioOutput, bluetoothDeviceId, seekSeconds, volumeLevel, volumeDelta",
    "2) Use contentRef (NOT media, NOT content, NOT title).",
    "3) If a required field is missing, set command to null and set clarificationQuestion.",
    "",
    "Valid action values:",
    "PLAY, STOP, PAUSE, RESUME, SEEK, SET_VOLUME, MOVE_AUDIO, SELECT_BLUETOOTH_DEVICE, LIST_TARGETS, MUTE, UNMUTE",
    "",
    "Canonical ids to use if the user refers to them by name:",
    'TV Sala -> targetTvId: "tv_living_room"',
    'mute -> {"action":"MUTE","audioZoneId":"zone_living_room"}',
    'unmute -> {"action":"UNMUTE","audioZoneId":"zone_living_room"}',
    'Sala (audio zone) -> audioZoneId: "zone_living_room"',
    "",
    "PLAY requires: action, targetTvId, contentRef.",
    "LIST_TARGETS requires: action only."
    ].join("\n");


  const userText = [
    `utterance: ${String(utterance || "")}`,
    `context: ${JSON.stringify(context || {})}`
  ].join("\n");

  const endpointUrl = `${tabbyBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  const headers = { "content-type": "application/json" };
  if (tabbyApiKey) headers["authorization"] = `Bearer ${tabbyApiKey}`;

  const response = await request(endpointUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: tabbyModel,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userText }
      ],
      temperature: 0
    })
  });

  const responseBody = await response.body.text();

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(responseBody);
  } catch {
    return buildParseResult(null, "TabbyAPI respondió algo no-JSON. Revisa configuración.");
  }

  const content = parsedResponse?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return buildParseResult(null, "TabbyAPI no devolvió contenido parseable.");
  }

  try {
    const parsedContent = JSON.parse(content);

    const sanitizedCommand = parsedContent.command
      ? removeNullAndUndefinedProperties(parsedContent.command)
      : null;

    return buildParseResult(sanitizedCommand, parsedContent.clarificationQuestion || null);
  } catch {
    return buildParseResult(null, "TabbyAPI devolvió contenido que no es JSON válido.");
  }
}

async function parseUtterance(utterance, context) {
  const useTabby = getEnvBoolean("USE_TABBY", false);
  if (!useTabby) return parseRuleBased(utterance);
  return parseWithTabbyApi(utterance, context);
}

app.get("/health", async () => ({ status: "ok" }));

app.post("/parse", async (request) => {
  const { utterance, context } = request.body || {};
  const parseResult = await parseUtterance(utterance, context);

  return {
    input: { utterance: utterance || "", context: context || {} },
    output: parseResult
  };
});

const port = Number(process.env.PORT || "8092");
app.listen({ port, host: "0.0.0.0" }).catch(() => process.exit(1));
