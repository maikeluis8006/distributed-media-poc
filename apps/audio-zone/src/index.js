const Fastify = require("fastify");

const app = Fastify({ logger: true });

const inMemoryState = {
  activeSessionId: null,
  audioOutput: "wired",
  volumeLevel: 50,
  muted: false,
  bluetoothDeviceId: null
};

app.get("/health", async () => {
  return { status: "ok" };
});

app.get("/state", async () => {
  return { ...inMemoryState };
});

app.post("/attach-session", async (request) => {
  const { sessionId, audioOutput } = request.body || {};

  if (!sessionId) {
    return { accepted: false, error: "sessionId is required" };
  }

  inMemoryState.activeSessionId = sessionId;
  inMemoryState.audioOutput = audioOutput || "wired";
  inMemoryState.bluetoothDeviceId = null;

  return { accepted: true, state: { ...inMemoryState } };
});

app.post("/set-mute", async (request) => {
  const { muted } = request.body || {};
  if (typeof muted !== "boolean") {
    return { accepted: false, error: "muted must be a boolean" };
  }

  inMemoryState.muted = muted;
  return { accepted: true, state: { ...inMemoryState } };
});

app.post("/detach-session", async (request) => {
  const { sessionId } = request.body || {};
  if (!sessionId) return { accepted: false, error: "sessionId is required" };

  if (inMemoryState.activeSessionId !== sessionId) {
    return { accepted: false, error: "sessionId does not match active session" };
  }

  inMemoryState.activeSessionId = null;
  inMemoryState.bluetoothDeviceId = null;

  return { accepted: true, state: { ...inMemoryState } };
});

app.post("/set-volume", async (request) => {
  const { volumeLevel } = request.body || {};
  if (typeof volumeLevel !== "number") {
    return { accepted: false, error: "volumeLevel must be a number" };
  }

  if (volumeLevel < 0 || volumeLevel > 100) {
    return { accepted: false, error: "volumeLevel out of range" };
  }

  inMemoryState.volumeLevel = volumeLevel;
  return { accepted: true, state: { ...inMemoryState } };
});

app.post("/select-bluetooth-device", async (request) => {
  const { bluetoothDeviceId } = request.body || {};
  if (!bluetoothDeviceId) {
    return { accepted: false, error: "bluetoothDeviceId is required" };
  }

  inMemoryState.audioOutput = "bluetooth";
  inMemoryState.bluetoothDeviceId = bluetoothDeviceId;

  return { accepted: true, state: { ...inMemoryState } };
});

const port = Number(process.env.PORT || "8091");
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error({ error }, "audio-zone failed to start");
  process.exit(1);
});
