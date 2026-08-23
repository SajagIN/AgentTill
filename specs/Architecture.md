# Architecture — AgentTill

**Stack (fixed — do not substitute without human approval):**

| Layer | Choice | Why |
|---|---|---|
| Runtime/PM | **Bun 1.1+** (`bun add` · `bun run` · `bun --watch` · `bun test`) — **ESM** (`"type":"module"`), plain JavaScript + JSDoc | One tool for install/run/test, instant installs, no build step |
| HTTP | Express **4.x** (`express@^4.19`) | Predictable, best-documented for AI pair work |
| DB | SQLite via Bun's built-in `bun:sqlite` (`import { Database } from "bun:sqlite"`) | Zero native deps to break; synchronous prepared-statement API, single file |
| Payments | `razorpay` SDK (official, v2) | Orders, payment links, payments, refunds |
| LLM | `openai` SDK — chat completions with tool calls; model from `OPENAI_MODEL` env (default `gpt-4o-mini`) | Official SDK, hand-rolled loop, no framework |
| Validation | `zod` | Request schemas at the API edge |
| Tests | `bun:test` (built-in) via `bun test` | Zero extra deps, jest-like API |
| UI | Static `public/` (HTML + vanilla JS + one CSS file) served by Express | No framework, no build step; looks great on video anyway |
| Secrets | Bun auto-loads `.env` from project root | No dotenv dependency; `.env` in `.gitignore`, `.env.example` committed |

**Total dependencies allowed: exactly 4** (`express`, `razorpay`, `openai`, `zod`) — SQLite, env loading, and testing are Bun built-ins. Everything goes through `bun`, never `npm`/`npx`/`node` directly (see Rules.md R1). Commit the lockfile Bun generates (`bun.lock`/`bun.lockb`).

---

## 1. System overview

```
                            ┌────────────────────────────────────────────────┐
                            │                 EXPRESS APP (src/server.js)    │
┌──────────────┐  HTTP/JSON │  routes.js (thin)                              │
│  BUYER AGENT │───────────►│   GET /catalog   POST /quote   POST /checkout  │
│ (agent/      │◄───────────│   GET /missions/:id  POST /webhooks/razorpay   │
│  OpenAI tool │  JSON +    │   GET /approvals  POST /approvals/:id/…        │
│  loop)       │  statuses  │   GET /audit  POST /missions (create)          │
└──────┬───────┘            │                                                │
       │ imports (same      │        EVERY money action:                     │
       │ process)           │        authorize() → execute → audit()         │
       ▼                    │            │                                   │
┌──────────────┐            │            ▼                                   │
│ APPROVALS UI │───────────►│  policy-engine.js (PURE)   money-actions.js    │
│ + AUDIT      │            │  rules.js                  (the ONLY module    │
│ REPLAY UI    │◄───────────│  audit.js (append-only)    that imports        │
│ (public/)    │  fetch()   │  approvals.js               razorpay-client)   │
└──────────────┘            │  missions.js (state machine)  webhooks.js      │
                            └────────────────────────────────────────────────┘
                                   │ SDK (test keys)
                                   ▼
                          Razorpay Test Mode (orders · payment links · payments · refunds)
                                   │ signed webhooks (raw-body HMAC)
                                   ▼
                            webhooks.js → money-actions.confirm_payment → audit.js
```

## 2. Module dependency rules (enforced by review + grep test)

- `policy-engine.js` imports **nothing** app-side. Pure functions in, decision out. This is what makes it testable and trustworthy.
- `razorpay-client.js` may be imported **only** by `money-actions.js`. (Test: `grep -r "razorpay-client" src/ agent/ scripts/` returns one import site.)
- `money-actions.js` is the only creator of payments/orders/refunds. Orchestrates: policy → razorpay → audit. Never imports Express.
- `audit.js` is append-only. No UPDATE/DELETE anywhere in the codebase against `audit_events`.
- `agent/` imports `money-actions` and `catalog` **through tool functions only** (`agent/tools.js`); the LLM never sees raw SDK handles, keys, or SQL.
- `routes.js` modules are thin: validate (zod) → call module → shape response. No business logic in routes.

## 3. File map (canonical — the AI creates exactly these)

