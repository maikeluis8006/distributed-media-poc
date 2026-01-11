const path = require("path");
const fs = require("fs");
const Fastify = require("fastify");
const Ajv = require("ajv");

const app = Fastify({ logger: true });

function readJsonFile(jsonFilePath) {
  const fileContent = fs.readFileSync(jsonFilePath, "utf-8");
  return JSON.parse(fileContent);
}

function buildInventorySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["tvs", "audioZones", "bluetoothDevices"],
    properties: {
      tvs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          required: ["tvId", "displayName", "endpoint"],
          properties: {
            tvId: { type: "string", minLength: 1 },
            displayName: { type: "string", minLength: 1 },
            endpoint: { type: "string", minLength: 1 },
            playerType: { type: "string" }
          }
        }
      },
      audioZones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          required: ["audioZoneId", "displayName", "outputs", "endpoint"],
          properties: {
            audioZoneId: { type: "string", minLength: 1 },
            displayName: { type: "string", minLength: 1 },
            outputs: {
              type: "array",
              items: { type: "string", enum: ["wired", "bluetooth", "both"] },
              minItems: 1
            },
            endpoint: { type: "string", minLength: 1 }
          }
        }
      },
      bluetoothDevices: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          required: ["bluetoothDeviceId", "displayName", "macAddress", "pairedWithZoneId"],
          properties: {
            bluetoothDeviceId: { type: "string", minLength: 1 },
            displayName: { type: "string", minLength: 1 },
            macAddress: { type: "string", minLength: 1 },
            pairedWithZoneId: { type: "string", minLength: 1 }
          }
        }
      }
    }
  };
}

function buildCommandSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: [
          "PLAY",
          "STOP",
          "PAUSE",
          "RESUME",
          "SEEK",
          "SET_VOLUME",
          "MOVE_AUDIO",
          "SELECT_BLUETOOTH_DEVICE",
          "LIST_TARGETS"
        ]
      },
      sessionId: { type: "string" },
      contentRef: { type: "string" },
      targetTvId: { type: "string" },
      audioRoute: { type: "string", enum: ["tv", "zone"] },
      audioZoneId: { type: "string" },
      audioOutput: { type: "string", enum: ["wired", "bluetooth", "both"] },
      bluetoothDeviceId: { type: "string" },
      seekSeconds: { type: "number" },
      volumeLevel: { type: "number", minimum: 0, maximum: 100 }
    }
  };
}

function indexInventory(inventory) {
  const tvById = new Map(inventory.tvs.map((item) => [item.tvId, item]));
  const zoneById = new Map(inventory.audioZones.map((item) => [item.audioZoneId, item]));
  const bluetoothDeviceById = new Map(inventory.bluetoothDevices.map((item) => [item.bluetoothDeviceId, item]));
  return { tvById, zoneById, bluetoothDeviceById };
}

function generateSessionId() {
  const randomPart = Math.random().toString(16).slice(2);
  const timePart = Date.now().toString(16);
  return `sess_${timePart}_${randomPart}`;
}

const inMemorySessions = new Map();

function createSession(command) {
  const sessionId = generateSessionId();
  const session = {
    sessionId,
    contentRef: command.contentRef || null,
    targetTvId: command.targetTvId || null,
    audioRoute: command.audioRoute || "tv",
    audioZoneId: command.audioZoneId || null,
    audioOutput: command.audioOutput || null,
    state: "playing",
    createdAtEpochMs: Date.now(),
    updatedAtEpochMs: Date.now()
  };
  inMemorySessions.set(sessionId, session);
  return session;
}

function updateSession(sessionId, updateFields) {
  const existingSession = inMemorySessions.get(sessionId);
  if (!existingSession) return null;

  const updatedSession = {
    ...existingSession,
    ...updateFields,
    updatedAtEpochMs: Date.now()
  };

  inMemorySessions.set(sessionId, updatedSession);
  return updatedSession;
}

function validateTargetsOrThrow(command, inventoryIndex) {
  if (command.targetTvId && !inventoryIndex.tvById.has(command.targetTvId)) {
    const error = new Error(`Unknown targetTvId: ${command.targetTvId}`);
    error.statusCode = 400;
    throw error;
  }

  if (command.audioZoneId && !inventoryIndex.zoneById.has(command.audioZoneId)) {
    const error = new Error(`Unknown audioZoneId: ${command.audioZoneId}`);
    error.statusCode = 400;
    throw error;
  }

  if (command.bluetoothDeviceId && !inventoryIndex.bluetoothDeviceById.has(command.bluetoothDeviceId)) {
    const error = new Error(`Unknown bluetoothDeviceId: ${command.bluetoothDeviceId}`);
    error.statusCode = 400;
    throw error;
  }
}

