# 02 · Setup

## Requirements

[Bun](https://bun.sh) 1.2 or newer. Nothing else — SQLite is built into Bun, and there is no database server to install.

```bash
curl -fsSL https://bun.sh/install | bash
bun --version
```

## Install

```bash
git clone https://github.com/SajagIN/AgentTill.git
cd AgentTill
bun install
```

`bun install` covers both packages: the root `package.json` declares `frontend` as a Bun workspace, so one install resolves the backend dependencies and the React toolchain together.

## Configure

```bash
cp .env.example .env
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | Yes | — | Must start with `rzp_test_`. Live keys are rejected at boot. |
| `RAZORPAY_KEY_SECRET` | Yes | — | Must be non-empty. |
| `RAZORPAY_WEBHOOK_SECRET` | No | `""` | Needed only to receive signed webhooks. |
| `PORT` | No | `3000` | |
| `BASE_URL` | No | `http://localhost:3000` | Used for generated payment links. |
| `AGENTTILL_DB_PATH` | No | `<repo>/agenttill.db` | Override for tests or a throwaway database. |

Bun loads `.env` automatically — there is no `dotenv`. Values already present in the process environment win over the file, which is what lets the test suite override them.

`src/config.js` parses the environment with zod at import time. If anything is missing or malformed the process prints every problem and exits before opening a port, rather than failing later in a request.

### Which keys do you actually need?

Get test keys from the [Razorpay dashboard](https://dashboard.razorpay.com/app/keys) → Settings → API Keys.

Without real keys, everything up to the payment call works: missions plan, quote, get gated, wait for approval, and produce full audit trails and Merkle receipts. Those paths make no external call. Order creation returns a `502 RAZORPAY_API_ERROR`, the agent gives up after three attempts, and the mission is cancelled — with the reason in the audit trail.

## Run

```bash
bun run build     # backend bundle check + React dashboard → frontend/dist
bun run start     # serves the API and the dashboard on one port
```

Open <http://localhost:3000>.

The dashboard is served by the same Express process as the API, so there is exactly one thing to run and no second origin to configure.

## Develop

```bash
bun run dev
```

Starts both:

| | |
|---|---|
| API | <http://localhost:3000>, reloaded on file changes (`bun --watch`) |
| Dashboard | <http://localhost:5173>, Vite HMR, proxying `/api`, `/pay`, `/webhooks`, `/mcp`, `/health` to the API |

Work against `:5173` for hot reload. Both ports are identical in behaviour because the frontend only ever uses relative paths.

## Test

```bash
bun test          # 42 tests across 6 files
```

The suite is offline. Razorpay is stubbed at the module boundary and the end-to-end test binds an ephemeral port, so it runs alongside a live dev server without conflict.

## Scripts

| Command | What it does |
|---|---|
| `bun run build` | Bundles both backend entry points to prove imports resolve, then builds the SPA, then verifies `frontend/dist/index.html` exists |
| `bun run start` | Seeds the catalog and serves everything on `PORT` |
| `bun run dev` | API + Vite concurrently, with prefixed logs |
| `bun test` | Full suite |
| `bun run demo` | Scripted mission that trips the approval gate; prints the audit trail and Merkle root |
| `bun run seed` | Wipes demo data and re-seeds the 14-product catalog |
| `bun run smoke` | Live checkout against real Razorpay test keys |
| `bun run mcp` | MCP server over stdio |
| `bun run lint` | oxlint over the frontend |

## Receiving webhooks

Razorpay must reach you over the public internet. Use any tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then in the Razorpay dashboard → Settings → Webhooks, add `<tunnel-url>/webhooks/razorpay`, subscribe to `payment.captured`, `payment.failed` and `refund.processed`, and copy the signing secret into `RAZORPAY_WEBHOOK_SECRET`. Restart the server.

Until that secret is set, the webhook route fails closed with `503 WEBHOOK_SECRET_MISSING` rather than accepting unsigned events.

## Resetting

```bash
bun run seed
```

Clears approvals, webhook events, audit events, orders, missions, mandates, carts, negotiation sessions, and products in one transaction, then re-seeds the catalog. Policy configuration survives — it is operator state, not demo data.

Delete `agenttill.db`, `agenttill.db-wal` and `agenttill.db-shm` to start from a truly empty database.

## Troubleshooting the setup

| Symptom | Cause |
|---|---|
| `✖ agenttill: invalid environment` | `.env` is missing or a key is malformed. Every problem is listed above the exit. |
| `503 FRONTEND_NOT_BUILT` on `/` | Run `bun run build`. The API still works. |
| `EADDRINUSE` on start | Something else holds `PORT`. Set a different one in `.env`. |
| `503 WEBHOOK_SECRET_MISSING` | Expected until you configure `RAZORPAY_WEBHOOK_SECRET`. |
| `502 RAZORPAY_API_ERROR` on checkout | Placeholder or expired keys. Test mode also caps you at 30 payment links per hour. |

More in [`08-troubleshooting.md`](08-troubleshooting.md).
