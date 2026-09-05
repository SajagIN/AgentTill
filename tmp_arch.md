# Architecture — AgentTill

**Stack (Backend) - Strictly Governed:**
| Layer | Choice | Why |
|---|---|---|
| Runtime/PM | **Bun 1.1+** (`bun install` / `bun run server.js`) | Blazing fast ESM runtimes. |
| HTTP | Express 4.x | Reliable web server wrapping the API and serving the static React build. |
| DB | SQLite via `bun:sqlite` (`import { Database } }`) | Zero native dependencies, single file WAL mode for high concurrency. |
| Payments | `razorpay` SDK v2 | Orders, Payment Links, Webhooks, Refunds. |
| LLM / Agent | Background loop using MCP (`@modelcontextprotocol/sdk`) | Standardized tool-calling and context boundaries. |

**Stack (Frontend) - The UI:**
| Layer | Choice | Why |
|---|---|---|
| Framework | **React 19** SPA via Vite (`/frontend`) | Modern declarative UI, components, real-time fetching. |
| Protection | `cleanFetch.ts` logic injected into SPA | Neutralizes unfixable Chrome extensions (e.g., Enable Copy) that violently clash with React 19's `startTime` DOM scheduling loops. |

---

## 1. System Overview (Theoretical vs Actual)

```text
                            ┌────────────────────────────────────────────────┐
                            │                 EXPRESS APP (src/server.js)    │
┌──────────────┐  HTTP/JSON │  routes.js (thin)                              │
│  BUYER AGENT │───────────►│   GET /catalog   POST /quote   POST /checkout  │
│ (agent loop) │◄───────────│   GET /missions/:id  POST /webhooks/razorpay   │
└──────┬───────┘  JSON +    │   GET /approvals  POST /approvals/:id/…        │
       │          statuses  │   GET /audit  POST /missions (create)          │
       ▼                    │                                                │
┌──────────────┐            │        EVERY money action:                     │
│ REACT 19 SPA │───────────►│        authorize() → execute → audit()         │
│ (Dashboard)  │            │            │                                   │
│  fetch() ->  │◄───────────│            ▼                                   │
└──────────────┘ (static    │  policy-engine.js (PURE)   money-actions.js    │
                 dist)      │  rules.js                  (the EXACT isolated │
                            │  audit.js (append-only)    module touching RZP)│
                            │  approvals.js                                  │
                            └────────────────────────────────────────────────┘
                                   │ SDK (test keys)
                                   ▼
                          Razorpay Test Mode 
```

## 2. API / Single Page App Fallback Routing
Since we migrated to a React 19 SPA, the Express server plays two roles:
1. `src/server.js` exposes all backend paths on `/api/*`. 
2. It statically serves `frontend/dist` on the root level `/`. 
Express explicit fallback: If any `GET` requests miss `/api/`, it returns `index.html` (React routing). If `/api/*` misses, it strictly returns JSON `{"error": "no such route"}` to prevent SyntaxErrors in the React app when `<!doctype` is served instead of JSON.

## 3. The Isolated Money Boundary (M1/M2 Boundaries)
To prevent hallucinations from inventing prices:
- **M1 (Agent Cart)**: The agent plans a set of SKUs. 
- **M2 (Database verification)**: `money-actions.js` iterates over the agent's cart, explicitly performing `SELECT price_paise FROM products WHERE id = ?`. If total mismatches, it throws a 422 immediately. 
- The generative AI NEVER dictates the `amount` param sent to the Razorpay SDK.

## 4. State Machine strict transitions
`PLANNING → QUOTED → POLICY_CHECK → PAYING → (AWAITING_APPROVAL → PAYING) → CONFIRMED`
`POLICY_CHECK → REJECTED (Agent automatically plans replan logic based off this signal)`

Invalid transitions throw `TransitionError`. `missions.js` is the sole authority on state.

## 5. Webhooks & Merkle Cryptography
- We use a 4-leaf cryptographic Merkle root of the invoice sum when transitions change to `CONFIRMED`.
- Idempotency is mandated: unique index on webhook `event_id` (`X-Razorpay-Event-Id`).
- `webhooks.js` uses `crypto.timingSafeEqual` over the `express.raw` unparsed body to validate the HMAC-SHA256 Razorpay signature.

## 6. Known Production Failures & Defensive Design
React 19 Schedulers bug: Third-party Chrome extensions (DevTools, Grammer Checkers) actively mutate the `requestIdleCallback` and `startTime` hooks native to React 19. **We explicitly bypass this on the frontend using `cleanFetch.ts`** that loads a hidden iframe, steals its unmangeld `window.fetch` object, and utilizes it for all frontend API calls.
