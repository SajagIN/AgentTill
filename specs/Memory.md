# Memory — AgentTill
> **Living save file.** Paste at the top of EVERY new chat. The AI appends/updates after each phase; the human saves the file. Never let the codebase and this file drift apart — a fact not in here doesn't exist.

**LAST UPDATED:** 2026-08-23 · Phase 2 accepted GREEN · Phase 3 delivered (awaiting acceptance + ⚠️ decision gate)
**CURRENT PHASE:** 3 — Webhooks (raw-body HMAC, idempotency, captured/failed/refund handlers)

## 1. Project facts (stable — update rarely)

- AgentTill: AI buyer agent + deterministic policy gate + append-only audit trail, on Razorpay **test mode only**. Razorpay AI Buildathon Track 01. Solo, deadline Sep 5 2026, submit by Sep 4.
- Stack frozen: **Bun** (runtime + PM + test runner; never npm/node directly), ESM JS (no TS), Express 4, `bun:sqlite` (built-in), official `razorpay` + `openai` SDKs, zod. **4 deps total, ever** (express, razorpay, openai, zod; openai installs at Phase 6). `.env` auto-loaded by Bun. No frameworks. Tests via `bun:test` / `bun test`.
- Sources of truth: PRD.md (what), Architecture.md (how, file map §3), Rules.md (hard constraints), Phases.md (order + acceptance), Design.md (UI).
- `.env` vars: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`(REQUIRED from Ph 3 — must equal dashboard webhook secret), `OPENAI_API_KEY`(Ph 6+), `OPENAI_MODEL`, `PORT`, `BASE_URL`.
- Money law: integer paise everywhere; 4 money actions only (`create_order`, `confirm_payment`, `retry_payment`, `refund`) all in `money-actions.js` as `authorize → execute → audit`; deny ⇒ zero SDK calls (test-proven Ph 4); LLM never touches money logic; `razorpay-client` importable ONLY by `money-actions` (grep test — green since Ph 2).
- Demo instruments: **4111 … rejected as "international" on our test account** — use UPI `success@razorpay` (preferred) · domestic MC `5267 3181 8797 5449` · netbanking mock · UPI `failure@razorpay` for failure demos. (Which one the human used for Ph 2: not yet confirmed — ask.)
- Human runs on Windows PowerShell, repo at `D:\razorpay buildathon\AgentTill`. AI sandbox = source-file mirror only; AI verifies code in throwaway /tmp scratch before delivering.
- **Delivery mode (amends R7's letter, keeps its spirit):** AI writes COMPLETE files to the shared workspace and lists changed files in chat — no file bodies unless asked. Human pulls changed files to the Windows repo. Human's pasted content beats the mirror on any conflict.

## 2. Decisions log (append-only, newest last)

| Date | Decision | Why |
|---|---|---|
| 2026-08-21 | Track 01 with "money-safety layer" wedge | Differentiation in the most crowded track |
| 2026-08-22 | Node+Express; chat-paste AI workflow; OpenAI for buyer agent | User's fastest stack; existing keys |
| 2026-08-22 | Hand-rolled agent loop, no LangChain etc. | Defensibility at panel |
| 2026-08-22 | Gate-first build order (policy/audit Ph 2–5 before agent Ph 6) | Safety before intelligence |
| 2026-08-22 | Static UI, no React | Zero build step |
| 2026-08-22 | Bun replaces npm/Node; bun:sqlite; no dotenv → 4 deps | One toolchain, no native-module risk |
| 2026-08-22 | config.js bans live keys (`^rzp_test_`); WEBHOOK_SECRET/OPENAI_KEY optional until Ph 3/6 | Test-mode-only hard constraint |
| 2026-08-22 | SQL as prepared statements in db.js (+audit.js) | R5 + Arch §3 |
| 2026-08-22 | 14 seed products; CAT-LUNC-BOX catering deny ammo; IT-KEYB-MECH ₹2,499; IT-HUBB-4PT ₹1,899 | Phase 4+ boundary demos |
| 2026-08-22 | Delivery mode: files → workspace + changed-file list | Human request |
| 2026-08-23 | correlationId = missionId | Simplest defensible correlation |
| 2026-08-23 | POST /checkout w/o missionId → ad-hoc mission; POST /missions API at Ph 6 | Manual acceptance now, agent later |
| 2026-08-23 | Error classes local (RazorpayApiError→razorpay-client, TransitionError→missions, MoneyActionError→money-actions, Webhook*Error→webhooks). **PROPOSAL OPEN: src/errors.js at Ph 4 — awaiting human sign-off** | R4 typed errors, no file-map addition without approval |
| 2026-08-23 | SDK failure mid-action ⇒ audit "failed" + state untouched + surface (fail-closed R4) | Never retry silently |
| 2026-08-23 | smoke-order.js routes through money-actions.createOrder since Ph 2 | M3 grep green |
| 2026-08-23 | Ph 3: webhook idempotency row written AFTER successful processing (failed run never swallows Razorpay's retry; tiny race window accepted in demo) | Correctness of retry semantics beats micro-race |
| 2026-08-23 | Ph 3: confirmPayment trusts the API, not the webhook payload — re-fetches payment, re-checks amount vs order; mismatch ⇒ audit + state untouched | Webhook spoofing defense-in-depth |
| 2026-08-23 | Ph 3: `src/webhooks.test.js` ADDED (file-map addition, flagged for human sign-off same as errors.js) | Arch §11 + R8 mandate webhook tests; file map §3 omitted them |

## 3. Progress (update every phase)

- [x] Phase 0 — skeleton + smoke order ✅ 2026-08-22 first try, zero bugs
- [x] Phase 1 — catalog + quotes ✅ 2026-08-23, zero bugs (3×5990=17970 hand-verified)
- [x] Phase 2 — money core (stub policy) ✅ 2026-08-23 (order_TT7Q9dGQxRk6No, plink_TT7QAMNmZzPTZ8, paid & captured; 2 bugs: paymentLink singular, [object Object] cause)
- [ ] Phase 3 — webhooks — delivered 2026-08-23, awaiting acceptance · ⚠️ decision gate after
- [ ] Phase 4 — policy engine v1 + approvals (errors.js decision open)
- [ ] Phase 5 — audit store + dashboard UI
- [ ] Phase 6 — buyer agent + happy path E2E
- [ ] Phase 7 — failure playbook (6 scenarios)
- [ ] Phase 8 — polish, README, video prep · submitted? __

## 4. File status (only files that EXIST — AI: ask before assuming anything else)

```
agenttill/
├── package.json            ✅ scripts: dev·smoke·seed·test
├── .env.example ✅ · .gitignore ✅ · .env (human-only; NEEDS RAZORPAY_WEBHOOK_SECRET from Ph 3) · bun.lock (commit)
├── specs/                  ✅ PRD·Architecture·Rules·Phases·Design·Memory
├── docs/incident-log.md    human-only · 2 entries suggested 2026-08-23 (paymentLink singular · 4111 test-card) — human to write
├── src/
│   ├── config.js           ✅
│   ├── db.js               🔶 Ph3: +webhook_events, orders.payment_id migration, setOrderStatus, findOrderByPayment
│   ├── catalog.js          ✅
│   ├── audit.js            ✅ (appendEvent, getMissionTimeline)
│   ├── policy-rules.js     ✅ (data; engine consumes at Ph 4)
│   ├── policy-engine.js    ✅ (stub; real at Ph 4)
│   ├── razorpay-client.js  ✅ (4 methods; paymentLink SINGULAR)
│   ├── money-actions.js    🔶 Ph3: confirmPayment/noteFailedPayment/noteRefundProcessed live; retryPayment 501→Ph 7
│   ├── missions.js         ✅ (state machine)
│   ├── webhooks.js         🔶 Ph3 NEW: verifySignature (timingSafeEqual) → idempotency → dispatch
│   ├── webhooks.test.js    🔶 Ph3 NEW (file-map addition — SIGN-OFF PENDING): 5 tests green in scratch
│   ├── routes.js           ✅ (catalog/quote/checkout/missions)
│   └── server.js           🔶 Ph3: webhook route w/ express.raw registered FIRST
└── scripts/
    ├── smoke-order.js      ✅ (via money-actions)
    └── seed.js             ✅ (resets everything incl. webhook_events)
