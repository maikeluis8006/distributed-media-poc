const Fastify = require("fastify");

const app = Fastify({ logger: true });

const inMemoryState = {
  activeSessionId: null,
  currentContentRef: null,
  state: "idle",
  lastSeekSeconds: null
};

app.get("/health", async () => {
  return { status: "ok" };
});

app.get("/state", async () => {
  return { ...inMemoryState };
});

app.post("/play", async (request) => {
  const { sessionId, contentRef } = request.body || {};

  if (!sessionId || !contentRef) {
    return { accepted: false, error: "sessionId and contentRef are required" };
  }

  inMemoryState.activeSessionId = sessionId;
  inMemoryState.currentContentRef = contentRef;
  inMemoryState.state = "playing";
  inMemoryState.lastSeekSeconds = null;

  return { accepted: true, state: { ...inMemoryState } };
});

app.post("/pause", async (request) => {
  const { sessionId } = request.body || {};
  if (!sessionId) return { accepted: false, error: "sessionId is required" };

  if (inMemoryState.activeSessionId !== sessionId) {
    return { accepted: false, error: "sessionId does not match active session" };
  }

  inMemoryState.state = "paused";
  return { accepted: true, state: { ...inMemoryState } };
});

app.post("/resume", async (request) => {
  const { sessionId } = request.body || {};
  if (!sessionId) return { accepted: false, error: "sessionId is required" };

  if (inMemoryState.activeSessionId !== sessionId) {
    return { accepted: false, error: "sessionId does not match active session" };
  }

  inMemoryState.state = "playing";
  return { accepted: true, state: { ...inMemoryState } };
});

app.post("/seek", async (request) => {
  const { sessionId, seekSeconds } = request.body || {};
  if (!sessionId) return { accepted: false, error: "sessionId is required" };
  if (typeof seekSeconds !== "number") return { accepted: false, error: "seekSeconds must be a number" };

  if (inMemoryState.activeSessionId !== sessionId) {
    return { accepted: false, error: "sessionId does not match active session" };
  }

  inMemoryState.lastSeekSeconds = seekSeconds;
  return { accepted: true, state: { ...inMemoryState } };
});

app.post("/stop", async (request) => {
  const { sessionId } = request.body || {};
  if (!sessionId) return { accepted: false, error: "sessionId is required" };

  if (inMemoryState.activeSessionId !== sessionId) {
    return { accepted: false, error: "sessionId does not match active session" };
  }

  inMemoryState.activeSessionId = null;
  inMemoryState.currentContentRef = null;
  inMemoryState.state = "idle";
  inMemoryState.lastSeekSeconds = null;

  return { accepted: true, state: { ...inMemoryState } };
});

const port = Number(process.env.PORT || "8090");
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error({ error }, "tv-player failed to start");
  process.exit(1);
});
