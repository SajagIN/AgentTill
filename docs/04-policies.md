# 04 · Policies & money rules

## The engine

`src/policy-engine.js` exports one function:

```js
authorize({ actorId, actorType, action, amountPaise, ctx })
  → { decision: "allow" | "deny" | "needs_approval", reason, ruleEvals }
```

It is pure. It performs no network I/O, never calls a model, and throws a `TypeError` if `amountPaise` is not a non-negative integer. Every rule is evaluated on every call — including the ones that do not apply — so the returned `ruleEvals` is a complete record of what was considered, not just what fired.

### Precedence

```
any rule "fail"      → deny            (first failure wins)
else any "triggered" → needs_approval  (first gate wins)
else                 → allow
```

That ordering is load-bearing: a gate can never mask a deny. A cart that is both over the basket limit and above the approval threshold is **denied**, not gated — gating it would imply a human could wave through a hard limit.

### Boundaries

Exact-equal to a limit **passes**. `>` is the deny operator throughout, so `amountPaise === limit` is allowed. The test suite pins this for the basket limit, the hourly cap, the approval threshold, and the mission budget.

## The rules

In evaluation order, as defined in `src/policy-rules.js`:

| # | Rule id | Kind | Applies to | Config key | Default |
|---|---|---|---|---|---|
| 1 | `mandate_ceiling` | Deny | `create_order` | — (per-buyer row) | none |
| 2 | `max_basket_value` | Deny | `create_order`, `retry_payment` | `max_basket_value.limitPaise` | 250000 (₹2,500) |
| 3 | `hourly_spend_cap` | Deny | `create_order`, `retry_payment` | `hourly_spend_cap.limitPaise` | 500000 (₹5,000) |
| 4 | `velocity_max_checkouts_per_hour` | Deny | `create_order`, `retry_payment` | `velocity_max_checkouts.maxCheckouts` | 4 |
| 5 | `category_allowlist` | Deny | `create_order`, `retry_payment` | `category_allowlist.categories` | office, it, supplies |
| 6 | `approval_above` | Gate | `create_order`, `retry_payment` | `approval_above.thresholdPaise` | 100000 (₹1,000) |
| 7 | `mission_budget` | Deny | `create_order`, `retry_payment` | — (per-mission) | none |

Note that the rule id `velocity_max_checkouts_per_hour` and its config key `velocity_max_checkouts` differ. The key is what the Policies page and `PUT /api/policies/:key` use; the id is what appears in `ruleEvals`.

### Rule detail

**`mandate_ceiling`** — looks up an active mandate for the actor. No mandate means the rule passes. With one, a cart above `max_amount_paise` is denied.

**`max_basket_value`** — a hard ceiling on a single cart.

**`hourly_spend_cap`** — `spentLastHourPaise + amountPaise` must not exceed the cap. Prior spend is summed from `audit_events` over the trailing 60 minutes, counting only `create_order` and `retry_payment` events with outcome `succeeded`.

**`velocity_max_checkouts_per_hour`** — counts checkout *attempts* in the trailing hour, including failures but excluding gated and denied attempts, since those never moved money. At the cap, the next attempt is denied.

**`category_allowlist`** — every cart line's category must be in the list. A denial names the offending SKU and the allowed set. The seed catalog includes one `catering` product specifically so this rule is demonstrable.

**`approval_above`** — the only gate. Two ways to satisfy it:
- `ctx.approvalResolved` is true, meaning a human already approved this exact checkout;
- the actor holds a mandate whose ceiling covers the amount.

Otherwise, an amount strictly above the threshold returns `triggered`.

**`mission_budget`** — denies a cart above the mission's own budget. A mission with no budget is unbounded and passes.

### Changing rules at runtime

Thresholds live in the `policy_configs` table and are read on every evaluation, so `PUT /api/policies/:key` (or the Policies page) takes effect on the next checkout with no restart and no cache.

`RULES_VERSION` (`"rules-v3-db"`) is stamped into every audit decision, so an old event can be read back against the rule set that produced it.

## Money rules

These are invariants of the codebase, not configuration.

### M1 — integer paise everywhere

Money is `amountPaise`, an integer, in code, in the database, and across the API. ₹1 = `100`.

No `parseFloat` and no `Number("12.34")` on a money value. Multiplication is always `integer × integer`. Conversion to a display string happens in exactly one place: `formatINR` in `frontend/src/lib/format.ts`, using `Intl.NumberFormat('en-IN')`.

The policy engine enforces this at its boundary: a non-integer `amountPaise` throws.

### M2 — server-side pricing

Client- and agent-supplied amounts are ignored. Totals are computed from catalog prices.

At order creation, `retotalFromCatalog()` re-derives the total from the **current** catalog and compares it to the quoted total. Any mismatch throws `422 AMOUNT_MISMATCH` and writes a denial to the audit trail. This catches catalog edits between quote and checkout, and any attempt to submit a doctored cart.

### M3 — one money module

`src/money-actions.js` is the only importer of `razorpay-client.js`, and the only code path that creates orders, payment links, or refunds. Every call inside it follows:

```
authorize() → execute → audit()
```

If the verdict is `deny`, the SDK is never called. `src/money-actions.test.js` proves this with a stubbed client whose every method is a booby-trap that throws if touched — so an accidental call fails the suite loudly rather than silently.

### M4 — no LLM near money

The policy engine is deterministic code. It does not call a model, does not compute totals, does not decide authorisation, does not construct or verify webhook signatures, and never sees a secret.

AgentTill currently uses no LLM at all: the buyer agent extracts keywords and matches them against the catalog. That is deliberate for a system whose whole claim is auditability — a non-deterministic planner would make the audit trail harder to reason about, not easier. The agent's HTTP-only access to the API means an LLM could be dropped into `src/agent/` later without gaining any privilege it does not already have through the public API.

## Webhook security

Registered with `express.raw({ type: "application/json" })` **before** `express.json()`, so the handler sees the exact bytes the signature was computed over.

Verification order: signature → event id → `JSON.parse`. The HMAC-SHA256 comparison uses `crypto.timingSafeEqual` over equal-length buffers. A failure is a `401` with no state change.

Idempotency is keyed on `X-Razorpay-Event-Id` with a primary key on `webhook_events.event_id`; a replay is recorded once and not reprocessed.

`confirmPayment` does not trust the payload: it refetches the payment from Razorpay and compares the amount against the stored order. A mismatch leaves mission state untouched and audits an `info` event.

## Failure posture

Fail closed. On any uncertainty in a money path — an SDK error mid-flow, an ambiguous payment state, a missing webhook secret — the system stops, leaves state untouched or moves to a terminal state, writes an audit event, and surfaces the problem. It never "retries silently to make it work".
