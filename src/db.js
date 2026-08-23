/**
 * SQLite via Bun's built-in driver (`bun:sqlite`) — no native deps (R1).
 * Single file `agenttill.db`, WAL mode. All SQL lives HERE (and later in
 * audit.js) as prepared statements — never concatenated with user input (R5).
 *
 * Schema history (append-only — later phases ADD tables, never mutate old ones):
 *   Phase 1 — products, carts
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
`);

// ── Prepared statements ────────────────────────────────────────────────────
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
  "INSERT INTO carts (id, items_json, total_paise, created_at) VALUES (?, ?, ?, ?)",
);
const clearCartsStmt = db.query("DELETE FROM carts");

// ── Helpers ────────────────────────────────────────────────────────────────
/** Map a snake_case DB row to the camelCase API shape (money stays integer paise). */
function rowToProduct(row) {
  return {
    sku: row.sku,
    name: row.name,
    category: row.category,
    pricePaise: row.price_paise,
    stock: row.stock,
  };
}

/**
 * Health probe used by GET /health — proves the DB file is open and queryable.
 * @returns {{ ok: number }} row from `SELECT 1`
 */
export function ping() {
  return db.query("SELECT 1 AS ok").get();
}

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

/**
 * Persist a quoted cart and return its id (checkpoint for Phase 2 checkout,
 * where totals are re-derived from catalog prices and compared — M2).
 * @param {object[]} lines quote lines ({sku, qty, unitPaise, linePaise, …})
 * @param {number} totalPaise integer paise
 * @returns {string} cartId
 */
export function saveCart(lines, totalPaise) {
  const id = `cart_${randomUUID().slice(0, 8)}`;
  insertCartStmt.run(id, JSON.stringify(lines), totalPaise, new Date().toISOString());
  return id;
}

/**
 * Wipe demo data (carts + catalog) in one transaction. `bun run seed` calls
 * this before reseeding; Phase 2+ will extend it to missions/audit when those
 * tables exist.
 * @returns {void}
 */
export function resetDemoData() {
  db.transaction(() => {
    clearCartsStmt.run();
    clearProductsStmt.run();
  })();
}
