# 09 · Decision log

Why AgentTill is shaped the way it is, including the decisions made while auditing and rebuilding it.

## Architecture

### One process, not microservices

The API, the dashboard, the MCP server, and the webhook receiver all live in a single Bun process. There is no queue, no second origin, and no CORS configuration to get wrong in production, because the browser and the API are the same origin.

The cost is that a crash takes everything down. For a system whose entire job is to be small enough to reason about, that is the right trade.

### The buyer agent talks to itself over HTTP

`src/agent/tools.js` calls `http://127.0.0.1:<port>/api/…` rather than importing the domain modules directly. This looks wasteful and is deliberate:

- It proves the public API is sufficient to drive a purchase, which is the product's actual claim.
- The agent gets no privilege an external MCP client does not have.
- Swapping the keyword-matching planner for an LLM later changes nothing about the trust boundary.

The base URL is set by `startServer()` from the port the server actually bound, so an in-process agent always reaches its own server regardless of what `BASE_URL` says.

### The policy engine is pure, but reads the database

`authorize()` performs no I/O itself, yet individual rules read their thresholds from `policy_configs`. That is a compromise: it keeps the engine trivially testable with a context object while letting an operator change limits live. The alternative — injecting every threshold through `ctx` — would push policy configuration into every caller.

Rules are re-read on every evaluation. There is no cache, so a `PUT /api/policies/:key` is effective on the next checkout with nothing to invalidate.

### SQLite, and `bun:sqlite` specifically

Zero native dependencies, single file, WAL mode. The schema is small, the workload is a single writer, and prepared statements are held as module constants so hot paths do not re-parse SQL.

`db.js` resolves the database path from the module's location, not the process working directory. Running the server from another directory used to silently create a second empty database.

### Money as integer paise

Floating point cannot represent decimal currency exactly, and `0.1 + 0.2 !== 0.3` is not an acceptable property in a checkout. Every amount is an integer count of paise from the database to the API. Formatting is confined to `formatINR` in the frontend.

The policy engine throws on a non-integer amount rather than rounding it. Silently rounding a money value is how a rounding error becomes a discrepancy nobody can explain later.

### The Merkle receipt is 4 leaves, not a real tree

A dynamically sized Merkle tree would be more standard. The fixed 4-leaf shape is what the product specifies and what the dashboard visualises, and it is honest about its limits: `docs/05-audit.md` states plainly that this is tamper-*evidence*, not non-repudiation, because an operator with database write access could recompute the whole tree. Anchoring the root externally is the missing piece and is out of scope.

### No LLM in the codebase

`OPENAI_API_KEY` and `OPENAI_MODEL` were configured but read by nothing. They have been removed. The buyer agent extracts keywords and matches them against the catalog — deterministic, auditable, and fast enough that a mission completes in well under a second.

The isolation that would matter if an LLM were added already exists: the agent reaches the system only through the HTTP API.

## What the audit changed

These are breakages found by reading and running the code, each verified before and after.

### The buyer agent could not reach the API

`src/agent/tools.js` called `/catalog`, `/quote`, `/checkout`, `/approvals/:id/…` and `/missions/:id`. Every route is mounted under `/api`. Every call fell through to the SPA catch-all, which returned `index.html` (or a `404` when the dashboard was not built), so `searchCatalog` always found nothing.

Every mission failed at once. Worse, the failure was classified as retryable, so the agent spun through twelve attempts with quadratic backoff — roughly nine minutes per mission — before giving up.

Fixed by prefixing the API base, and by classifying `400`, `404` and `422` as non-retryable so a routing mistake fails immediately instead of burning backoff. Verified end to end by `src/e2e.test.js`.

### The audit view could not render its own data

`AuditView.tsx` read `event.event_type`, `event.created_at` and `event.payload_json`. The API returns `action`, `ts`, and structured `decision`/`entities` fields. `JSON.parse(undefined)` threw during render, taking the whole page down with no error boundary.

Rebuilt against the real shape, and the e2e suite now asserts the exact field names the UI reads, so this cannot regress silently.

### A state that does not exist

