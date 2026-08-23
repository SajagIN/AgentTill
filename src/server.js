/**
 * Express app — Phase 2: health + catalog/quote + checkout/missions,
 * error middleware mapping typed errors (R4).
 *
 * ORDERING LAW (Architecture §8): when the webhook route arrives in Phase 3 it
 * MUST be registered BEFORE express.json() so the raw body bytes survive for
 * HMAC verification. The placeholder comment below marks that exact spot.
 */
import express from "express";
import { config } from "./config.js";
import { ping } from "./db.js";
import { api } from "./routes.js";
import { webhookHandler } from "./webhooks.js";

const app = express();

// WEBHOOK ROUTE FIRST — express.raw() must own the body BEFORE the JSON
// parser so HMAC is computed over the exact received bytes (Architecture §8).
// Registering this below express.json() is the #1 known failure mode.
app.post("/webhooks/razorpay", express.raw({ type: "application/json" }), webhookHandler);

app.use(express.json());

app.use("/", api); // /catalog, /quote, /checkout, /missions — thin routers (routes.js)

app.get("/health", (_req, res) => {
  const row = ping();
  res.json({ ok: row.ok === 1, service: "agenttill", db: "agenttill.db (WAL)" });
});

// Unknown route — consistent error shape (R4).
app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "no such route" } });
});

// Error middleware — duck-types on err.status/err.code (typed classes carry
// both). Typed errors pass their safe, context-rich message through; unknown
// errors are logged with stack server-side and never leaked to the client.
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

app.listen(config.port, () => {
  console.log(
    `agenttill ▸ listening on http://localhost:${config.port} · sqlite: agenttill.db (WAL on)`,
  );
});
