# 03 · API reference

Base URL is the server origin. Everything below `/api` is JSON.

**Money is integer paise in every request and response.** ₹1 = `100`. Conversion to rupees is a UI concern only.

## Errors

Every error uses one shape:

```json
{
  "error": {
    "code": "POLICY_DENIED",
    "message": "amount 189900 paise is above approval threshold 100000 paise",
    "ruleEvals": [ … ]
  }
}
```

`issues` is added for validation failures. Only messages from the typed error hierarchy (`src/errors.js`) are returned; an unexpected exception becomes an opaque `500 INTERNAL_ERROR` and is logged server-side.

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body failed zod validation |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | HMAC check failed |
| `POLICY_DENIED` | 403 | A deny rule fired; `ruleEvals` explains which |
| `NOT_FOUND` | 404 | No such mission, order, approval, cart, or mandate |
| `INVALID_TRANSITION` | 409 | The state machine refused the move |
| `AMOUNT_MISMATCH` | 422 | M2 guard: the cart no longer totals what it quoted |
| `RAZORPAY_API_ERROR` | 502 | The payment API rejected the call |
| `WEBHOOK_SECRET_MISSING` | 503 | Webhooks are not configured |
| `FRONTEND_NOT_BUILT` | 503 | `frontend/dist` is missing |

An unknown `/api/*` path returns `404` JSON — never the SPA shell — so a client never parses HTML as JSON.

---

## Catalog & quotes

### `GET /api/catalog`

The full product catalog. This is the only source of pricing.

```json
{ "products": [ { "sku": "OFF-NOTE-A4", "name": "Spiral Notebook A4 (200 pg)",
                  "category": "office", "pricePaise": 5990, "stock": 40 } ] }
```

### `POST /api/quote`

Prices line items server-side and returns a `cartId`. All-or-nothing: one unknown SKU rejects the whole quote.

```json
// request
{ "items": [ { "sku": "OFF-NOTE-A4", "qty": 3 } ] }

// 200
{ "cartId": "cart_1a2b3c4d", "totalPaise": 17970, "items": [ … ] }

// 400
{ "error": { "code": "UNKNOWN_SKU", "message": "unknown sku: OFF-NOPE",
             "unknownSkus": ["OFF-NOPE"], "validSkus": [ … ] } }
```

Limits: 1–50 line items, quantity 1–99.

---

## Checkout

### `POST /api/checkout`

```json
// request
{ "cartId": "cart_1a2b3c4d", "missionId": "mission_ab12cd34", "buyerId": "operator" }
```

`missionId` is optional; omitting it creates an implicit mission so the audit trail stays uniform. `buyerId` is optional and selects the actor used for mandate rules.

Three outcomes:

```json
// 200 · allowed
{ "status": "created", "missionId": "…", "orderId": "order_…",
  "paymentLinkId": "plink_…", "paymentLinkUrl": "https://rzp.io/…",
  "amountPaise": 17970, "auditEventId": "evt_…" }

// 200 · gated — no order exists yet
{ "status": "needs_approval", "missionId": "…", "approvalId": "appr_…",
  "reason": "amount 189900 paise is above approval threshold 100000 paise",
  "ruleEvals": [ … ], "auditEventId": "evt_…" }

// 403 · denied — no order was created
{ "status": "denied", "reason": "…", "ruleEvals": [ … ],
  "error": { "code": "POLICY_DENIED", "message": "…" } }
```

Re-checking out a cart the mission already ordered returns the existing order with `"duplicateResolved": true` instead of raising a second one.

### `GET /api/orders/:orderId`

```json
{ "order": { "orderId": "…", "missionId": "…", "cartId": "…", "amountPaise": 17970,
             "paymentLinkId": "…", "paymentLinkUrl": "…", "status": "created",
             "paymentId": null, "createdAt": "2026-09-05T08:07:48.408Z" } }
```

### `POST /api/orders/:orderId/retry`

Raises a new order for a mission in `FAILED`, with a full policy re-check and exponential backoff.

```json
// request
{ "orderId": "order_…", "missionId": "mission_…", "attempt": 1 }
```

`attempt` is 1 or 2. The mission must be in `FAILED`; `409 INVALID_MISSION_STATE` otherwise, `403 MAX_RETRIES_EXCEEDED` above two attempts.

### `POST /api/refunds`

```json
// request
{ "paymentId": "pay_…", "amountPaise": 5000, "reason": "damaged on arrival" }
```

Refetches the payment and refuses anything above the captured amount with `422 REFUND_EXCEEDS_CAPTURED`.

---

## Missions

### `POST /api/missions`

Creates a mission and starts the buyer agent in the background. Responds immediately.

```json
// request
{ "intent": "restock: notebooks, markers, coffee", "budgetPaise": 200000 }

// 201
{ "missionId": "mission_ab12cd34", "state": "PLANNING" }
```

### `GET /api/missions`

Newest first, with a count of audit events per mission.

```json
{ "missions": [ { "missionId": "…", "intent": "…", "budgetPaise": 200000,
                  "state": "AWAITING_APPROVAL", "createdAt": "…", "updatedAt": "…",
                  "eventCount": 1 } ] }
```

### `GET /api/missions/:id`

```json
{ "mission": { … }, "order": { … } | null }
```

