# Rules — AgentTill
**These are hard constraints, not suggestions. If a request from the human conflicts with a rule, flag it before coding.**

## R1 · Toolchain & dependencies (frozen)

**Toolchain — Bun for everything:** install with `bun add`, run with `bun run <script>` or `bun <file>`, watch with `bun --watch`, test with `bun test`. **Never invoke `npm`, `npx`, or `node` directly** — Bun runs the same code. `bunx` for one-off binaries only with human approval. Commit the lockfile Bun generates (`bun.lock`/`bun.lockb`).

**Allowed (exactly these 4 deps):** `express@^4.19`, `razorpay`, `openai`, `zod`.
**Built into Bun — use these, never install equivalents:** SQLite via `import { Database } from "bun:sqlite"`, `.env` auto-loading (no dotenv), `bun:test` test runner, global `fetch`, `node:crypto` (`createHmac` + `timingSafeEqual` work under Bun).

**Banned:** any agent/LLM framework (LangChain, LlamaIndex, CrewAI, AutoGen, Vercel AI SDK), any ORM (Prisma, Knex, Sequelize), TypeScript & build steps, `axios` (use global `fetch`), `lodash`, `moment`/`date-fns` (use `Intl`/`Date`), React/Vue/Next, Tailwind, Docker, `nodemon`, `better-sqlite3`, `dotenv`. Adding ANY dependency requires explicit human approval in the chat. If a task seems to need one, propose the built-in/Bun alternative instead.

**Escape hatch (Node fallback — human sign-off required first):** if a Bun-specific blocker appears, the codebase stays Node-portable: run `node --env-file=.env --watch src/server.js`, swap `bun:sqlite` → `better-sqlite3` and `bun:test` → `node:test` (APIs are near-identical, ~5 lines change).

## R2 · Money integrity

- **M1 — Integer paise everywhere.** Money is `amountPaise` (int) in code, DB, and API. ₹1 = `100`. **Never** `parseFloat`/`Number("12.34")` on money; never store floats; `Math.round` only at the paise boundary if dividing. Formatting to "₹1,234.00" happens ONLY in the UI via one helper (`formatINR(paise)` using `Intl.NumberFormat('en-IN')`).
- **M2 — Server-side pricing.** Client/agent-supplied amounts are ignored. Totals are computed from `catalog.js` prices. The order amount is re-derived and compared at order creation; any quote→order mismatch > 0 paise is a hard stop.
- **M3 — Four money actions only.** `src/money-actions.js` is the only module that may import `razorpay-client.js` and the only code path that creates orders/payments/refunds. Every call inside it follows `authorize() → execute → audit()`. If the policy result is `deny`, the SDK MUST NOT be called (there is a test asserting this).
- **M4 — No LLM near money logic.** The policy engine is pure deterministic code. The LLM never computes totals, never decides authorization, never constructs webhook or signature logic, never sees secrets.

## R3 · Security

- Secrets only via `.env` (in `.gitignore` — Bun auto-loads it, no code reads the file); `.env.example` committed with fake values. Never print/log keys or the webhook secret; error messages must not embed them.
- Webhook handler: register `express.raw({ type: "application/json" })` on the webhook route **before** any JSON body parser; verify `X-Razorpay-Signature` = HMAC-SHA256(raw body, `RAZORPAY_WEBHOOK_SECRET`) using `crypto.timingSafeEqual`; only then `JSON.parse`. Invalid → 401, log, no state change.
- Idempotent webhook processing keyed on `X-Razorpay-Event-Id` (unique DB index).
- Zod-validate every request body at the route edge; reject unknown fields where cheap.
- No `eval`, no `Function()` constructor, no shell-outs, no dynamic `require`/import of user input, no CORS wildcard in demo (same-origin static UI).
- Refund amount must be ≤ captured amount (policy + code check).

## R4 · Error handling

- No silent failures: no empty `catch`, no `catch(e){}` swallowing. Every caught error is either handled explicitly or rethrown wrapped.
- Typed error classes extending a base `AppError`: `PolicyDeniedError`, `TransitionError`, `WebhookVerificationError`, `RazorpayApiError`, `ValidationError`. Express error middleware maps them: `ValidationError`→400, `WebhookVerificationError`→401, `PolicyDeniedError`→403 (with ruleEvals), `TransitionError`→409, `AppError`→ its `.status`, unknown→500 + logged stack, never leaked to client.
- Consistent error body: `{ "error": { "code": "POLICY_DENIED", "message": "…", "ruleEvals": [...] } }`.
- **Fail closed:** on any uncertainty in a money path (SDK error mid-flow, ambiguous payment state, missing webhook secret) → stop, mark mission `ESCALATED` or leave state untouched, audit an `info`/`failed` event, surface to the human. Never "retry silently to make it work."
- All async route handlers wrapped; `process.on('unhandledRejection'|'uncaughtException')` → log and exit for the latter.
- Every SDK/network call wrapped with context (what operation, which ids) so logs are greppable.

## R5 · Code style & structure

- ESM (`import`), running on Bun (global `fetch`; `node:crypto` via Bun's Node compat; tests import from `bun:test`, never `node:test`). One concern per file; files < ~300 lines; no dead code; no TODO comments left in "finished" phases.
- JSDoc on exported functions (params/returns). `camelCase` in code; DB columns `snake_case`; money fields always suffixed `Paise`.
- The file map in Architecture.md §3 is the source of truth. Don't invent files; if a new file is genuinely needed, propose it first and add it to Memory.md after approval.
- SQL lives in `db.js`/`audit.js` (prepared statements), never concatenated with user input.
- Time in DB is ISO-8601 UTC strings; UI renders IST.

## R6 · Truthfulness about external APIs (critical in a chat-paste workflow)

- You cannot browse. **Never invent Razorpay or OpenAI SDK fields, response shapes, event names, or method signatures.** Use only what Architecture.md §8–§9 specifies; if a task needs something not specified, ask the human to paste the relevant docs section (they have the Razorpay dashboard + docs open).
- If you're unsure whether an SDK method exists, say so and provide a runtime-safe approach (e.g., verify by a tiny script the human runs) instead of confidently writing plausible-looking code.
- Never fabricate test results, payment ids (`pay_…`/`order_…` must come from real output the human pastes), or "this was tested" claims.

## R7 · Workflow (chat-paste protocol)

- You cannot see the repo. When you need a file's current content, **ask the human to paste it** — never assume prior file state, even mid-phase.
- Output complete files only: full contents, path as a header above each code block. No fragments, no "unchanged" elisions. If a file grows > ~300 lines, propose a split.
- One phase at a time per Phases.md. A phase ends only when the human pastes passing acceptance output. If acceptance fails, diagnose from the real pasted output before changing code — and when the root cause is found, also suggest (do not write) a one-line `docs/incident-log.md` entry for the human.
- After each phase: output the updated `Memory.md` (full file, per its protocol) for the human to save.
- Push back on scope creep by quoting PRD.md non-goals. "Nice to have" goes to the P1/P2 lists in Memory.md, not into code.
- When the human pastes an error, first state your diagnosis in one or two sentences, then the fix. Teach, don't just dump code — the human must defend this at a technical panel.

## R8 · Testing gates

- `policy-engine.test.js` ≥ 15 cases including boundaries (amount == limit passes) and precedence (deny beats gate beats allow).
- Webhook tests: forged signature rejected with zero state change; duplicate delivery processed once.
- Money-action test with stubbed SDK client (test-only): deny path → SDK call count 0.
- `bun run demo` must be green twice consecutively before Phase 8 closes.
