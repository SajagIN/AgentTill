import express from "express";
import { config } from "./config.js";
import { ping } from "./db.js";
import { api } from "./routes.js";
import { webhookHandler } from "./webhooks.js";

const app = express();

// Webhook route must be registered BEFORE express.json() so that express.raw()
// captures the raw body bytes needed for HMAC signature verification.
app.post("/webhooks/razorpay", express.raw({ type: "application/json" }), webhookHandler);

app.use(express.json());
app.use(express.static('public')); // Serve static files for the dashboard UI


app.use("/", api);

app.get("/health", (_req, res) => {
  const row = ping();
  res.json({ ok: row.ok === 1, service: "agenttill", db: "agenttill.db (WAL)" });
});

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "no such route" } });
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
  return app.listen(config.port, () => {
    console.log(
      `agenttill ▸ listening on http://localhost:${config.port} · sqlite: agenttill.db (WAL on)`,
    );
  });
}

import { fileURLToPath } from "node:url";

// Auto-start only when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