```
(✅ = acceptance-green · 🔶 = delivered, awaiting human acceptance paste)

## 5. Known bugs / quirks (append, never delete — fixed ones get ✅)

- Razorpay order JSON returns `notes: []` (empty **array**) when no notes sent; Ph 2 sent notes — checkout output showed order only pre-link; CONFIRM notes-object shape from a real webhook/fetch output when convenient.
- ✅ 2026-08-23: Arch §8 `rzp.paymentLinks.create` WRONG → SDK 2.9.8 exposes `rzp.paymentLink` (singular). Fixed.
- ✅ 2026-08-23: Razorpay SDK rejects with plain objects, not Errors — describeCause() handles it.
- ✅ 2026-08-23: 4111 … card rejected "international" on our test account despite docs. Instruments: UPI success@razorpay · MC 5267 3181 8797 5449 · netbanking mock.
- Ph 3 watch-points (verify from live output): payment entity `.status === "captured"` on payments.fetch; `payload.payment.entity` / `payload.refund.entity` shapes; `X-Razorpay-Event-Id` header presence.
- Windows PS: `curl` alias traps — acceptance pastes use `curl.exe -s`; POSTs need Content-Type json.

## 6. Backlog / ideas (P1-P2 parking lot — NOT to build without human ask)

paybot (puppeteer) · upsell mission archetype · LLM-written commentary lines on audit events · live websocket instead of polling.

## 7. Update protocol (for the AI)

After each phase: set `LAST UPDATED` + `CURRENT PHASE`; tick §3; rewrite §4 from what was actually built; append decisions to §2; append discovered quirks to §5; park scope-creep in §6. Output the FULL updated file. Keep it under ~150 lines — signal only, no prose.
