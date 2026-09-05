import path from "path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createMcpServer } from "./mcp-server.js";
import { seedCatalog } from "./catalog.js";

import { config } from "./config.js";
import { ping } from "./db.js";
import { api } from "./routes.js";
import { webhookHandler } from "./webhooks.js";

const app = express();

// Webhook route must be registered BEFORE express.json() so that express.raw()
// captures the raw body bytes needed for HMAC signature verification.
app.post("/webhooks/razorpay", express.raw({ type: "application/json" }), webhookHandler);

app.use(cors());
app.use(express.json());


app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

class MemoryTransport {
  constructor(reqMessage) {
    this.reqMessage = reqMessage;
  }
  async start() {}
  async close() {}
  async send(message) {
    this.resolveResponse(message);
  }
  execute() {
    return new Promise((resolve) => {
      this.resolveResponse = resolve;
      if (this.onmessage) this.onmessage(this.reqMessage);
    });
  }
}

app.get("/mcp", (req, res) => {
  res.json({
    protocol: "Model Context Protocol / JSON-RPC 2.0",
    protocolVersion: "2024-11-05",
    serverInfo: { name: "agenttill-mcp", version: "1.0.0" },
    endpoint: "/mcp",
  });
});

app.post("/mcp", async (req, res) => {
  try {
    const body = req.body;
    if (!body) return res.status(400).json({ error: "missing body" });

    const server = createMcpServer();

    // Handle array batch requests
    if (Array.isArray(body)) {
      const responses = [];
      for (const msg of body) {
        if (msg.method === 'notifications/initialized') continue;
        const transport = new MemoryTransport(msg);
        await server.connect(transport);
        responses.push(await transport.execute());
      }
      return res.json(responses);
    }

    // Handle single request
    if (body.method === 'notifications/initialized') {
      return res.status(204).end();
    }
    const transport = new MemoryTransport(body);
    await server.connect(transport);
    const response = await transport.execute();
    res.json(response);

  } catch (err) {
    console.error("MCP message error:", err);
    res.status(500).send("Error handling message");
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "../frontend/dist"))); // Serve static files for the React SPA


app.use("/api", api);

app.get("/health", (_req, res) => {
  const row = ping();
  res.json({ ok: row.ok === 1, service: "agenttill", db: "agenttill.db (WAL)" });
});

app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "no such route" } });
  }
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, "../frontend/dist/index.html"));
  } else {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "no such route" } });
  }
});

// Error middleware: typed errors (with err.status/err.code) pass their message through;
// unknown errors are logged server-side and never leaked to the client.
app.use((err, _req, res, _next) => {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const typed = typeof err?.code === "string";
  if (!typed) console.error(`[error] ${err?.stack ?? err}`);
  res.status(status).json({
    error: {
      code: err?.code ?? "INTERNAL_ERROR",
      message: typed ? err.message : "internal error — see server logs",
    },
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] agenttill exiting:", err);
  process.exit(1);
});

export function startServer() {
  seedCatalog();
  return app.listen(config.port, () => {
    console.log(
      `agenttill ▸ listening on http://localhost:${config.port} · sqlite: agenttill.db (WAL on)`,
    );
  });
}


// Auto-start only when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