Two components compared `mission.state === "COMPLETED"`. The state machine emits `CONFIRMED`; `COMPLETED` appears nowhere in the backend. The Overview's "Confirmed" counter was permanently zero and the Missions badge never showed success.

State display now comes from one module, `frontend/src/lib/mission-states.ts`, derived from the real state list.

### The dev proxy did not match the app

`vite.config.ts` proxied `/missions`, `/approvals`, `/catalog` and friends. The SPA calls `/api/*`. Development mode could not reach the backend at all.

### The payment fallback link was wrong

`money-actions.js` built `http://localhost:3000/pay/<id>`. That route was mounted under `/api`, so the link 404'd — and the host was hardcoded regardless of `BASE_URL`. The checkout page is now a top-level route rendered from its own module, and the link is built from `config.baseUrl`.

### A missing internal path in an error

The SPA fallback used `res.sendFile` on a path that might not exist, surfacing `ENOENT: … /home/user/…/frontend/dist/index.html` to the client. Replaced with an explicit existence check and a `503 FRONTEND_NOT_BUILT` that says what to run.

### `resetDemoData` left data behind

`clearNegSessionsStmt` was declared and never used, so a "reset" left stale negotiation sessions. Added to the transaction.

### Hand-rolled error objects

Four modules each attached `status` and `code` to a plain `Error` by hand. Replaced with a single `AppError` hierarchy in `src/errors.js`; the Express middleware now distinguishes "a message we chose to send" from "a bug we should not leak" by type rather than by duck-typing.

## What was removed

| Removed | Why |
|---|---|
| `tmp_arch.md`, `tmp_rules.md` | Working notes. `tmp_rules.md` banned React, Tailwind and TypeScript — the exact stack the frontend uses. |
| `config.yml` | Contained `{}`. |
| `research.md` | Overlapped `docs/Research.md`; the durable content is here and in `04-policies.md`. |
| `src/agent/prompts.js` | Exported a system prompt nothing imported. |
| `frontend/src/App.css` | Vite template CSS, imported nowhere. |
| `frontend/src/assets/*` | Three unreferenced images. |
| `frontend/public/icons.svg` | Unreferenced. |
| `frontend/README.md` | Stock Vite template text. |
| `docs/DOCS_LOOP_TRACKER.md` | A checklist pointing at six files that do not exist. |
| `docs/00_DOCUMENTATION_GUIDE.md` | Process meta-documentation describing a hierarchy the repo does not follow. |
| `frontend/tsconfig.app.tsbuildinfo` | A committed build artifact. Now gitignored. |
| `OPENAI_*` config | Read by nothing. |
| `shadcn` devDependency in the root | The CLI belongs to the frontend workspace, if anywhere. |

Seven of the eight shadcn components were also unused — the views used raw HTML elements. They are now used, and the views are consistent with them.

## Things deliberately left alone

**The `cleanFetch` iframe trick.** It is unusual, and the specific extension conflict is a diagnosis from the original investigation that was not reproduced here. It is retained because the cost is one hidden iframe and it fails safe: if the iframe cannot be created, it falls back to the global `fetch`. It now lives in `lib/api.ts` with the claim stated as a diagnosis rather than a fact.

**`velocity_max_checkouts_per_hour` versus `velocity_max_checkouts`.** The rule id and the config key differ. Renaming the key would need a migration for existing databases; the mismatch is documented in `04-policies.md` instead.

**Negotiation and mandates have no dashboard.** Both are reachable over the API and MCP. Exposing them in the UI is a product decision, not a gap in the plumbing, and building it unprompted would have added surface area nobody asked for.

**`bun run smoke` needs real keys.** It exercises the live Razorpay path, so it cannot run offline. That is inherent to what it tests; the offline equivalent is the e2e suite.

## Reference material

The README structure was asked to draw on `Benny45123/agentic-merchant-os`. That repository has no README on its default branch, so there was no prose to model. Its file tree was read instead: it is a FastAPI project with the same conceptual parts — catalog, commerce agent, a "guardian" policy layer, Razorpay integration, Merkle receipts, autopay mandates, and an MCP server — which is a useful confirmation that AgentTill's decomposition is not idiosyncratic. No code or copy was taken from it.