`order` is the most recent order for the mission, or `null` if the policy engine never allowed one.

### `GET /api/missions/:id/timeline`

The mission's audit events, oldest first. Same payload as `/api/audit/:correlationId`.

### `GET /api/missions/:id/receipt`

The Merkle receipt for those events. `404` if the mission has none yet.

---

## Approvals

### `GET /api/approvals`

```json
{ "approvals": [ { "approvalId": "appr_…", "missionId": "…", "cartId": "…",
                   "amountPaise": 189900, "reason": "…", "ruleEvals": [ … ],
                   "status": "pending", "decidedBy": null, "decidedAt": null,
                   "createdAt": "…" } ] }
```

### `POST /api/approvals/:id/approve`

Records the decision, then creates the order under the already-granted approval. The `approval_above` gate is satisfied for this attempt only; every other rule is re-evaluated.

```json
// 200
{ "approval": { …, "status": "approved" }, "checkout": { "status": "created", … } }
```

### `POST /api/approvals/:id/deny`

Records the decision and moves the mission to `REJECTED`. No money moves.

Deciding an approval twice returns `409 INVALID_TRANSITION`.

---

## Audit

### `GET /api/audit/:correlationId`

`correlationId` is normally a mission id; refund events use `refund_<paymentId>`. Must match `^[a-zA-Z0-9_-]+$`.

```json
{ "timeline": [ {
    "eventId": "evt_…", "ts": "2026-09-05T08:07:48.408Z",
    "correlationId": "mission_…", "parentEventId": null,
    "actor": { "type": "agent", "id": "operator" },
    "action": "create_order", "amountPaise": 189900,
    "decision": { "decision": "needs_approval", "reason": "…", "ruleEvals": [ … ] },
    "entities": { "cartId": "…", "approvalId": "…" },
    "outcome": "awaiting_approval" } ] }
```

Outcomes: `succeeded`, `denied`, `failed`, `awaiting_approval`, `info`.

Money-layer events carry `decision.decision`; webhook-driven events carry `decision.result`.

### `GET /api/audit/:correlationId/receipt`

```json
{ "root": "ba7d…c65", "topology": "quad_balanced",
  "nodes": { "intermediate": ["…", "…"], "leaves": ["…", "…", "…", "…"] },
  "payloadChunks": ["[…]", "…", "", ""] }
```

---

## Policies

### `GET /api/policies`

```json
{ "policies": [ { "key": "max_basket_value", "value": { "limitPaise": 250000 } },
                { "key": "category_allowlist", "value": { "categories": ["office","it","supplies"] } } ] }
```

### `PUT /api/policies/:key`

Replaces the value. Accepts numbers and string arrays only; anything else is a `400`.

```json
// request
{ "thresholdPaise": 250000 }

// 200
{ "key": "approval_above", "value": { "thresholdPaise": 250000 } }
```

Takes effect on the next policy evaluation — there is no cache to invalidate.

---

## Mandates

A mandate lets a buyer auto-pay up to a ceiling without tripping the approval gate.

| Method & path | Body | Notes |
|---|---|---|
| `GET /api/mandates/:buyerId` | — | `404` if no active mandate |
| `POST /api/mandates` | `{ "buyerId": "buyer_1", "maxAmountPaise": 500000 }` | Returns `201` with `mandateId` |
| `DELETE /api/mandates/:mandateId` | — | Deactivates; returns `{ "status": "revoked" }` |

---

## Negotiation

### `POST /api/negotiate/rfq`

Asks the merchant for counter-offers against a target unit price. Offers respect a 15% minimum margin floor and cap discounts at 20%.

```json
// request
{ "items": [ { "sku": "OFF-NOTE-A4", "qty": 10, "target_unit_price_paise": 4500 } ] }

// 200
{ "status": "OFFERS_PROPOSED", "session_id": "neg_…",
  "minimum_margin_floor_pct": 15, "counter_offers": [ … ], "reason": "…" }
```

`status` is `OFFERS_PROPOSED`, `REJECTED_MARGIN_FLOOR`, or `REJECTED_SKU_NOT_FOUND`.

### `POST /api/negotiate/accept`

```json
// request
{ "session_id": "neg_…", "option_id": "opt_1", "missionId": "mission_…",
  "buyer_id": "buyer_1", "buyer_mandate": { "max_amount": 500000 } }
```

Builds a cart from the accepted offer and checks it out. The cart stores the **list** total so the M2 re-total passes, with the negotiated total recorded alongside — that negotiated figure is what the policy engine authorises.

---

## Non-`/api` routes

| Route | Purpose |
|---|---|
| `GET /health` | `{ "ok": true, "service": "agenttill", "db": "agenttill.db (WAL)" }` |
| `GET /mcp` | MCP server metadata |
| `POST /mcp` | JSON-RPC 2.0 — see [`06-mcp.md`](06-mcp.md) |
| `GET /pay/:orderId` | Razorpay Standard Checkout page, used when test-mode link limits are hit |
| `POST /webhooks/razorpay` | Signed Razorpay webhooks. `express.raw()`, so the body is verified as bytes |

### `GET /api/config`

Non-secret view of what the deployment is wired to — safe to expose, contains no credentials.

```json
{ "baseUrl": "http://localhost:3000", "razorpayKeyMode": "test", "webhookConfigured": true }
```
