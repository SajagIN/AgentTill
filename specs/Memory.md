# Memory — AgentTill
> **Living save file.** Paste at the top of EVERY new chat. The AI appends/updates after each phase; the human saves the file. Never let the codebase and this file drift apart — a fact not in here doesn't exist.

**LAST UPDATED:** 2026-08-23 · Phase 1 accepted GREEN · Phase 2 delivered (awaiting acceptance)
**CURRENT PHASE:** 2 — Money core: four money actions w/ allow-all policy stub (checkout, pay link, audit row)

## 1. Project facts (stable — update rarely)

- AgentTill: AI buyer agent + deterministic policy gate + append-only audit trail, on Razorpay **test mode only**. Razorpay AI Buildathon Track 01. Solo, deadline Sep 5 2026, submit by Sep 4.
- Stack frozen: **Bun** (runtime + PM + test runner; never npm/node directly), ESM JS (no TS), Express 4, `bun:sqlite` (built-in), official `razorpay` + `openai` SDKs, zod. **4 deps total, ever** (express, razorpay, openai, zod; openai installs at Phase 6). `.env` auto-loaded by Bun. No frameworks. Tests via `bun:test`.
- Sources of truth: PRD.md (what), Architecture.md (how, file map §3), Rules.md (hard constraints), Phases.md (order + acceptance), Design.md (UI).
- `.env` vars: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`(Ph 3+), `OPENAI_API_KEY`(Ph 6+), `OPENAI_MODEL`, `PORT`, `BASE_URL`.
- Money law: integer paise everywhere; 4 money actions only (`create_order`, `confirm_payment`, `retry_payment`, `refund`) all in `money-actions.js` as `authorize → execute → audit`; deny ⇒ zero SDK calls (test-proven Ph 4); LLM never touches money logic; `razorpay-client` importable ONLY by `money-actions` (grep test).
- Demo instruments: card `4111 1111 1111 1111` (any future expiry/CVV) · UPI `success@razorpay` / `failure@razorpay`.
- Human runs on Windows PowerShell, repo at `D:\razorpay buildathon\AgentTill`. AI sandbox = source-file mirror only (no node_modules, no db); AI verifies code in throwaway /tmp scratch before delivering.
- **Delivery mode (amends R7's letter, keeps its spirit):** AI writes COMPLETE files to the shared workspace and lists changed files in chat — no file bodies in chat unless asked. Human pulls changed files to the Windows repo. If a local file ever diverges from the mirror, the human's pasted content is ground truth.

## 2. Decisions log (append-only, newest last)

| Date | Decision | Why |
|---|---|---|
| 2026-08-21 | Track 01 with "money-safety layer" wedge, not generic shopping agent | Differentiation in the most crowded track |
| 2026-08-22 | Node+Express over FastAPI; chat-paste AI workflow; OpenAI for buyer agent | User's fastest stack; existing keys |
| 2026-08-22 | Hand-rolled agent loop, no LangChain etc. | Defensibility at panel + AI-judgment criterion |
| 2026-08-22 | Gate-first build order: policy/audit (Ph 2–5) before agent (Ph 6) | Safety layer before intelligence |
| 2026-08-22 | Static UI, no React | Zero build step |
| 2026-08-22 | **Bun replaces npm/Node**; `bun:sqlite`; no dotenv → 4 deps | One toolchain, no native-module risk |
| 2026-08-22 | config.js bans live keys (`^rzp_test_`); WEBHOOK_SECRET/OPENAI_KEY optional until Ph 3/6 | Test-mode-only is a hard PRD constraint |
| 2026-08-22 | `smoke-order.js` temporary direct SDK import until Phase 2 rewrite | Phases.md fluency order; **executed 2026-08-23: smoke now routes through money-actions.createOrder, grep test green** |
| 2026-08-22 | All SQL as prepared statements in `db.js` (+ `audit.js`); modules call functions | R5 + Arch §3 both satisfied |
| 2026-08-22 | 14 seed products, 4 categories; `CAT-LUNC-BOX` = catering deny ammo; `IT-KEYB-MECH` ₹2,499 (₹1 under max_basket); `IT-HUBB-4PT` ₹1,899 (trips approval_above alone) | Phase 4+ boundary demos |
| 2026-08-22 | Delivery mode: complete files → shared workspace + changed-file list in chat | Human request; R7 spirit intact |
| 2026-08-23 | **correlationId = missionId** (one id spans mission + audit timeline) | Simplest defensible correlation; replay query = WHERE correlation_id=? |
| 2026-08-23 | `POST /checkout {cartId}` with no missionId auto-creates ad-hoc mission (intent "manual checkout"); `POST /missions` API arrives Phase 6 | Phase 2 acceptance is manual curl; no agent yet |
| 2026-08-23 | Error classes live LOCAL for now: `RazorpayApiError`→razorpay-client.js, `TransitionError`→missions.js, `MoneyActionError`→money-actions.js (all carry .status/.code; express error mw duck-types). **PROPOSED: `src/errors.js` shared home at Phase 4 — awaiting human approval (file-map addition)** | R4 typed errors without inventing a file early |
| 2026-08-23 | SDK failure mid-money-action ⇒ append `outcome:"failed"` audit event, mission state left UNTOUCHED (sits in POLICY_CHECK), error surfaced | R4 fail-closed |

## 3. Progress (update every phase)

- [x] Phase 0 — skeleton + smoke order ✅ 2026-08-22 first try, zero bugs (order_TSsQ7BTJJnLxdU)
- [x] Phase 1 — catalog + quotes ✅ 2026-08-23, zero bugs (quote math hand-verified: 3×5990=17970)
- [ ] Phase 2 — money core (stub policy) — delivered 2026-08-23, awaiting acceptance
- [ ] Phase 3 — webhooks · ⚠️ decision gate after (passed? __)
- [ ] Phase 4 — policy engine v1 + approvals (needs errors.js decision)
- [ ] Phase 5 — audit store + dashboard UI
- [ ] Phase 6 — buyer agent + happy path E2E
- [ ] Phase 7 — failure playbook (6 scenarios)
- [ ] Phase 8 — polish, README, video prep · submitted? __

## 4. File status (only files that EXIST — AI: ask before assuming anything else)

```
agenttill/
├── package.json            ✅ scripts: dev·smoke·seed
├── .env.example ✅ · .gitignore ✅ · .env (human-only, real test keys) · bun.lock (human-generated, commit)
├── specs/                  ✅ PRD·Architecture·Rules·Phases·Design·Memory
├── docs/incident-log.md    human-only · entries so far: 0
├── src/
│   ├── config.js           ✅ (zod env guard, live-key ban)
│   ├── db.js               🔶 Ph2: + missions·orders·audit_events schema & stmts; resetDemoData wipes all
│   ├── catalog.js          ✅ (14 products, quoteItems, persistQuote)
│   ├── audit.js            🔶 Ph2 NEW: appendEvent + getMissionTimeline (append-only law)
│   ├── policy-rules.js     🔶 Ph2 NEW: 5 rule definitions as DATA (engine consumes them in Ph 4)
│   ├── policy-engine.js    🔶 Ph2 NEW: authorize() STUB — allow-all, reason "phase2-stub", pure
│   ├── razorpay-client.js  🔶 Ph2 NEW: 4 thin methods + RazorpayApiError wrap
│   ├── money-actions.js    🔶 Ph2 NEW: createOrder+refund live; confirmPayment/retryPayment honest 501 stubs
│   ├── missions.js         🔶 Ph2 NEW: state machine (Arch §7 table), TransitionError 409
│   ├── routes.js           🔶 Ph2: + POST /checkout, GET /missions (eventCount); async wrap
│   └── server.js           🔶 Ph2: + express error middleware (status/code mapping, 500 logs stack only)
└── scripts/
    ├── smoke-order.js      🔶 Ph2 REWRITTEN: quote→money-actions.createOrder→prints order+link+timeline (no SDK import)
    └── seed.js             ✅ (resets everything via db.resetDemoData)
