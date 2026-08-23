# Phases — AgentTill build order

Rules of the road: **one phase at a time, in order, acceptance green before advancing.** Never build ahead "while we're at it." Dates map to `PLAN.md` days but order is law; if you slip a day, cut scope inside the phase (listed as "cut if late"), never the acceptance tests.

| Phase | What | PLAN.md day | Cut if late |
|---|---|---|---|
| 0 | Skeleton + first Razorpay order | Day 1 (Aug 22) | — |
| 1 | Catalog + quotes | Day 1–2 | stock decrement |
| 2 | Money core: policy stub + orders + payment links | Day 2–3 | — |
| 3 | Webhooks | Day 3 (⚠️ decision gate after) | refund event |
| 4 | Real policy engine + approvals | Day 6–7 | velocity rule |
| 5 | Audit store + dashboard UI | Day 8 | catalog view |
| 6 | Buyer agent + happy path E2E | Day 4–5 / re-verify Day 7 | second mission archetype |
| 7 | Failure playbook | Day 9 | — |
| 8 | Demo polish, README, video prep | Day 10–13 | paybot |

> Note: Phase 6 lands after 4–5 in *build* order so the agent has real gates to hit, even though PLAN.md drafted the agent earlier. The gate-first order is deliberate: safety layer before intelligence.

---

## Phase 0 — Skeleton + "hello, money"

**Build:** repo scaffold (`bun init -y` or handwritten `package.json` with `"type":"module"`), Bun 1.1+ installed (`curl -fsSL https://bun.sh/install | bash`), `.env` (auto-loaded), DB open via `bun:sqlite` (empty schema ok), Express health route, `scripts/smoke-order.js`.
**Requirements:** `config.js` validates env (zod) and fails fast with a clear message; `db.js` opens `agenttill.db` with WAL; `smoke-order.js` creates an order for ₹100 (`amount: 10000`) with `receipt:"smoke_001"`, fetches it back, prints both raw JSON objects.
**Acceptance (human pastes output):**
```
bun run smoke
→ prints order JSON with id:"order_…" status:"created" amount:10000 currency:"INR"
```
**Don't:** build anything else, add routes beyond /health, handle webhooks.

## Phase 1 — Catalog + quotes

**Build:** `src/catalog.js` (12–15 products across categories: office, it, supplies, catering*), `scripts/seed.js`, `GET /catalog`, `POST /quote`.
**Requirements:** quote takes `{items:[{sku,qty}]}`, resolves SKUs server-side (unknown SKU → 400 listing valid ones), computes `totalPaise` and per-line totals in code; response includes a `cartId` (persisted). *One product deliberately in category `catering` — future deny-demo ammo.
**Acceptance:** `bun run seed` then
`curl :3000/catalog` → 12–15 products · `curl -X POST :3000/quote -d '{"items":[{"sku":"OFF-NOTE-A4","qty":3}]}'` → correct math for 3× price (human verifies paise arithmetic by hand ONCE) · unknown sku → 400.

## Phase 2 — Money core: the four actions (policy = allow-all stub)

**Build:** `razorpay-client.js`, `policy-rules.js` + `policy-engine.js` (stub: return allow with empty ruleEvals + reason "phase2-stub"), `money-actions.js` with `createOrder` + `refund` (+ stubs for the other two), `POST /checkout`, `GET /missions` scaffolding in `missions.js`, `audit.js` appendEvent (already writing events!).
**Requirements:** checkout flow = quote re-total → authorize → rzp order → payment link → audit → return `{status, orderId, paymentLinkUrl, amountPaise}`; order `notes` carry `correlationId`; quote→order mismatch guard already active (M2).
**Acceptance:** `curl -X POST :3000/checkout -d '{"cartId":"…"}'` → real `order_…` id + working `short_url` → **human pays it by hand with `4111 1111 1111 1111`** → payment shows `captured` in the Razorpay dashboard → one audit event row exists in SQLite.

## Phase 3 — Webhooks + ⚠️ DECISION GATE

