# Memory — AgentTill
> **Living save file.** Paste at the top of EVERY new chat. The AI appends/updates after each phase; the human saves the file. Never let the codebase and this file drift apart — a fact not in here doesn't exist.

**LAST UPDATED:** 2026-08-23 · Phase 3 ✅ + GATE PASSED (Track 01 committed) · Phase 4 delivered (awaiting acceptance)
**CURRENT PHASE:** 4 — Real policy engine (6 rules) + approvals (gate/approve/deny + resume)

## 1. Project facts (stable — update rarely)

- AgentTill: AI buyer agent + deterministic policy gate + append-only audit trail, on Razorpay **test mode only**. Razorpay AI Buildathon Track 01. Solo, deadline Sep 5 2026, submit by Sep 4.
- Stack frozen: **Bun** (never npm/node directly), ESM JS, Express 4, `bun:sqlite`, official `razorpay` + `openai` SDKs, zod. **4 deps total, ever** (openai installs at Phase 6). `.env` auto-loaded. Tests via `bun:test`.
- Sources of truth: PRD.md · Architecture.md (file map §3) · Rules.md · Phases.md · Design.md.
- `.env` vars: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`(= dashboard secret), `OPENAI_API_KEY`(Ph 6+), `OPENAI_MODEL`, `PORT`, `BASE_URL`.
- Money law: integer paise everywhere; 4 money actions in `money-actions.js` as `authorize → execute → audit`; deny/gate ⇒ zero SDK calls (test-proven); LLM never touches money logic; `razorpay-client` imported only by `money-actions` (grep green).
- **GATE PASSED 2026-08-23 → Track 01 committed through the deadline. No more pivoting.**
- Demo instruments: domestic MC `5267 3181 8797 5449` (confirmed working, last4 5449) · netbanking mock SUCCESS/FAILURE buttons (failure path, confirmed live Ph 3) · UPI absent on our link pages — don't rely on `success@razorpay`/`failure@razorpay`.
- Human on Windows PowerShell, repo `D:\razorpay buildathon\AgentTill`. AI sandbox = source mirror; verifies in throwaway /tmp scratch before delivering. Delivery: complete files → workspace + changed-file list; human's pasted content beats mirror on conflict.

## 2. Decisions log (append-only, newest last)

| Date | Decision | Why |
|---|---|---|
| 2026-08-21→22 | Track 01 money-safety wedge · hand-rolled agent loop · gate-first build order · static UI · Bun/bun:sqlite/4 deps | (as before) |
| 2026-08-22 | SQL in db.js/audit.js prepared statements; live-key ban in config; smoke via money-actions since Ph 2 | (as before) |
| 2026-08-23 | correlationId = missionId; ad-hoc missions for manual checkout; error classes local to their single consumers (errors.js proposal still open, now likely unnecessary — routes shape responses directly) | (as before) |
| 2026-08-23 | SDK failure ⇒ audit "failed" + state untouched (fail-closed) | R4 |
| 2026-08-23 | Webhook idempotency row written AFTER successful processing; confirmPayment trusts API not payload | Correct retry semantics |
| 2026-08-23 | **Ph 4: 6 rules** — the 5 spec'd + `mission_budget` as a 6th rule (data-driven in policy-rules.js; engine stays branch-free, iterates rule list) | Arch §5 "budget enforced as additional bound" + keeps engine generic |
| 2026-08-23 | Ph 4: policy reasons/details quote **paise only** ("189900 paise"), never ₹ strings — M1 says formatting is UI-only (formatINR lands Ph 5) | M1 purity in the trust layer |
| 2026-08-23 | Ph 4: velocity counts succeeded+failed checkout attempts (gated/denied never moved money ⇒ don't consume velocity); hourly spend counts succeeded only; scope = global (single merchant) | Honest semantics, demoable |
| 2026-08-23 | Ph 4: approve-resume path — AWAITING_APPROVAL → POLICY_CHECK added to state machine; resume re-runs ALL bounds, ctx.approvalResolved satisfies ONLY the approval gate; approval validated (status+mission+cart match) | A resume is a new checkout attempt; only the human's decision carries over |
| 2026-08-23 | Ph 4: `src/money-actions.test.js` added (file-map addition, flagged like webhooks.test.js) — booby-trap stubs via `mock.module`, call-count deltas | R8 mandates the deny⇒zero-SDK proof |
| 2026-08-23 | Ph 4 bugs caught in scratch BEFORE delivery: stale mission state after transition() (re-assign return value); hourly-cap tests originally used basket-busting amounts | Scratch-verify discipline pays |

## 3. Progress (update every phase)

- [x] Phase 0 — skeleton + smoke ✅ 2026-08-22 zero bugs
- [x] Phase 1 — catalog + quotes ✅ 2026-08-23 zero bugs
- [x] Phase 2 — money core ✅ 2026-08-23 (2 bugs: paymentLink singular, plain-object SDK errors)
- [x] Phase 3 — webhooks ✅ 2026-08-23 (human-confirmed green: CONFIRMED/FAILED/forged-401; 1 bug: link-internal order_id correlation) · **⚠️ GATE PASSED → Track 01 committed**
- [ ] Phase 4 — policy engine v1 + approvals — delivered 2026-08-23, awaiting acceptance
- [ ] Phase 5 — audit store + dashboard UI
- [ ] Phase 6 — buyer agent + happy path E2E
- [ ] Phase 7 — failure playbook (6 scenarios)
- [ ] Phase 8 — polish, README, video prep · submitted? __

## 4. File status (only files that EXIST — AI: ask before assuming anything else)

```
agenttill/
├── package.json            ✅ scripts: dev·smoke·seed·test
├── .env.example ✅ · .gitignore ✅ (incl. cloudflared.exe) · .env (human-only) · bun.lock (commit)
├── specs/                  ✅ 6 docs + Memory
├── docs/incident-log.md    human-only · 3 entries suggested so far (paymentLink · 4111 card · link-internal order_id)
├── src/
│   ├── config.js ✅ · catalog.js ✅ · missions.js ✅ (+AWAITING→POLICY_CHECK)
│   ├── db.js               🔶 Ph4: +approvals table/stmts/fns
│   ├── audit.js            🔶 Ph4: +getCheckoutWindowStats (hourly spend + attempt counts from audit trail)
│   ├── policy-rules.js     🔶 Ph4 REWRITE: 6 rules as data+pure evaluators (basket 250000 · hourly 500000 · velocity 4/hr · categories office,it,supplies · approval>100000 · mission_budget)
│   ├── policy-engine.js    🔶 Ph4 REWRITE: real authorize() — precedence fail>triggered>pass; M1 int guard
│   ├── policy-engine.test.js 🔶 NEW: 20 cases (boundaries, precedence, applicability, M1)
│   ├── money-actions.js    🔶 Ph4: real ctx, needs_approval branch (no SDK), approvalId resume path
│   ├── money-actions.test.js 🔶 NEW (flagged): booby-trap stubs; deny/gate ⇒ 0 SDK calls; resume ⇒ exactly 1
│   ├── approvals.js        🔶 Ph4 NEW: create/list/resolve + audit "approval_resolved" (human fingerprints)
│   ├── razorpay-client.js ✅ · routes.js 🔶 (+/approvals, approve→resume, checkout 200 on gate) · server.js ✅
│   ├── webhooks.js ✅ (+payload logging) · webhooks.test.js ✅ (6)
└── scripts/ smoke-order.js ✅ · seed.js ✅ (wipes all incl. approvals)
```

## 5. Known bugs / quirks (append, never delete — fixed get ✅)

- ✅ Arch §8 `rzp.paymentLinks` → SDK has `paymentLink` (singular), v2.9.8.
- ✅ Razorpay SDK rejects with plain objects, not Errors — describeCause() handles.
- ✅ 4111 … test card rejected as "international" on our account — use MC 5267 …/netbanking mock.
- ✅ Link payments carry the link's INTERNAL order_id; our notes propagate to payment entity; correlation via notes.missionId → findLatestOrderByMission; amounts re-verified via API. payment_link.paid entity = internal order whose receipt = our order id.
- ✅ 2026-08-23 Ph4: stale mission state after transition() (must re-assign its return) — caught in scratch, never shipped.
- bun:test `mock.calls` counts are cumulative across a file — assert DELTAS, not absolutes (bit us once).
- Dashboard webhook URL must track the CURRENT cloudflared quick-tunnel URL (changes on restart).
- Windows PS: acceptance pastes use `curl.exe -s`; POSTs need Content-Type json.

## 6. Backlog / ideas (P1-P2 parking lot — NOT to build without human ask)

paybot (puppeteer) · upsell mission archetype · LLM-written commentary lines on audit events · websocket instead of polling · Discord forwarder (post-Ph 8; PRD P2 non-goal until then).

## 7. Update protocol (for the AI)

After each phase: set `LAST UPDATED` + `CURRENT PHASE`; tick §3; rewrite §4; append §2 decisions + §5 quirks; park scope-creep in §6. Output the FULL updated file. Under ~150 lines; signal only.