async function start() {
  const inventoryPath = path.resolve(__dirname, "../../../deploy/inventory.json");
  const inventory = readJsonFile(inventoryPath);

  const ajv = new Ajv({ allErrors: true });

  const validateInventory = ajv.compile(buildInventorySchema());
  if (!validateInventory(inventory)) {
    app.log.error({ errors: validateInventory.errors }, "Invalid inventory.json");
    process.exit(1);
  }

  const inventoryIndex = indexInventory(inventory);
  const validateCommand = ajv.compile(buildCommandSchema());

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.post("/command", async (request, reply) => {
    const command = request.body;

    const isValidCommand = validateCommand(command);
    if (!isValidCommand) {
      return reply.code(400).send({ error: "Invalid command", details: validateCommand.errors });
    }

    validateTargetsOrThrow(command, inventoryIndex);

    if (command.action === "LIST_TARGETS") {
      return {
        tvs: inventory.tvs,
        audioZones: inventory.audioZones,
        bluetoothDevices: inventory.bluetoothDevices
      };
    }

    if (command.action === "PLAY") {
      if (!command.targetTvId || !command.contentRef) {
        return reply.code(400).send({ error: "targetTvId and contentRef are required for PLAY" });
      }

      const tv = inventoryIndex.tvById.get(command.targetTvId);

      const session = createSession(command);

      const { request } = await import("undici");

      await request(`${tv.endpoint}/play`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          contentRef: session.contentRef
        })
      });

      return { accepted: true, session };
    }

    if (command.action === "STOP") {
      const resolvedSessionId = command.sessionId;
      if (!resolvedSessionId) return reply.code(400).send({ error: "sessionId is required for STOP" });

      const updatedSession = updateSession(resolvedSessionId, { state: "stopped" });
      if (!updatedSession) return reply.code(404).send({ error: "Session not found" });

      return { accepted: true, session: updatedSession };
    }

    if (command.action === "PAUSE") {
      const resolvedSessionId = command.sessionId;
      if (!resolvedSessionId) return reply.code(400).send({ error: "sessionId is required for PAUSE" });

      const updatedSession = updateSession(resolvedSessionId, { state: "paused" });
      if (!updatedSession) return reply.code(404).send({ error: "Session not found" });

      return { accepted: true, session: updatedSession };
    }

    if (command.action === "RESUME") {
      const resolvedSessionId = command.sessionId;
      if (!resolvedSessionId) return reply.code(400).send({ error: "sessionId is required for RESUME" });

      const updatedSession = updateSession(resolvedSessionId, { state: "playing" });
      if (!updatedSession) return reply.code(404).send({ error: "Session not found" });

      return { accepted: true, session: updatedSession };
    }

    if (command.action === "MOVE_AUDIO") {
      if (!command.sessionId || !command.audioZoneId) {
        return reply.code(400).send({ error: "sessionId and audioZoneId are required for MOVE_AUDIO" });
      }

      const zone = inventoryIndex.zoneById.get(command.audioZoneId);

      const { request } = await import("undici");

      await request(`${zone.endpoint}/attach-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: command.sessionId,
          audioOutput: command.audioOutput || "wired"
        })
      });

      const updatedSession = updateSession(command.sessionId, {
        audioRoute: "zone",
        audioZoneId: command.audioZoneId,
        audioOutput: command.audioOutput || "wired"
      });

      if (!updatedSession) {
        return reply.code(404).send({ error: "Session not found" });
      }

      return { accepted: true, session: updatedSession };
    }

    if (command.action === "SELECT_BLUETOOTH_DEVICE") {
      if (!command.audioZoneId || !command.bluetoothDeviceId) {
        return reply.code(400).send({ error: "audioZoneId and bluetoothDeviceId are required" });
      }

      const bluetoothDevice = inventoryIndex.bluetoothDeviceById.get(command.bluetoothDeviceId);
      if (bluetoothDevice.pairedWithZoneId !== command.audioZoneId) {
        return reply.code(400).send({ error: "Bluetooth device is not paired with the requested zone" });
      }

      return { accepted: true, selected: { audioZoneId: command.audioZoneId, bluetoothDeviceId: command.bluetoothDeviceId } };
    }

    if (command.action === "SEEK") {
      const resolvedSessionId = command.sessionId;
      if (!resolvedSessionId) return reply.code(400).send({ error: "sessionId is required for SEEK" });
      if (typeof command.seekSeconds !== "number") return reply.code(400).send({ error: "seekSeconds is required for SEEK" });

      const updatedSession = updateSession(resolvedSessionId, { lastSeekSeconds: command.seekSeconds });
      if (!updatedSession) return reply.code(404).send({ error: "Session not found" });

      return { accepted: true, session: updatedSession };
    }

    if (command.action === "SET_VOLUME") {
      if (!command.audioZoneId || typeof command.volumeLevel !== "number") {
        return reply.code(400).send({ error: "audioZoneId and volumeLevel are required for SET_VOLUME" });
      }

      const zone = inventoryIndex.zoneById.get(command.audioZoneId);

      const { request } = await import("undici");

      await request(`${zone.endpoint}/set-volume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          volumeLevel: command.volumeLevel
        })
      });

      return { accepted: true };
    }

    return reply.code(400).send({ error: "Unsupported command action" });
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    request.log.error({ error }, "Request error");
    reply.code(statusCode).send({ error: error.message });
  });

  const port = Number(process.env.PORT || "8080");
  await app.listen({ port, host: "0.0.0.0" });
}

start().catch((error) => {
  app.log.error({ error }, "Coordinator failed to start");
  process.exit(1);
});
