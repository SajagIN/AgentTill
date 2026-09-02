import fs from 'fs';
const data = fs.readFileSync('src/db.js', 'utf8');

let newData = data.replace(
  'const insertCartStmt = db.query(\n  "INSERT INTO carts (id, items_json, total_paise, created_at) VALUES (?, ?, ?, ?)",\n);',
  'const insertCartStmt = db.query(\n  "INSERT INTO carts (id, items_json, total_paise, created_at, negotiated_total_paise) VALUES (?, ?, ?, ?, ?)",\n);'
);

newData = newData.replace(
  'const getCartStmt = db.query(\n  "SELECT id, items_json, total_paise, created_at FROM carts WHERE id = ?",\n);',
  'const getCartStmt = db.query(\n  "SELECT id, items_json, total_paise, created_at, negotiated_total_paise FROM carts WHERE id = ?",\n);'
);

fs.writeFileSync('src/db.js', newData);
