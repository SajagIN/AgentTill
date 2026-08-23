/**
 * Append-only audit trail. Every money action — allowed, denied, gated,
 * failed, retried, refunded — leaves an event here. There is NO update or
 * delete against audit_events anywhere in the codebase (Architecture §2),
 * and this module is the only writer.
 *
 * SQL lives here by design (R5: db.js / audit.js only).
 */
import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const insertEventStmt = db.query(`
  INSERT INTO audit_events
    (id, ts, correlation_id, parent_event_id, actor, action, amount_paise, decision, entities, outcome)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const timelineStmt = db.query(
  "SELECT * FROM audit_events WHERE correlation_id = ? ORDER BY ts, rowid",
);

/**
 * Append one audit event. Never throws silently upward — a broken audit write
 * is a fail-closed condition for money actions (R4), so callers treat errors
 * here as fatal for the action.
 *
 * @param {object} e
 * @param {string} e.correlationId mission id this event belongs to (= missionId)
 * @param {string|null} [e.parentEventId] retry chains link here
 * @param {{type:string,id:string}} e.actor who acted ("human"|"agent"|"system")
 * @param {string} e.action create_order | confirm_payment | retry_payment | refund | …
 * @param {number|null} e.amountPaise integer paise, null for non-money info events
 * @param {{result:string,reason:string,ruleEvals?:object[]}} [e.decision] policy decision
 * @param {object} [e.entities] {cartId?, orderId?, paymentId?, approvalId?, …}
 * @param {"succeeded"|"failed"|"denied"|"awaiting_approval"|"info"} e.outcome
 * @returns {string} eventId
 */
export function appendEvent(e) {
  const id = `evt_${randomUUID().slice(0, 8)}`;
  insertEventStmt.run(
    id,
    new Date().toISOString(),
    e.correlationId,
    e.parentEventId ?? null,
    JSON.stringify(e.actor),
    e.action,
    e.amountPaise ?? null,
    e.decision ? JSON.stringify(e.decision) : null,
    e.entities ? JSON.stringify(e.entities) : null,
    e.outcome,
  );
  return id;
}

/**
 * Full timeline for one mission, oldest first (replay order).
 * @param {string} correlationId
 * @returns {Array<{eventId:string, ts:string, correlationId:string, parentEventId:string|null,
 *   actor:object, action:string, amountPaise:number|null, decision:object|null,
 *   entities:object|null, outcome:string}>}
 */
export function getMissionTimeline(correlationId) {
  return timelineStmt.all(correlationId).map((r) => ({
    eventId: r.id,
    ts: r.ts,
    correlationId: r.correlation_id,
    parentEventId: r.parent_event_id,
    actor: JSON.parse(r.actor),
    action: r.action,
    amountPaise: r.amount_paise,
    decision: r.decision ? JSON.parse(r.decision) : null,
    entities: r.entities ? JSON.parse(r.entities) : null,
    outcome: r.outcome,
  }));
}
