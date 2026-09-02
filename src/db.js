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
  
  CREATE TABLE IF NOT EXISTS mandates (
    id TEXT PRIMARY KEY,
    buyer_id TEXT NOT NULL,
    max_amount_paise INTEGER NOT NULL,
    allowed_merchants TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mandates_buyer ON mandates (buyer_id);

  CREATE TABLE IF NOT EXISTS carts (
    id          TEXT PRIMARY KEY,
    items_json  TEXT NOT NULL,
    total_paise INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    negotiated_total_paise INTEGER
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

  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id     TEXT PRIMARY KEY,
    event_type   TEXT NOT NULL,
    received_at  TEXT NOT NULL
  );

  
  CREATE TABLE IF NOT EXISTS negotiation_sessions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    session_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS approvals (
    id           TEXT PRIMARY KEY,
    mission_id   TEXT NOT NULL,
    cart_id      TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    reason       TEXT NOT NULL,
    rule_evals   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    decided_by   TEXT,
    decided_at   TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status);
`);

// ALTER TABLE can't evolve an existing table via CREATE IF NOT EXISTS,
// so check pragma exactly once per process startup.
const orderColumns = db.query("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!orderColumns.includes("payment_id")) {
  db.exec("ALTER TABLE orders ADD COLUMN payment_id TEXT");
  console.log("[db] migrated: orders.payment_id added");
}

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

const insertCartStmt = db.query(
  "INSERT INTO carts (id, items_json, total_paise, created_at, negotiated_total_paise) VALUES (?, ?, ?, ?, ?)",
);
const getCartStmt = db.query(
  "SELECT id, items_json, total_paise, created_at, negotiated_total_paise FROM carts WHERE id = ?",
);
const clearMandatesStmt = db.query("DELETE FROM mandates");
const clearCartsStmt = db.query("DELETE FROM carts");

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

const insertOrderStmt = db.query(`
  INSERT OR REPLACE INTO orders (order_id, mission_id, cart_id, amount_paise, payment_link_id,
                      payment_link_url, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const getOrderStmt = db.query("SELECT * FROM orders WHERE order_id = ?");
const getLatestOrderByMissionStmt = db.query(
  "SELECT * FROM orders WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1",
);
const getOrderByPaymentStmt = db.query("SELECT * FROM orders WHERE payment_id = ?");
const setOrderStatusStmt = db.query(
  "UPDATE orders SET status = ?, payment_id = COALESCE(?, payment_id) WHERE order_id = ?",
);
const clearOrdersStmt = db.query("DELETE FROM orders");

const insertApprovalStmt = db.query(`
  INSERT INTO approvals (id, mission_id, cart_id, amount_paise, reason, rule_evals, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
`);
const getApprovalStmt = db.query("SELECT * FROM approvals WHERE id = ?");
const listApprovalsStmt = db.query("SELECT * FROM approvals ORDER BY created_at DESC");
const setApprovalDecisionStmt = db.query(
  "UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
);
const clearApprovalsStmt = db.query("DELETE FROM approvals");

const insertWebhookEventStmt = db.query(
  "INSERT OR IGNORE INTO webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)",
);
const getWebhookEventStmt = db.query("SELECT event_id FROM webhook_events WHERE event_id = ?");
const clearWebhookEventsStmt = db.query("DELETE FROM webhook_events");

const clearMissionsStmt = db.query("DELETE FROM missions");
const clearAuditStmt = db.query("DELETE FROM audit_events");

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
    paymentId: row.payment_id,
    createdAt: row.created_at,
  };
}

export function ping() {
  return db.query("SELECT 1 AS ok").get();
}

export function listProducts() {
  return allProductsStmt.all().map(rowToProduct);
}

export function findProduct(sku) {
  const row = getProductStmt.get(sku);
  return row ? rowToProduct(row) : undefined;
}

export function replaceAllProducts(products) {
  const tx = db.transaction((rows) => {
    clearProductsStmt.run();
    for (const p of rows) {
      insertProductStmt.run(p.sku, p.name, p.category, p.pricePaise, p.stock);
    }
  });
  tx(products);
}

export function saveCart(lines, totalPaise, negotiatedTotalPaise = null) {
  const id = `cart_${randomUUID().slice(0, 8)}`;
  insertCartStmt.run(id, JSON.stringify(lines), totalPaise, new Date().toISOString(), negotiatedTotalPaise);
  return id;
}

