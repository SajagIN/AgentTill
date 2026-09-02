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
const windowSpentStmt = db.query(`
  SELECT COALESCE(SUM(amount_paise), 0) AS spent
  FROM audit_events
  WHERE action IN ('create_order', 'retry_payment')
    AND outcome = 'succeeded'
    AND ts >= ?
`);
const windowCountStmt = db.query(`
  SELECT COUNT(*) AS attempts
  FROM audit_events
  WHERE action IN ('create_order', 'retry_payment')
    AND outcome IN ('succeeded', 'failed')
    AND ts >= ?
`);

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

// Trailing-hour spend and attempt counts for the policy engine velocity rules.
// Velocity counts succeeded+failed attempts only; gated/denied never moved money.
export function getCheckoutWindowStats(now = new Date()) {
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  return {
    spentLastHourPaise: windowSpentStmt.get(cutoff).spent,
    checkoutsLastHour: windowCountStmt.get(cutoff).attempts,
  };
}
