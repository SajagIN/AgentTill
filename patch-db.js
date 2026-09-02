import fs from 'fs';
const data = fs.readFileSync('src/db.js', 'utf8');

let newData = data.replace(
  `CREATE TABLE IF NOT EXISTS carts (
    id          TEXT PRIMARY KEY,
    items_json  TEXT NOT NULL,
    total_paise INTEGER NOT NULL,
    created_at  TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS carts (
    id          TEXT PRIMARY KEY,
    items_json  TEXT NOT NULL,
    total_paise INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    negotiated_total_paise INTEGER
  );`
);

newData = newData.replace(
  'const insertCartStmt = db.prepare(`INSERT INTO carts (id, items_json, total_paise, created_at) VALUES (?, ?, ?, ?)`);',
  'const insertCartStmt = db.prepare(`INSERT INTO carts (id, items_json, total_paise, created_at, negotiated_total_paise) VALUES (?, ?, ?, ?, ?)`);'
);

newData = newData.replace(
  'export function saveCart(lines, totalPaise) {\n  const id = `cart_${randomUUID().slice(0, 8)}`;\n  insertCartStmt.run(id, JSON.stringify(lines), totalPaise, new Date().toISOString());\n  return id;\n}',
  'export function saveCart(lines, totalPaise, negotiatedTotalPaise = null) {\n  const id = `cart_${randomUUID().slice(0, 8)}`;\n  insertCartStmt.run(id, JSON.stringify(lines), totalPaise, new Date().toISOString(), negotiatedTotalPaise);\n  return id;\n}'
);

newData = newData.replace(
  'export function findCart(cartId) {\n  const row = getCartStmt.get(cartId);\n  if (!row) return undefined;\n  return {\n    cartId: row.id,\n    items: JSON.parse(row.items_json),\n    totalPaise: row.total_paise,\n    createdAt: row.created_at,\n  };\n}',
  'export function findCart(cartId) {\n  const row = getCartStmt.get(cartId);\n  if (!row) return undefined;\n  return {\n    cartId: row.id,\n    items: JSON.parse(row.items_json),\n    totalPaise: row.total_paise,\n    negotiatedTotalPaise: row.negotiated_total_paise,\n    createdAt: row.created_at,\n  };\n}'
);

fs.writeFileSync('src/db.js', newData);