```
agenttill/
├── README.md                    # demo GIF first; quickstart; rules table; where-AI/isn't-AI
├── package.json                 # "type":"module", scripts below
├── .env.example                 # var names only, fake values
├── .gitignore                   # .env, node_modules, *.db
├── specs/                       # this spec pack, committed
├── docs/incident-log.md         # human-maintained; AI may suggest entries, never edit
├── src/
│   ├── server.js                # express app: raw-body webhook route FIRST, then json parser, static, routers
│   ├── config.js                # env validate (zod; Bun auto-loads .env), PORT, BASE_URL, constants
│   ├── db.js                    # bun:sqlite Database open, PRAGMA journal_mode=WAL, schema migrations
│   ├── catalog.js               # seed data + queries (products, stock decrement)
│   ├── policy-engine.js         # authorize(actor, action, amount_paise, ctx) → decision (PURE)
│   ├── policy-rules.js          # rule definitions (data, not code-branches-in-engine)
│   ├── policy-engine.test.js    # bun:test unit tests (~15+)
│   ├── money-actions.js         # create_order · confirm_payment · retry_payment · refund
│   ├── razorpay-client.js       # thin wrapper: createOrder, createPaymentLink, fetchPayment, refundPayment
│   ├── webhooks.js              # verify signature (timingSafeEqual) → idempotency → dispatch
│   ├── audit.js                 # appendEvent(), getMissionTimeline(), stats for policy ctx
│   ├── approvals.js             # create/list/resolve approvals; resume paused missions
│   ├── missions.js              # mission CRUD + state machine transitions (table in §7)
│   └── routes.js                # all routers, thin
├── agent/
│   ├── prompts.js               # system prompt + tool descriptions (versioned strings)
│   ├── tools.js                 # tool schema + dispatch: searchCatalog, getQuote, beginCheckout,
│   │                            #   checkStatus, requestRefund (each wraps money-actions/catalog)
│   └── agent.js                 # hand-rolled loop + max-iteration stop + pause on needs_approval
├── public/
│   ├── index.html               # dashboard: missions list + approvals queue (hash routing)
│   ├── app.js                   # fetch + render; no framework
│   └── styles.css               # design system per Design.md
└── scripts/
    ├── smoke-order.js           # Phase 0: create+fetch order, print ids  (bun run smoke)
    ├── seed.js                  # reset db, seed catalog + rules        (bun run seed)
    ├── demo-mission.js          # run scripted mission from CLI          (bun run demo)
    └── paybot.js                # P1 stretch: headless payer (puppeteer — ask before adding)
```

`package.json` scripts: `dev` (`bun --watch src/server.js`), `seed` (`bun scripts/seed.js`), `smoke`, `demo`, `test` (`bun test`). Run with `bun run <script>`.

## 4. The four money actions — exact contract

```js
// src/money-actions.js — every function: authorize → execute → audit. No exceptions.

createOrder({ missionId, cartId, actor })
  → { status: "created", orderId, paymentLinkId, paymentLinkUrl, amountPaise, auditEventId }
  → { status: "denied",  reason, ruleEvals, auditEventId }
  → { status: "needs_approval", approvalId, reason, auditEventId }
  // amount computed server-side from catalog prices at quote time; re-verified at order time
  // (quote-vs-order mismatch > 0 → hard stop, incident-level error)

confirmPayment({ orderId, paymentId, source: "webhook" })   // called ONLY by webhooks.js
  → verifies payment fetched from Razorpay API matches order amount; marks mission CONFIRMED

retryPayment({ orderId, missionId, attempt })               // attempt ≤ 2, backoff = attempt^2 * 5s
  → re-runs authorize() with velocity ctx (a retry is a new checkout attempt); links parent_event_id

refund({ paymentId, amountPaise, reason, actor })
  → policy check (refund needs allow; amount ≤ captured) → Razorpay refund API → audit
```

## 5. Policy engine

```js
// PURE. No clock reads inside (ctx.now injected), no DB (ctx.stats precomputed), no LLM.
authorize({ actorId, actorType, action, amountPaise, ctx })
ctx = { now, cart: [{sku, qty, category, unitPaise}], missionBudgetPaise,
        window: { spentLastHourPaise, checkoutsLastHour } }   // from audit.js stats
→ { decision: "allow" | "deny" | "needs_approval",
    reason: "cart ₹1,234.00 exceeds max basket ₹1,000.00",     // human-readable, shown in UI
    ruleEvals: [{ ruleId, params, outcome: "pass"|"fail"|"triggered", detail }] }
```

Precedence: any `fail` → **deny**; else any `triggered` gate → **needs_approval**; else **allow**.

Rules live in `policy-rules.js` as data: `max_basket_value` (₹2,500 default), `hourly_spend_cap` (₹5,000), `velocity_max_checkouts_per_hour` (4), `category_allowlist` (e.g. office/supplies/it — demo denies "catering"), `approval_above` (₹1,000). Mission `budgetPaise` is enforced as an additional bound.

## 6. Audit event schema (append-only)

```js
appendEvent({ correlationId, parentEventId, actor:{type,id}, action,
              amountPaise, decision:{result, reason, ruleEvals}, entities:{cartId,orderId,paymentId,approvalId},
              outcome: "succeeded"|"failed"|"denied"|"awaiting_approval"|"info" })
```

Table `audit_events(id TEXT pk, ts TEXT, correlation_id TEXT, parent_event_id, actor, action, amount_paise INTEGER, decision JSON, entities JSON, outcome)` + indexes on correlation_id, ts. Replay UI = `SELECT … WHERE correlation_id=? ORDER BY ts`.

## 7. Mission state machine

```
PLANNING → QUOTED → POLICY_CHECK → PAYING → (AWAITING_APPROVAL → PAYING) → CONFIRMED
                                        ↘ FAILED → RETRYING (≤2) → FAILED_FINAL → ESCALATED
POLICY_CHECK →denied→ REJECTED (agent may re-plan → back to PLANNING, ≤2 re-plans)
any → CANCELLED / REFUNDED
```

