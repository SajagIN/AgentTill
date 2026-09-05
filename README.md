# AgentTill

**An autonomous buyer agent you can actually let spend money.**

AgentTill takes a plain-language purchasing goal — *"restock: notebooks, markers, coffee"* — plans a cart, and attempts checkout on your behalf. Every rupee it touches passes through a deterministic policy engine first, and every decision it makes (including the ones where it was stopped) is written to an append-only, Merkle-verified ledger.

The premise is simple: the blocker for agentic commerce isn't intelligence, it's **trust**. No merchant hands an AI an API key with a blank cheque. AgentTill is the safety layer that sits between the agent and the money.

---

## What it does

| | |
|---|---|
| **Plans purchases from intent** | A buyer agent reads a mission, searches the catalog, and builds a cart. It re-plans itself when a policy denies it. |
| **Prices server-side, always** | The agent proposes SKUs. The server derives every total from the catalog and re-verifies it at order time. A hallucinated price cannot reach the payment gateway. |
| **Gates what matters** | Deny rules stop a purchase outright. The approval gate freezes it and waits for a human instead. |
| **Explains every verdict** | Each decision records the full rule-by-rule evaluation — what passed, what fired, and why. |
| **Proves its history** | Audit events fold into a 4-leaf Merkle tree per mission, so a removed or reordered row is detectable. |
| **Pays for real (in test mode)** | Razorpay orders, payment links, and HMAC-verified idempotent webhooks. Never live money. |
| **Speaks MCP** | Any MCP client can drive the same catalog, quote, purchase, and mandate tools. |

## Architecture

```
                        ┌──────────────────────────────────────────────────┐
                        │              Express app · src/server.js          │
  ┌───────────────┐     │                                                   │
  │  React 19 SPA │◄───►│   /api/*          routes.js                       │
  │  (dashboard)  │     │   /mcp            mcp-http.js                     │
  └───────────────┘     │   /pay/:orderId   checkout-page.js                │
                        │   /webhooks/*     webhooks.js                     │
  ┌───────────────┐     │                                                   │
  │  MCP client   │◄───►│   ┌────────────┐        ┌──────────────────────┐  │
  │  (any agent)  │     │   │   policy   │        │   money-actions.js   │  │
  └───────────────┘     │   │  engine.js │◄───────│  the ONLY module     │  │
                        │   │   (pure)   │        │  that may call       │  │
  ┌───────────────┐     │   └────────────┘        │  razorpay-client.js  │  │
  │  buyer agent  │────►│                         └──────────┬───────────┘  │
  │ src/agent/    │HTTP │   audit.js ── append-only ─────────┘              │
  └───────────────┘     │   merkle-receipt.js                               │
                        └──────────────────────────────────────────────────┘
                                              │
                                              ▼
                                    SQLite (WAL) · agenttill.db
                                              │
                                              ▼
                                       Razorpay test mode
```

The boundary that matters: **the agent never sets a price and never approves itself.** It proposes a cart over the public HTTP API like any external client. `src/money-actions.js` re-derives totals from the database, asks the policy engine, and only then touches the payment SDK.

→ Full detail in [`docs/01-architecture.md`](docs/01-architecture.md)

## The core loop

1. You create a **mission** — an intent plus a budget.
2. The buyer agent extracts keywords, searches the catalog, and picks items that fit the budget.
3. It requests a **quote**; the server prices it from the catalog and returns a `cartId`.
4. It attempts **checkout**. `money-actions.js` re-totals the cart from the database (any drift is a hard stop) and asks the policy engine.
5. The engine returns one of three verdicts:
   - **allow** → a Razorpay order and payment link are created; the mission goes `PAYING`
   - **deny** → no order is created; the mission goes `REJECTED` and the agent re-plans (dropping the most expensive item, up to twice)
   - **needs_approval** → the mission freezes at `AWAITING_APPROVAL`. No order exists yet.
6. A human approves or denies from the dashboard. Approving is what authorises the order.
7. Razorpay's signed webhook confirms the payment; the mission goes `CONFIRMED`.

Every one of those steps writes an audit event — including the denials.

## Quick start

