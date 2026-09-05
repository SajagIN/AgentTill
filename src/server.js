import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import cors from "cors";

import { config } from "./config.js";
import { api } from "./routes.js";
import { ping, findOrder } from "./db.js";
import { seedCatalog } from "./catalog.js";
import { webhookHandler } from "./webhooks.js";
import { handleMcpRequest } from "./mcp-http.js";
import { renderCheckoutPage } from "./checkout-page.js";
import { AppError, NotFoundError } from "./errors.js";
import { setAgentApiBase } from "./agent/tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "../frontend/dist");

export const app = express();

// The webhook route must be registered before express.json(): express.raw()
// captures the exact bytes the HMAC signature was computed over.
app.post("/webhooks/razorpay", express.raw({ type: "application/json" }), webhookHandler);

app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${req.method}] ${req.originalUrl}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: ping().ok === 1, service: "agenttill", db: "agenttill.db (WAL)" });
});

/* ── Model Context Protocol ───────────────────────────────────────────────── */

app.get("/mcp", (_req, res) => {
  res.json({
    protocol: "Model Context Protocol / JSON-RPC 2.0",
    protocolVersion: "2024-11-05",
    serverInfo: { name: "agenttill-mcp", version: "1.0.0" },
    endpoint: "/mcp",
  });
});

app.post("/mcp", async (req, res, next) => {
  try {
    const { status, body } = await handleMcpRequest(req.body);
    if (status === 204) return res.status(204).end();
    res.status(status).json(body);
  } catch (err) {
    next(err);
  }
});

/* ── Customer-facing checkout fallback ────────────────────────────────────── */

app.get("/pay/:orderId", (req, res, next) => {
  const order = findOrder(req.params.orderId);
  if (!order) return next(new NotFoundError(`no order with id ${req.params.orderId}`));
  res.type("html").send(renderCheckoutPage({ order, razorpayKeyId: config.razorpayKeyId }));
});

/* ── API ──────────────────────────────────────────────────────────────────── */

app.use("/api", api);

/* ── React SPA ────────────────────────────────────────────────────────────── */

const distExists = fs.existsSync(path.join(DIST_DIR, "index.html"));
if (distExists) {
  app.use(express.static(DIST_DIR));
  // Any non-API GET falls through to the SPA so client-side routes deep-link.
  app.get(/^(?!\/(api|pay|webhooks|mcp|health)\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.status(503).json({
      error: {
        code: "FRONTEND_NOT_BUILT",
        message: "the React dashboard has not been built — run `bun run build` from the repository root",
      },
    });
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "no such route" } });
});

/* ── Errors ───────────────────────────────────────────────────────────────── */

// AppError messages are safe to return; anything else is a bug and is logged
// server-side only, so internals never leak to a client.
app.use((err, _req, res, _next) => {
  const typed = err instanceof AppError || Number.isInteger(err?.status);
  if (!typed) console.error(`[error] ${err?.stack ?? err}`);

  const status = Number.isInteger(err?.status) ? err.status : 500;
  res.status(status).json({
    error: {
      code: err?.code ?? "INTERNAL_ERROR",
      message: typed ? err.message : "internal error — see server logs",
      ...(err?.ruleEvals ? { ruleEvals: err.ruleEvals } : {}),
      ...(err?.issues ? { issues: err.issues } : {}),
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
  const server = app.listen(config.port, "0.0.0.0", () => {
    const { port } = server.address();
    setAgentApiBase(`http://127.0.0.1:${port}`);
    console.log(`agenttill ▸ http://localhost:${port} · sqlite: agenttill.db (WAL on)`);
    if (!distExists) {
      console.log("agenttill ▸ dashboard not built — run `bun run build` to serve the UI");
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}
