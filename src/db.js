/**
 * SQLite via Bun's built-in driver (`bun:sqlite`) — no native deps (R1).
 * Single file `agenttill.db`, WAL mode. All SQL lives HERE (or in audit.js)
 * as prepared statements — never concatenated with user input (R5).
 *
 * Schema history (append-only — later phases ADD tables, never mutate old ones):
 *   Phase 1 — products, carts
 *   Phase 2 — missions, orders, audit_events
 */
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

const DB_PATH = "agenttill.db";

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    sku         TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    price_paise INTEGER NOT NULL,
    stock       INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS carts (
    id          TEXT PRIMARY KEY,
    items_json  TEXT NOT NULL,
    total_paise INTEGER NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_carts_created ON carts (created_at);

  CREATE TABLE IF NOT EXISTS missions (
    id           TEXT PRIMARY KEY,
    intent       TEXT NOT NULL,
    budget_paise INTEGER,
    state        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_missions_created ON missions (created_at);

  CREATE TABLE IF NOT EXISTS orders (
    order_id         TEXT PRIMARY KEY,
    mission_id       TEXT NOT NULL,
    cart_id          TEXT NOT NULL,
    amount_paise     INTEGER NOT NULL,
    payment_link_id  TEXT,
    payment_link_url TEXT,
    status           TEXT NOT NULL DEFAULT 'created',
    created_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_mission ON orders (mission_id);

  CREATE TABLE IF NOT EXISTS audit_events (
    id               TEXT PRIMARY KEY,
    ts               TEXT NOT NULL,
    correlation_id   TEXT NOT NULL,
    parent_event_id  TEXT,
    actor            TEXT NOT NULL,
    action           TEXT NOT NULL,
    amount_paise     INTEGER,
    decision         TEXT,
    entities         TEXT,
    outcome          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events (correlation_id);
  CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events (ts);
`);

// ── Prepared statements: catalog ───────────────────────────────────────────
const allProductsStmt = db.query(
  "SELECT sku, name, category, price_paise, stock FROM products ORDER BY category, sku",
);
const getProductStmt = db.query(
  "SELECT sku, name, category, price_paise, stock FROM products WHERE sku = ?",
);
const insertProductStmt = db.query(
  "INSERT INTO products (sku, name, category, price_paise, stock) VALUES (?, ?, ?, ?, ?)",
);
const clearProductsStmt = db.query("DELETE FROM products");

// ── Prepared statements: carts ─────────────────────────────────────────────
const insertCartStmt = db.query(
  "INSERT INTO carts (id, items_json, total_paise, created_at) VALUES (?, ?, ?, ?)",
);
const getCartStmt = db.query(
  "SELECT id, items_json, total_paise, created_at FROM carts WHERE id = ?",
);
const clearCartsStmt = db.query("DELETE FROM carts");

// ── Prepared statements: missions ──────────────────────────────────────────
const insertMissionStmt = db.query(
  "INSERT INTO missions (id, intent, budget_paise, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const getMissionStmt = db.query(
  "SELECT id, intent, budget_paise, state, created_at, updated_at FROM missions WHERE id = ?",
);
const updateMissionStateStmt = db.query(
  "UPDATE missions SET state = ?, updated_at = ? WHERE id = ?",
);
const listMissionsStmt = db.query(`
  SELECT m.id, m.intent, m.budget_paise, m.state, m.created_at, m.updated_at,
         (SELECT COUNT(*) FROM audit_events a WHERE a.correlation_id = m.id) AS event_count
  FROM missions m
  ORDER BY m.created_at DESC
`);

// ── Prepared statements: orders ────────────────────────────────────────────
const insertOrderStmt = db.query(`
  INSERT INTO orders (order_id, mission_id, cart_id, amount_paise, payment_link_id,
                      payment_link_url, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const getOrderStmt = db.query("SELECT * FROM orders WHERE order_id = ?");
const clearOrdersStmt = db.query("DELETE FROM orders");

// ── Prepared statements: wipes (resetDemoData) ─────────────────────────────
const clearMissionsStmt = db.query("DELETE FROM missions");
const clearAuditStmt = db.query("DELETE FROM audit_events");

// ── Helpers ────────────────────────────────────────────────────────────────
function rowToProduct(row) {
  return {
    sku: row.sku,
    name: row.name,
    category: row.category,
    pricePaise: row.price_paise,
    stock: row.stock,
  };
}

function rowToMission(row) {
  return {
    missionId: row.id,
    intent: row.intent,
    budgetPaise: row.budget_paise,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.event_count !== undefined ? { eventCount: row.event_count } : {}),
  };
}

function rowToOrder(row) {
  return {
    orderId: row.order_id,
    missionId: row.mission_id,
    cartId: row.cart_id,
    amountPaise: row.amount_paise,
    paymentLinkId: row.payment_link_id,
    paymentLinkUrl: row.payment_link_url,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Health probe used by GET /health — proves the DB file is open and queryable.
 * @returns {{ ok: number }} row from `SELECT 1`
 */
export function ping() {
  return db.query("SELECT 1 AS ok").get();
}

// ── Catalog ────────────────────────────────────────────────────────────────
/** @returns {Array<{sku:string,name:string,category:string,pricePaise:number,stock:number}>} */
export function listProducts() {
  return allProductsStmt.all().map(rowToProduct);
}

/** @param {string} sku @returns {{sku:string,name:string,category:string,pricePaise:number,stock:number}|undefined} */
export function findProduct(sku) {
  const row = getProductStmt.get(sku);
  return row ? rowToProduct(row) : undefined;
}

/**
 * Replace the whole catalog in one transaction (used by `bun run seed`).
 * @param {Array<{sku:string,name:string,category:string,pricePaise:number,stock:number}>} products
 * @returns {void}
 */
export function replaceAllProducts(products) {
  const tx = db.transaction((rows) => {
    clearProductsStmt.run();
    for (const p of rows) {
      insertProductStmt.run(p.sku, p.name, p.category, p.pricePaise, p.stock);
    }
  });
  tx(products);
}

// ── Carts ──────────────────────────────────────────────────────────────────
/**
 * Persist a quoted cart; Phase 2 checkout re-totals it from catalog (M2).
 * @param {object[]} lines @param {number} totalPaise @returns {string} cartId
 */
export function saveCart(lines, totalPaise) {
  const id = `cart_${randomUUID().slice(0, 8)}`;
  insertCartStmt.run(id, JSON.stringify(lines), totalPaise, new Date().toISOString());
  return id;
}

/** @param {string} cartId @returns {{cartId:string, items:object[], totalPaise:number, createdAt:string}|undefined} */
export function findCart(cartId) {
  const row = getCartStmt.get(cartId);
  if (!row) return undefined;
  return {
    cartId: row.id,
    items: JSON.parse(row.items_json),
    totalPaise: row.total_paise,
    createdAt: row.created_at,
  };
}

// ── Missions ───────────────────────────────────────────────────────────────
/** @param {string} intent @param {number|null} budgetPaise @param {string} state @returns {string} missionId */
export function insertMission(intent, budgetPaise, state) {
  const id = `mission_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  insertMissionStmt.run(id, intent, budgetPaise, state, now, now);
  return id;
}

/** @param {string} missionId @returns {object|undefined} mission (camelCase) */
export function getMissionRow(missionId) {
  const row = getMissionStmt.get(missionId);
  return row ? rowToMission(row) : undefined;
}

/** @param {string} missionId @param {string} state @returns {void} */
export function setMissionState(missionId, state) {
  updateMissionStateStmt.run(state, new Date().toISOString(), missionId);
}

/** @returns {Array<object>} missions newest-first, with audit eventCount */
export function listMissions() {
  return listMissionsStmt.all().map(rowToMission);
}

// ── Orders ─────────────────────────────────────────────────────────────────
/**
 * Persist the Razorpay order + payment link created by money-actions.
 * @param {object} o {orderId, missionId, cartId, amountPaise, paymentLinkId, paymentLinkUrl, status}
 * @returns {void}
 */
export function saveOrder(o) {
  insertOrderStmt.run(
    o.orderId, o.missionId, o.cartId, o.amountPaise, o.paymentLinkId,
    o.paymentLinkUrl, o.status, new Date().toISOString(),
  );
}

/** @param {string} orderId @returns {object|undefined} order (camelCase) */
export function findOrder(orderId) {
  const row = getOrderStmt.get(orderId);
  return row ? rowToOrder(row) : undefined;
}

// ── Reset ──────────────────────────────────────────────────────────────────
/** Wipe ALL demo data (audit included) in one transaction — `bun run seed`. */
export function resetDemoData() {
  db.transaction(() => {
    clearAuditStmt.run();
    clearOrdersStmt.run();
    clearMissionsStmt.run();
    clearCartsStmt.run();
    clearProductsStmt.run();
  })();
}
