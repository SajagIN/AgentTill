/**
 * Express app — Phase 0 skeleton (health route only; Phases.md forbids more).
 *
 * ORDERING LAW (Architecture §8): when the webhook route arrives in Phase 3 it
 * MUST be registered BEFORE express.json() so the raw body bytes survive for
 * HMAC verification. The placeholder comment below marks that exact spot.
 */
import express from "express";
import { config } from "./config.js";
import { ping } from "./db.js";

const app = express();

// [Phase 3] app.post("/webhooks/razorpay", express.raw({ type: "application/json" }), …)
//           goes HERE — above express.json(), never below it.
app.use(express.json());

app.get("/health", (_req, res) => {
  const row = ping();
  res.json({ ok: row.ok === 1, service: "agenttill", db: "agenttill.db (WAL)" });
});

// Unknown route — consistent error shape from day one (R4).
app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "no such route" } });
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
