# 01 · Architecture

AgentTill is one process serving four things: a JSON API, a React dashboard, an MCP server, and a Razorpay webhook receiver. There is no second service, no queue, and no build step on the backend.

## Components

### `src/server.js` — the composition root

Mounts everything in a deliberate order:

1. `POST /webhooks/razorpay` — **before** `express.json()`. The webhook needs the exact request bytes to verify an HMAC signature, so it gets `express.raw()`.
2. CORS + JSON body parsing for everything else.
3. `GET /health` — liveness plus a database ping.
4. `/mcp` — MCP over HTTP.
5. `/pay/:orderId` — the Razorpay Standard Checkout fallback page.
6. `/api/*` — the REST surface from `routes.js`.
7. Static `frontend/dist`, with a catch-all that returns `index.html` for any non-API GET so client-side routes deep-link.
8. Error middleware that maps typed errors to status codes.

If `frontend/dist/index.html` is missing, the server still starts and serves the API; requests to `/` return a `503 FRONTEND_NOT_BUILT` telling you to run `bun run build`.

### `src/routes.js` — the HTTP surface

Thin by design. Every handler validates its body with zod at the edge, calls a domain module, and serialises the result. No business logic lives here.

The one piece of orchestration it owns is the mission lifecycle: `POST /api/missions` creates the row, fires the buyer agent in the background, and responds immediately with `201`. If the agent returns an abandoned outcome (`no_products`, `budget_exhausted`, `api_error`, `rate_limited`), the route cancels the mission so the dashboard never shows a `PLANNING` row nothing will ever advance.

### `src/agent/` — the buyer loop

The agent talks to AgentTill **over HTTP**, through the same `/api` routes an external client would use. That is a deliberate choice: it proves the public surface is sufficient, and it means the agent gets no privileges the API does not grant.

`agent.js` runs the loop; `tools.js` is its client. One iteration:

```
extract keywords from the intent
  → search the catalog for each
  → keep the first non-excluded match per keyword
  → drop anything that would exceed the budget
  → cap the cart at 3 items
  → POST /api/quote
  → POST /api/checkout
  → branch on the verdict
```

On a **deny** the agent re-plans: it excludes the most expensive product it found and tries again, up to twice. On a **velocity** denial it stops immediately — waiting for the window to reset is not the agent's decision to make. On **needs_approval** it returns and leaves the mission frozen. It never approves its own checkout.

Failures are classified. `400`, `404` and `422` are not retryable, so the agent stops at once instead of burning backoff on a mistake. Network errors and `5xx` get up to three attempts with quadratic backoff. `runMission` always resolves to a structured `{ status, ... }` — it never returns `null`, so a caller can always tell what happened.

### `src/policy-engine.js` + `src/policy-rules.js` — the gate

`authorize()` is a pure function: an actor, an action, an integer amount, and a context object go in; a verdict and the full rule evaluation come out. It performs no I/O itself — individual rules read their thresholds from `policy_configs` so an operator can change limits without a deploy.

Precedence is fixed and short: **any `fail` → deny. Otherwise any `triggered` → needs_approval. Otherwise allow.** That ordering is what stops a gate rule from masking a deny rule.

### `src/money-actions.js` — the money boundary

The only module that imports `razorpay-client.js`, and therefore the only code path that can create an order, a payment link, or a refund. Every function follows the same shape:

```
load and validate → re-derive the amount → authorize() → execute → audit()
```

`createOrder` is the important one. Before consulting the policy engine it re-totals the cart from the **current** catalog and compares against the quoted total. Any mismatch throws `422 AMOUNT_MISMATCH` and writes a denial to the audit trail. This is the M2 guard: even a cart the server itself quoted is re-verified at the moment money moves.

It also guards idempotency: if the mission already has an order for that cart, it returns the existing order rather than raising a second one.

### `src/audit.js` + `src/merkle-receipt.js` — the ledger

`audit_events` is append-only in practice: nothing in the codebase issues an `UPDATE` or `DELETE` against it outside `resetDemoData`. Every money action, approval decision, webhook, denial and failure writes a row.

`getMissionReceipt` folds a mission's events into a 4-leaf balanced Merkle tree with SHA-256 and returns the root, the intermediate nodes, the leaves, and the payload chunks that produced them — enough for a client to re-derive the root independently.

### `src/webhooks.js` — inbound truth

Registered with `express.raw()` before the JSON parser. Verification order matters: signature first, then event id, then `JSON.parse`. The HMAC comparison is timing-safe and runs against the raw bytes. Duplicate deliveries are detected on `X-Razorpay-Event-Id` and recorded once.

`confirmPayment` does not trust the webhook payload: it re-fetches the payment from Razorpay and compares the amount against the stored order before confirming. Any ambiguity leaves mission state untouched and writes an `info` event.

### `frontend/` — the dashboard

React 19 + Vite + Tailwind v4 + shadcn/ui. Six pages, each opening with a `PageHeader` that states what the page is for and how to use it.

All requests go through `lib/api.ts`. It fetches via a hidden iframe's `fetch`, because some Chrome extensions monkey-patch `window.fetch` badly enough to stall React's scheduler; if the iframe is unavailable it falls back to the global `fetch`. Paths are always relative, so the same bundle works in dev (Vite proxy) and production (same origin).

## Request lifecycle: a checkout

```
POST /api/checkout  { cartId, missionId }
  │
  ├─ zod validates the body                       400 VALIDATION_ERROR
  ├─ findCart(cartId)                             404 CART_NOT_FOUND
  ├─ resolve the mission                          404 MISSION_NOT_FOUND
  ├─ validate approvalId if present               404 / 409
  ├─ retotalFromCatalog(cart.items)               422 AMOUNT_MISMATCH  ← M2
  ├─ transition → POLICY_CHECK
  ├─ authorize({ amountPaise: negotiated ?? quoted, ctx })
  │     ├─ deny            → transition REJECTED,        audit, return 403
  │     ├─ needs_approval  → createApproval, transition
  │     │                     AWAITING_APPROVAL, audit, return 200
  │     └─ allow           ↓
  ├─ razorpay.createOrder()
  ├─ razorpay.createPaymentLink()   (falls back to /pay/:orderId on rate limit)
  ├─ saveOrder()
  ├─ transition → PAYING
  └─ audit "create_order / succeeded"
```

## Boundaries worth knowing

| Boundary | What it prevents |
|---|---|
| Agent → HTTP API | The agent cannot reach the database or the SDK; it gets exactly what any client gets. |
| Quote → order re-total | A stale or tampered cart total cannot become an order amount. |
| Policy engine → SDK | On a deny, `razorpay-client` is never called. A test asserts this with a booby-trapped stub. |
| Webhook → state | An unverified or replayed webhook changes nothing. |
| Errors → clients | Only `AppError` messages leave the server; anything else becomes an opaque 500. |

## Storage

SQLite in WAL mode at `agenttill.db` in the repository root, resolved from the module's location rather than the process working directory (override with `AGENTTILL_DB_PATH`). Tables: `products`, `carts`, `missions`, `orders`, `approvals`, `audit_events`, `webhook_events`, `mandates`, `negotiation_sessions`, `policy_configs`.

All queries are prepared statements held as module-level constants. Column names are `snake_case`; the row-mapping functions convert to `camelCase` at the boundary.
