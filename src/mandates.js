import { join } from "node:path";
import { db } from "./db.js";
import { randomUUID } from "node:crypto";

export function getMandate(buyerId) {
  const row = db.query("SELECT * FROM mandates WHERE buyer_id = ? AND active = 1").get(buyerId);
  return row ? { ...row, allowed_merchants: JSON.parse(row.allowed_merchants) } : null;
}

export function createMandate(buyerId, maxAmountPaise, merchants = ["m_001"]) {
  const id = `mand_${randomUUID().slice(0, 8)}`;
  db.query(
    "INSERT INTO mandates (id, buyer_id, max_amount_paise, allowed_merchants, active, created_at) VALUES (?, ?, ?, ?, 1, ?)"
  ).run(id, buyerId, maxAmountPaise, JSON.stringify(merchants), new Date().toISOString());
  return id;
}

export function revokeMandate(mandateId) {
  db.query("UPDATE mandates SET active = 0 WHERE id = ?").run(mandateId);
}