```
(✅ = acceptance-green · 🔶 = delivered, awaiting human acceptance paste)

## 5. Known bugs / quirks (append, never delete — fixed ones get ✅)

- Razorpay order JSON returns `notes: []` (empty **array**) when no notes are sent — real Ph 0 output. Ph 2 sends notes {correlationId, missionId}: VERIFY returned shape from real checkout output.
- Windows PS: `curl` alias = Invoke-WebRequest (mshtml prompt); `Invoke-RestMethod` truncates tables (hid totalPaise once). **Acceptance pastes: always `curl.exe -s`.** POSTs need `Content-Type: application/json`.
- Ph 2 watch-point: `paymentLinks.create` response — Architecture §8 says `short_url`; verify against real checkout output (R6).

## 6. Backlog / ideas (P1-P2 parking lot — NOT to build without human ask)

paybot (puppeteer) · upsell mission archetype · LLM-written commentary lines on audit events · live websocket instead of polling.

## 7. Update protocol (for the AI)

After each phase: set `LAST UPDATED` + `CURRENT PHASE`; tick §3; rewrite §4 from what was actually built; append decisions to §2; append discovered quirks to §5; park scope-creep in §6. Output the FULL updated file. Keep it under ~150 lines — this file is pasted constantly; signal only, no prose.
