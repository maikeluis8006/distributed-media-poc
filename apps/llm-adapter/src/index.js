const Fastify = require("fastify");

const app = Fastify({ logger: true });

function normalizeText(rawText) {
  return String(rawText || "").trim().toLowerCase();
}

function buildParseResult(command, clarificationQuestion) {
  return {
    command: command || null,
    clarificationQuestion: clarificationQuestion || null
  };
}

function parseRuleBased(utteranceText) {
  const normalizedText = normalizeText(utteranceText);

  if (!normalizedText) {
    return buildParseResult(null, "¿Qué quieres reproducir y en qué TV?");
  }

  if (normalizedText.includes("lista") && normalizedText.includes("tv")) {
    return buildParseResult({ action: "LIST_TARGETS" }, null);
  }

  if (normalizedText.startsWith("para") || normalizedText.includes("stop")) {
    return buildParseResult({ action: "STOP" }, "¿Qué sesión quieres detener? Dame el sessionId.");
  }

  if (normalizedText.includes("pausa") || normalizedText.includes("pause")) {
    return buildParseResult({ action: "PAUSE" }, "¿Qué sesión quieres pausar? Dame el sessionId.");
  }

  if (normalizedText.includes("continua") || normalizedText.includes("resume")) {
    return buildParseResult({ action: "RESUME" }, "¿Qué sesión quieres continuar? Dame el sessionId.");
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

  if (normalizedText.includes("mueve el audio") || normalizedText.includes("move audio")) {
    return buildParseResult(
      {
        action: "MOVE_AUDIO",
        sessionId: null,
        audioZoneId: "zone_living_room",
        audioOutput: "wired"
      },
      "Necesito el sessionId para mover el audio."
    );
  }

  if (normalizedText.includes("bluetooth")) {
    return buildParseResult(
      {
        action: "MOVE_AUDIO",
        sessionId: null,
        audioZoneId: "zone_living_room",
        audioOutput: "bluetooth"
      },
      "Necesito el sessionId para mover el audio por Bluetooth."
    );
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

  return buildParseResult(null, "No entendí el comando. ¿Quieres reproducir, pausar, parar, mover audio o cambiar volumen?");
}

app.get("/health", async () => {
  return { status: "ok" };
});

app.post("/parse", async (request) => {
  const { utterance, context } = request.body || {};
  const parseResult = parseRuleBased(utterance);

  return {
    input: {
      utterance: utterance || "",
      context: context || {}
    },
    output: parseResult
  };
});

const port = Number(process.env.PORT || "8092");
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error({ error }, "llm-adapter failed to start");
  process.exit(1);
});
