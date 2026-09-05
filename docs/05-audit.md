# 05 · Audit & receipts

## Why this exists

An autonomous agent that spends money is only acceptable if you can reconstruct exactly what it did — including what it was stopped from doing. AgentTill writes a row for every money-layer decision, allowed or not, and folds each mission's rows into a hash tree so the history can be checked for tampering afterwards.

## The event store

`audit_events` in `src/db.js`:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `evt_` + 8 hex chars |
| `ts` | TEXT | ISO-8601 UTC |
| `correlation_id` | TEXT | Normally the mission id; refunds use `refund_<paymentId>` |
| `parent_event_id` | TEXT | Links a retry to the attempt it followed |
| `actor` | TEXT (JSON) | `{ "type": "agent" \| "human" \| "system", "id": "…" }` |
| `action` | TEXT | See below |
| `amount_paise` | INTEGER | Null when the event carries no amount |
| `decision` | TEXT (JSON) | Verdict, reason, and the full `ruleEvals` |
| `entities` | TEXT (JSON) | Related ids: cart, order, approval, payment |
| `outcome` | TEXT | `succeeded`, `denied`, `failed`, `awaiting_approval`, `info` |

**Append-only in practice.** The only statements against this table are the `INSERT` in `src/audit.js`, three `SELECT`s, and a single `DELETE` inside `resetDemoData`. There is no `UPDATE` anywhere in the codebase.

### Actions

| Action | Written by | Outcome |
|---|---|---|
| `create_order` | `money-actions.createOrder` | `succeeded` / `denied` / `awaiting_approval` / `failed` |
| `retry_payment` | `money-actions.retryPayment` | as above |
| `confirm_payment` | webhook `payment.captured` | `succeeded` / `failed` / `info` |
| `payment_failed` | webhook `payment.failed` | `failed` / `info` |
| `refund` | `money-actions.refund` | `succeeded` / `denied` / `failed` |
| `refund_processed` | webhook `refund.processed` | `info` |
| `approval_resolved` | `approvals.resolveApproval` | `info` |

Denials carry the complete `ruleEvals` array, so an auditor can see not only which rule fired but every rule that passed alongside it.

### Reading the trail

```bash
curl http://localhost:3000/api/audit/mission_ab12cd34
curl http://localhost:3000/api/audit/mission_ab12cd34/receipt
```

Events come back ordered by `ts`, then `rowid`, so same-millisecond inserts stay in insertion order. The dashboard's **Audit Trail** page renders the same payload, and **Missions → View** opens it beside the order and the receipt.

## Merkle receipts

`src/merkle-receipt.js` folds a mission's events into a 4-leaf balanced tree using SHA-256 throughout.

```
              root = H(n01 ‖ n23)
             /                \
   n01 = H(l0 ‖ l1)      n23 = H(l2 ‖ l3)
      /        \            /        \
   l0 = H(d0) l1 = H(d1) l2 = H(d2) l3 = H(d3)
```

Chunking the events into four buckets:

- **0 events** — all four leaves hash the empty string; the root is still well defined.
- **1–4 events** — one event per leaf, unused leaves hash the empty string.
- **5+ events** — `chunkSize = ceil(n / 4)`; leaf *i* hashes the JSON of `events[i·chunkSize … (i+1)·chunkSize)`.

The receipt returns the root, both intermediate nodes, all four leaves, and the raw payload chunks that produced them:

```json
{
  "root": "ba7d38d1e22e661b2c4092e9e634c1e0d699b2f18e26136202ae379ae9a1cc65",
  "topology": "quad_balanced",
  "nodes": { "intermediate": ["…", "…"], "leaves": ["…", "…", "…", "…"] },
  "payloadChunks": ["[…]", "…", "", ""]
}
```

Because the chunks are included, a client can recompute every leaf and the root without trusting the server's arithmetic. Removing or reordering a stored event changes at least one chunk, therefore a leaf, therefore the root.

### What this does and does not prove

A fixed 4-leaf tree over an append-only table is a **tamper-evidence** mechanism, not a consensus one. It detects that history changed; it does not by itself stop someone with database write access from recomputing the whole tree. Making it non-repudiable would mean anchoring the root somewhere the operator does not control — publishing it, or committing it to an external ledger. That is deliberately out of scope, and the dashboard says so by showing the inputs alongside the root.

## Correlation ids

One id ties everything together. A mission's own events use its `missionId`. Refunds use `refund_<paymentId>` because a refund may not map cleanly to a mission. Events for an unknown order use `order_<orderId>` so an orphaned webhook is still recorded rather than dropped.

## What the dashboard shows

**Audit Trail** page — pick a mission or paste a correlation id, then read the timeline: action, timestamp, actor, outcome, amount, the reason, and the full rule evaluation. The **Merkle receipt** tab draws the tree and exposes the hashed chunks.

**Missions → View** — the same trail per mission, alongside the order details and its receipt.

**Approvals** — the rule evaluation behind each pending gate, so the decision is made with the same evidence the engine used.