**Build:** `webhooks.js` + route with `express.raw` **registered before** JSON middleware; signature verify (timingSafeEqual); idempotency on event id; handlers for `payment.captured` → `confirmPayment` (amount re-check) and `payment.failed` → mission FAILED + audit; `refund.processed` → audit.
**Requirements:** raw-body HMAC before parse; forged-signature test returns 401 with zero state change; duplicate event → 200, single processing.
**Acceptance (with tunnel running, human pastes server logs):** pay a link with success card → webhook logged, mission CONFIRMED in DB · pay with UPI `failure@razorpay` → `payment.failed` logged, mission FAILED · re-deliver same event id → no double-processing · `curl` the webhook with garbage signature → 401.
**⚠️ GATE (human decision, not AI):** comfortable with orders/links/webhooks? → commit Track 01 through the deadline. Still fighting basics after honest effort? → stop, pivot per PLAN.md Day-3 note (same code becomes Track 03's recovery core). After this gate there is no more pivoting.

## Phase 4 — Real policy engine + approvals

**Build:** all 5 rules in `policy-rules.js`, real engine logic, `policy-engine.test.js` (≥15 cases), `approvals.js` (+ `GET /approvals`, `POST /approvals/:id/approve|deny`), `needs_approval` branch of `createOrder` (no SDK call, mission pauses in `AWAITING_APPROVAL`).
**Requirements:** engine pure (ctx injected: `now`, window stats from `audit.js`); precedence deny > needs_approval > allow; boundaries: amount == limit passes (`>` denies, not `>=`); approvals store ruleEvals + reason for the human to see.
**Acceptance:** `bun test` green with ≥15 policy cases · checkout with cart > ₹1,000 default threshold → `needs_approval`, NO order in dashboard, NO SDK call (assert via stubbed test) → approve via API → mission resumes to `PAYING` with a fresh order.

## Phase 5 — Audit replay + dashboard

**Build:** `audit.js` timeline query + `GET /audit/:correlationId`, `public/` dashboard per Design.md: missions list, mission timeline (event cards with decision chips, rule-eval detail, amounts formatted via `formatINR`), approvals queue with one-click approve/deny.
**Requirements:** timeline groups by mission and links retries via `parentEventId` (indent or connector); denials shown as prominently as successes; no framework, one CSS file.
**Acceptance:** run Phases 2–4 flows; dashboard shows the full story of each mission including one denial and one approval — **screenshot-worthy for the README** (human takes the screenshot).

## Phase 6 — Buyer agent + happy path E2E

**Build:** `agent/prompts.js`, `agent/tools.js`, `agent/agent.js` (loop, 12-iteration cap, pause on `needs_approval`, resume hook), `POST /missions`, `scripts/demo-mission.js`.
**Requirements:** tools per Architecture §9 only; hallucinated SKU → clean tool error the agent can recover from; agent MUST `check_status`-confirm before declaring success (prompt rule + code check: mission CONFIRMED required for exit code 0); budget as policy bound; agent receives denial `ruleEvals` and re-plans (≤2 re-plans) instead of dying.
**Acceptance:** `bun run demo` with mission `{"intent":"restock: notebooks, markers, coffee","budgetPaise":200000}` → agent plans, checkout > ₹1,000 triggers approval → **human approves in dashboard** → agent completes payment (success card) → mission CONFIRMED, timeline shows every event including its LLM-visible reason strings. Full transcript printed to console (video gold).

## Phase 7 — Failure playbook (all five, staged)

**Build:** `retryPayment` money action (attempt ≤ 2, backoff `attempt²×5s`, velocity re-check, `parentEventId` chaining), ESCALATED state + its approval item, amount-mismatch hard-stop test, webhook forgery + duplicate tests, refund E2E.
**Requirements & acceptance (each demoed live, pasted output):**
1. `failure@razorpay` → FAILED → retry (backoff visible in logs) → second attempt paid with success card → CONFIRMED; timeline shows chain.
2. Mission budget ₹500, agent wants ₹2,000 cart → DENIED at gate → agent re-plans within budget → succeeds.
3. Forged webhook → 401, zero state change (curl with bad signature).
4. Duplicate webhook → one audit event (test + manual replay).
5. Tampered amount (mutate quote between quote and checkout via debug script) → hard stop before order creation.
6. Two failed retries → ESCALATED appears in approvals with the full chain.
**This phase is the submission's spine — do not cut anything here.**

## Phase 8 — Polish, README, video prep

**Build:** `bun run demo` one-command story (seed → happy path w/ approval → scripted failure), README (GIF first, quickstart, architecture diagram, rules table, "where AI is / isn't used" section, failure section, incident-log teaser), architecture diagram (mermaid or ASCII), demo script + video outline (PLAN.md), fresh-clone verification.
**Stretch (P1, only if all green):** paybot via puppeteer (ask before adding dep) · upsell mission archetype.
**Acceptance:** fresh clone in a new folder: `bun i && cp .env.example .env (fill) && bun run seed && bun run demo` → green **twice in a row** · README rendered looks excellent · video script written before any recording.

---

## After every phase (AI protocol)

1. Human pastes acceptance output → AI verifies against the phase's acceptance block.
2. AI outputs full updated `Memory.md`.
3. AI suggests (never writes) an incident-log line for every real bug hit during the phase.
4. Next chat starts with Memory.md + the next phase's text only.