**Requirements:** [Bun](https://bun.sh) 1.2 or newer.

```bash
git clone https://github.com/SajagIN/AgentTill.git
cd AgentTill

bun install                 # installs the backend and the frontend workspace
cp .env.example .env        # then add your Razorpay test-mode keys
bun run build               # builds the React dashboard into frontend/dist
bun run start               # serves the API and the dashboard on :3000
```

Open **http://localhost:3000**.

> **No Razorpay keys yet?** Everything except the final payment step still works. Missions plan, quote, get gated, wait for approval, and produce full audit trails and Merkle receipts — those paths make no external call. Add test keys from the [Razorpay dashboard](https://dashboard.razorpay.com/app/keys) to exercise real order creation. Keys must start with `rzp_test_`; live keys are rejected at boot.

### Scripts

| Command | What it does |
|---|---|
| `bun run build` | Bundles the backend (proving every import resolves), then builds the SPA |
| `bun run start` | Serves the API and the built dashboard on one port |
| `bun run dev` | API on `:3000` with reload + Vite on `:5173` with a proxy |
| `bun test` | Runs the suite (42 tests) |
| `bun run demo` | Scripted end-to-end mission with a printed audit trail and receipt |
| `bun run seed` | Resets the database and seeds the 14-product catalog |
| `bun run smoke` | Live smoke test of the checkout path (needs real test keys) |
| `bun run mcp` | Runs the MCP server over stdio |

## Policy rules

These are the actual defaults the engine enforces, seeded into `policy_configs`. Edit them live from the **Policies** page — no deploy, no model in the loop.

| Rule | Kind | Default | Effect |
|---|---|---|---|
| `mandate_ceiling` | Deny | per-buyer | Blocks a cart above an active buyer mandate |
| `max_basket_value` | Deny | ₹2,500 | Hard ceiling on a single cart |
| `hourly_spend_cap` | Deny | ₹5,000 | Rolling 60-minute spend ceiling across all missions |
| `velocity_max_checkouts_per_hour` | Deny | 4 | Caps checkout attempts per hour — stops retry storms |
| `category_allowlist` | Deny | office, it, supplies | Only these categories may be bought at all |
| `approval_above` | Gate | ₹1,000 | Amounts strictly above this pause for a human |
| `mission_budget` | Deny | per-mission | Blocks a cart above the mission's own budget |

Rules are pure functions with a fixed precedence: **any deny wins, then any gate, then allow.** Exact-equal to a limit passes. → [`docs/04-policies.md`](docs/04-policies.md)

## Money integrity

Four rules the codebase is built around:

- **M1 — integer paise everywhere.** Money is `amountPaise` in code, the database, and the API. Conversion to rupees happens only in the UI's `formatINR`.
- **M2 — server-side pricing.** Client- and agent-supplied amounts are ignored. `createOrder` re-totals from the catalog and hard-stops on any mismatch.
- **M3 — one money module.** `src/money-actions.js` is the only importer of `razorpay-client.js` and the only path that creates orders, links, or refunds. Every call runs `authorize() → execute → audit()`. A test asserts the SDK is never called on a deny.
- **M4 — no LLM near money.** The policy engine is deterministic code. It does not call a model, does arithmetic, verify signatures, or read secrets.

## MCP integration

AgentTill exposes its commerce surface over the Model Context Protocol, two ways:

```bash
# over HTTP (same process as the API)
curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# over stdio
bun run mcp
```

Eight tools: `search_catalog`, `request_quote`, `submit_machine_purchase`, `submit_commerce_rfq`, `accept_negotiation_offer`, `setup_autopay_mandate`, `get_autopay_status`, `revoke_autopay_mandate`.

The MCP tools hit the same policy engine and the same audit trail as the dashboard — there is no privileged path. → [`docs/06-mcp.md`](docs/06-mcp.md)

## Documentation

| | |
|---|---|
| [01 · Architecture](docs/01-architecture.md) | Components, request lifecycle, file map, boundaries |
| [02 · Setup](docs/02-setup.md) | Install, environment, running, building, development |
| [03 · API reference](docs/03-api.md) | Every endpoint with request and response shapes |
| [04 · Policies & money rules](docs/04-policies.md) | The rule engine, precedence, M1–M4 |
| [05 · Audit & receipts](docs/05-audit.md) | The event schema and Merkle verification |
| [06 · MCP integration](docs/06-mcp.md) | Tools, transports, client configuration |
| [07 · State machine](docs/07-state-machine.md) | Mission states and legal transitions |
| [08 · Troubleshooting](docs/08-troubleshooting.md) | Known failure modes and how the system responds |
| [09 · Decision log](docs/09-decision-log.md) | Why the architecture looks the way it does |
| [10 · Walkthrough](docs/10-walkthrough.md) | The narrated tour in text, plus a 5m27s audio version |
| [Product requirements](docs/prd.md) | Original scope, users, and explicit non-goals |

## Project layout

```
src/
  server.js           Express app: API, MCP, webhooks, static SPA
  routes.js           HTTP surface, validation at the edge
  config.js           Env parsing (zod), fail-fast on bad config
  db.js               Schema, prepared statements, migrations
  errors.js           Typed error hierarchy → HTTP mapping
  catalog.js          Product catalog and server-side quoting
  missions.js         State machine — sole authority on transitions
  policy-engine.js    Pure evaluation: rules in, verdict out
  policy-rules.js     The rules themselves
  money-actions.js    The money boundary (M3)
  razorpay-client.js  Thin SDK wrapper, only imported by money-actions
  approvals.js        The human gate
  audit.js            Append-only event store
  merkle-receipt.js   4-leaf SHA-256 receipts
  webhooks.js         HMAC verification, idempotency
  mandates.js         Buyer autopay mandates
  negotiation.js      Margin-floor counter-offers
  mcp-server.js       MCP tool definitions and handlers
  mcp-http.js         JSON-RPC over HTTP bridge
  checkout-page.js    Razorpay Standard Checkout fallback page
  agent/
    agent.js          The buyer loop: plan → quote → checkout → re-plan
    tools.js          Its HTTP client for the public API
frontend/src/
  App.tsx             Shell and routing
  views/              One file per page
  components/         Page header, timeline, receipt, shared UI
  components/ui/      shadcn primitives
  lib/                API client, formatters, types, state metadata
docs/                 Everything above
scripts/              build, dev, seed, demo, smoke
```

## Verification

```bash
bun test
# 42 pass · 0 fail · 6 files
```

The suite includes an end-to-end test that boots the real Express app and drives a mission over HTTP from creation to `CONFIRMED` through a signed webhook, plus gates proving the SDK is never called on a deny, forged webhook signatures change no state, and a tampered cart total is rejected before any money moves.

## Roadmap

- A2A reverse auctions between competing merchant agents
- Google AP2 mandate chains
- RazorpayX virtual cards to cap per-mission blast radius
- Refund UI (the API path exists; the dashboard does not expose it yet)

## Non-goals

Live payments, multi-tenant merchants, user authentication, and production databases. AgentTill is a safety-layer reference implementation, deliberately small enough to read end to end.
