/**
 * SQLite via Bun's built-in driver (`bun:sqlite`) — no native deps (R1).
 * Single file `agenttill.db`, WAL mode for safe concurrent reads during the demo.
 *
 * Schema migrations land with the phase that needs each table:
 * Phase 1 (products, carts) → Phase 2 (missions, audit_events) → later phases
 * (approvals, webhook idempotency). Phase 0 ships an empty schema by design.
 */
import { Database } from "bun:sqlite";

const DB_PATH = "agenttill.db";

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

/**
 * Health probe used by GET /health — proves the DB file is open and queryable.
 * @returns {{ ok: number }} row from `SELECT 1`
 */
export function ping() {
  return db.query("SELECT 1 AS ok").get();
}