export function findCart(cartId) {
  const row = getCartStmt.get(cartId);
  if (!row) return undefined;
  return {
    cartId: row.id,
    items: JSON.parse(row.items_json),
    totalPaise: row.total_paise,
    negotiatedTotalPaise: row.negotiated_total_paise,
    createdAt: row.created_at,
  };
}

export function insertMission(intent, budgetPaise, state) {
  const id = `mission_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  insertMissionStmt.run(id, intent, budgetPaise, state, now, now);
  return id;
}

export function getMissionRow(missionId) {
  const row = getMissionStmt.get(missionId);
  return row ? rowToMission(row) : undefined;
}

export function setMissionState(missionId, state) {
  updateMissionStateStmt.run(state, new Date().toISOString(), missionId);
}

export function listMissions() {
  return listMissionsStmt.all().map(rowToMission);
}

export function saveOrder(o) {
  insertOrderStmt.run(
    o.orderId, o.missionId, o.cartId, o.amountPaise, o.paymentLinkId,
    o.paymentLinkUrl, o.status, new Date().toISOString(),
  );
}

export function findOrder(orderId) {
  const row = getOrderStmt.get(orderId);
  return row ? rowToOrder(row) : undefined;
}

export function findLatestOrderByMission(missionId) {
  const row = getLatestOrderByMissionStmt.get(missionId);
  return row ? rowToOrder(row) : undefined;
}

export function findOrderByPayment(paymentId) {
  const row = getOrderByPaymentStmt.get(paymentId);
  return row ? rowToOrder(row) : undefined;
}

export function setOrderStatus(orderId, status, paymentId = null) {
  setOrderStatusStmt.run(status, paymentId, orderId);
}

export function isDuplicateWebhookEvent(eventId) {
  return getWebhookEventStmt.get(eventId) !== null;
}

export function recordWebhookEvent(eventId, eventType) {
  const res = insertWebhookEventStmt.run(eventId, eventType, new Date().toISOString());
  return res.changes === 1;
}

function rowToApproval(row) {
  return {
    approvalId: row.id,
    missionId: row.mission_id,
    cartId: row.cart_id,
    amountPaise: row.amount_paise,
    reason: row.reason,
    ruleEvals: JSON.parse(row.rule_evals),
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export function insertApproval(a) {
  const id = `appr_${randomUUID().slice(0, 8)}`;
  insertApprovalStmt.run(id, a.missionId, a.cartId, a.amountPaise, a.reason, JSON.stringify(a.ruleEvals), new Date().toISOString());
  return id;
}

export function getApprovalRow(approvalId) {
  const row = getApprovalStmt.get(approvalId);
  return row ? rowToApproval(row) : undefined;
}

export function listApprovalRows() {
  return listApprovalsStmt.all().map(rowToApproval);
}

export function setApprovalDecision(approvalId, decision, decidedBy) {
  setApprovalDecisionStmt.run(decision, decidedBy, new Date().toISOString(), approvalId);
}

// Wipe ALL demo data in one transaction — run via `bun run seed`.
export function resetDemoData() {
  db.transaction(() => {
    clearApprovalsStmt.run();
    clearWebhookEventsStmt.run();
    clearAuditStmt.run();
    clearOrdersStmt.run();
    clearMissionsStmt.run();
    
    clearMandatesStmt.run();
    clearCartsStmt.run();
    clearProductsStmt.run();
  })();
}

const insertNegSessionStmt = db.query(
  "INSERT INTO negotiation_sessions (id, merchant_id, session_json, created_at) VALUES (?, ?, ?, ?)"
);
const getNegSessionStmt = db.query(
  "SELECT session_json FROM negotiation_sessions WHERE id = ?"
);
const clearNegSessionsStmt = db.query("DELETE FROM negotiation_sessions");

export function saveNegotiationSession(sessionId, merchantId, sessionObj) {
  insertNegSessionStmt.run(sessionId, merchantId, JSON.stringify(sessionObj), new Date().toISOString());
}

export function getNegotiationSessionRow(sessionId) {
  const row = getNegSessionStmt.get(sessionId);
  return row ? JSON.parse(row.session_json) : undefined;
}