Invalid transitions throw `TransitionError`; `missions.js` is the single transition authority.

## 8. Razorpay integration specifics (test mode)

- **Amounts are integer paise.** ₹1,234.00 → `123400`. No floats anywhere near money (Rules.md M1).
- Order: `rzp.orders.create({ amount, currency: "INR", receipt: cartId, notes: { correlationId, missionId } })`
- Payment link: `rzp.paymentLinks.create({ amount, currency: "INR", reference_id: orderId, notes })` → returns `short_url` (the demo's payable URL)
- Fetch: `rzp.payments.fetch(paymentId)`; Refund: `rzp.payments.refund(paymentId, { amount, speed: "normal" })`
- **Webhook route MUST register before the JSON parser and use `express.raw({ type: "application/json" })`** — signature is HMAC-SHA256 of the **raw body bytes**, verified with `crypto.timingSafeEqual` against header `X-Razorpay-Signature` and `RAZORPAY_WEBHOOK_SECRET`. Getting raw-vs-parsed wrong is the #1 known failure — it is incident-log bait; expect it, log it, fix it.
- Idempotency: unique index on webhook `event_id` (header `X-Razorpay-Event-Id`); replays are stored, logged, not reprocessed.
- Events handled: `payment.captured`, `payment.failed`, `refund.processed` (payload at `body.payload.payment.entity` / `body.payload.refund.entity`).
- Test instruments: card `4111 1111 1111 1111` (any future expiry/CVV) succeeds; UPI `success@razorpay` succeeds; **`failure@razorpay` fails** → fires `payment.failed` webhook. Netbanking mock pages allow choosing success/failure. Live-mode-only features (UPI intent, settlements) are out of scope.
- `.env`: `RAZORPAY_KEY_ID=rzp_test_…`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (from Dashboard → Settings → Webhooks), `OPENAI_API_KEY`, `OPENAI_MODEL`, `PORT=3000`, `BASE_URL` (tunnel URL, used to print correct links). **Bun auto-loads `.env` — no dotenv import anywhere in the code.**

## 9. Buyer agent (agent/)

- Hand-rolled loop in `agent.js`: `messages → OpenAI (tools) → dispatch tool calls via tools.js → append tool results → repeat`, hard stop at **12 iterations**. On `needs_approval`: persist state `AWAITING_APPROVAL`, end loop; `approvals.js` resume re-enters the loop after human decision.
- Tools (the agent's entire world): `search_catalog(query)`, `get_quote(items)` (server prices), `begin_checkout(cartId)` (runs the money action; agent receives status + reason + ruleEvals — a denial is *information* it can re-plan from), `check_status(missionId)`, `request_refund(paymentId, reason)`.
- Grounding: tool layer resolves SKUs against catalog (hallucinated SKU → clean 404-style tool error); totals never computed by the LLM; budget enforced by policy bound, prompt merely *mentions* it.
- System prompt (in `prompts.js`) states: you are a procurement agent; you must never claim success without `check_status` showing CONFIRMED; on denial, re-plan within budget or report failure honestly.

## 10. Sequence — happy path (the video's 2 minutes)

```
Operator: POST /missions {intent, budgetPaise}
 → agent PLANNING: search_catalog → get_quote (server totals) → begin_checkout
 → money-actions.createOrder: authorize() [all rules pass] → rzp.orders.create
   → payment link → audit(evt allow) → mission PAYING → returns link
 → human clicks link, pays 4111…  (or paybot)
 → Razorpay → POST /webhooks/razorpay (payment.captured, HMAC ok, new event_id)
 → webhooks.js → money-actions.confirmPayment (amount re-check) → mission CONFIRMED → audit
 → dashboard timeline: quote → policy → order → payment → confirm (5 events, green)
```

Failure variant: pay with `failure@razorpay` → `payment.failed` → mission FAILED → agent wakes, `retryPayment` (velocity rule re-checked, backoff) → second link paid with success card → CONFIRMED; timeline shows the chain via `parent_event_id`. Overspend variant: agent's cart > budget/basket → `deny` → agent re-plans cheaper cart → passes.

## 11. Testing strategy

- `policy-engine.test.js` (imports `{ test, expect }` from `bun:test`): ~15 cases — each rule pass/fail/trigger, precedence, boundary amounts (exact-equal passes), integer-paise only.
- `webhooks` test: forged signature → 401 + no state change; duplicate event_id → 200 + no double-processing (call handler twice, assert one audit event).
- `money-actions` test with razorpay-client **stubbed at the module boundary** (allowed in tests only): deny path never calls SDK — assert call count 0. This *proves* "nothing moves money without passing the gate."
- Manual acceptance per phase via `curl` scripts (Phases.md) — real Razorpay test API, real webhooks through the tunnel.
- `bun run demo` is the final integration test; must pass twice consecutively on a fresh clone before recording the video.
