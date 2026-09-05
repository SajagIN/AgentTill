# 08 · Troubleshooting

Failure modes AgentTill is designed around, what you will actually see, and what to do.

Where a claim below is a diagnosis rather than something reproducible on demand, it is labelled as such.

## Error classes

| Class | Status | Source | Example |
|---|---|---|---|
| Validation | 400 | zod at the route edge | Missing `cartId` |
| Auth | 401 | Webhook HMAC | Forged signature |
| Policy | 403 | Policy engine | Category not allowlisted |
| Missing | 404 | Lookup | Unknown mission id |
| State | 409 | State machine | Approving twice |
| Invariant | 422 | M2 re-total | Cart total drifted |
| Upstream | 502 | Razorpay SDK | Bad credentials |
| Config | 503 | Startup guard | Webhook secret unset |

## Payment link rate limit

**Symptom:** `502 RAZORPAY_API_ERROR` on order creation mentioning `RATE_LIMIT_EXCEEDED`, or an order with no `paymentLinkUrl`.

**Cause:** Razorpay test mode caps accounts at roughly 30 active payment links per hour.

**Response:** `money-actions.js` treats a rate-limited link creation as non-fatal. The order is still created, and the link falls back to AgentTill's own Standard Checkout page at `/pay/:orderId`, which pays the same order through the Razorpay checkout script. The buyer can complete payment either way.

**Action:** Close unused links in the [test-mode dashboard](https://dashboard.razorpay.com/app/test/payment-links), or wait for the window to roll over.

The agent treats an explicit `429` as non-retryable and stops immediately rather than burning attempts — the limit will not lift by retrying.

## Placeholder or invalid credentials

**Symptom:** missions reach `PAYING`-bound checkout and then fail; the mission ends `CANCELLED`; the log shows `[502] Razorpay orders.create failed`.

**Cause:** `.env` still holds the placeholder values from `.env.example`.

**Response:** `razorpay-client.js` wraps the SDK failure in `RazorpayApiError`, `createOrder` audits a `failed` event, and the agent retries up to three times before giving up. `routes.js` then cancels the mission so it does not sit in `PLANNING` forever.

**Action:** Add real test keys. Everything before this point — planning, quoting, gating, approvals, audit, receipts — works without them.

## `503 FRONTEND_NOT_BUILT`

**Symptom:** the API responds, `/` returns `503`.

**Cause:** `frontend/dist/index.html` does not exist.

**Action:** `bun run build`. The server deliberately keeps serving the API rather than refusing to start.

## `503 WEBHOOK_SECRET_MISSING`

**Symptom:** every webhook delivery is rejected.

**Cause:** `RAZORPAY_WEBHOOK_SECRET` is empty.

**Response:** this is fail-closed by design. Accepting an unsigned event would let anyone confirm a payment.

**Action:** set the secret to match the one configured in the Razorpay dashboard webhook, then restart.

## `401 WEBHOOK_SIGNATURE_INVALID`

**Symptom:** webhooks rejected with a valid-looking payload.

**Cause:** the secret does not match, or something upstream re-serialised the body.

**Response:** rejection happens before `JSON.parse`, so no state changes and nothing is recorded as processed.

**Action:** confirm the tunnel forwards the raw body. Any middleware that parses and re-emits JSON will change the bytes and break the HMAC.

## Duplicate webhook deliveries

**Symptom:** the same event id arrives twice.

**Response:** `webhook_events.event_id` is a primary key. The first delivery is processed; the second returns `{ "duplicate": true }` and changes nothing. Verified by `src/webhooks.test.js`.

## `422 AMOUNT_MISMATCH`

**Symptom:** checkout rejected before any policy evaluation.

**Cause:** the cart's stored total no longer matches the catalog. Either a price changed between quote and checkout, or the cart was tampered with.

**Response:** hard stop. A denial is written to the audit trail and no order is created. Verified by the e2e suite.

**Action:** re-quote. Do not patch the stored total — the mismatch is the signal that something changed.

## `409 INVALID_TRANSITION`

**Symptom:** an approval or webhook operation fails.

**Cause:** the mission already moved on — usually a racing duplicate delivery or a decision made twice.

**Response:** for webhook-driven paths this is expected and handled: the code catches it, writes an `info` event describing the out-of-order arrival, and leaves state untouched. For a direct API call it surfaces as a `409`.

**Action:** reload the mission and check its current state before acting.

## Mission stuck in `PLANNING`

**Symptom:** a mission never advances.

**Cause:** normally an agent that crashed before it could report back.

**Response:** `POST /api/missions` wraps the agent promise; both the reject path and the abandoned-status path cancel the mission. A row stuck in `PLANNING` means neither ran, which indicates a process restart mid-flight.

**Action:** create a new mission. There is no resumable work in `PLANNING` — the agent holds no state between requests.

## Dashboard freezes or stops re-rendering

**Symptom:** the network tab shows successful responses but the UI does not update.

**Diagnosis (from the original investigation, not reproduced here):** certain Chrome extensions — copy-enablers, grammar checkers, some devtools overlays — monkey-patch `window.fetch` and neighbouring scheduler hooks in ways that break React's update loop.

**Mitigation:** `frontend/src/lib/api.ts` takes `fetch` from a hidden iframe, which extensions have not touched, and falls back to the global `fetch` if the iframe is unavailable. All dashboard requests go through it.

**Action if it still happens:** reload in a private window with extensions disabled to confirm the cause before looking at application code.

## Reading the logs

The server logs every request as `[METHOD] /path`, and the agent logs its own progress with an `[agent]` prefix:

```
[agent] quoted 189900 paise for 1 item(s) · attempt 1
[agent] gated — approval appr_92956f63 required; leaving it to a human
[agent] denied (category "catering" is not allowlisted …) — re-planning 1/2, dropping CAT-LUNC-BOX
[agent] giving up after 3 attempts: [502] Razorpay orders.create failed …
```

`[money]` and `[webhook]` prefixes mark the money boundary and inbound events. Unknown exceptions print a full stack and are reported to the client as an opaque `500`.

## Starting from scratch

```bash
rm -f agenttill.db agenttill.db-wal agenttill.db-shm
bun run seed
bun test          # confirm the code, not the data, is the problem
```
