# AgentTill

An autonomous buyer agent for strictly governed B2B procurement. AgentTill parses human intent, generates carts, enforces complex corporate spend policies, and creates Razorpay payment links — all recorded on an immutable, Merkle-verified SQLite ledger.

## Architecture Map (Actual State)

AgentTill runs an **Express backend** and a **React SPA frontend**.

- **Frontend** (`/frontend`): React 19 single-page app (Vite) that interacts with the agent. Uses a specific `fetch` iframe bypass (`cleanFetch.ts`) to avoid third-party Chrome extensions freezing the React scheduler.
- **Backend / API** (`/src/server.js`): Exposes REST endpoints (`/api/missions`, `/api/approvals`, etc.) and serves the React SPA statically from `/frontend/dist`.
- **Database** (`/agenttill.db`): SQLite 3 database operating in WAL mode. Contains catalogs, policies, and an immutable `audit_events` ledger.
- **Autonomous Agent** (`/src/agent.js`): A background control loop reading intents from the DB and pushing them through checkout.
- **Payment Boundary** (`/src/money-actions.js`): Hard boundary isolated from AI. Retotals carts directly from the database and generates Razorpay Payment Links. No generative AI can manipulate pricing.

## The Core Loop (How it works)
1. **User** visits the dashboard and creates a Mission (e.g., "Buy an ergonomic desk").
2. **Backend Agent** periodically wakes up, finds `PLANNING` missions.
3. **Agent** checks `/api/catalog`, maps intent to actual DB products.
4. **Agent** quotes the items `/api/quote`.
5. **Agent** attempts checkout `/api/checkout`.
6. **Policy Engine** (`/src/policy-engine.js`) evaluates cart against limits (e.g., velocity limits, value limits). 
    - If denied (e.g. over 1000 threshold), the mission enters `AWAITING_APPROVAL`.  
    - If approved, it calls Razorpay and advances to `PAYING`.
7. **Admins** can view Awaiting actions via the dashboard and approve/deny them, generating cryptographic Merkle receipts in the audit log.

## Run Locally

### Requirements
- [Bun v1.2+](https://bun.sh/)
- Razorpay API Test Mode keys.

### Start Up

```bash
# 1. Clone
git clone https://github.com/SajagIN/agent-till.git
cd agent-till
bun install

# 2. Configure Environment
cp .env.example .env
# Edit .env with your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET

# 3. Build the React SPA
cd frontend
bun install && bun run build
cd ..

# 4. Start the Agent & Web Server
bun src/server.js
```
*The server will start on port 3000. Access the dashboard at http://localhost:3000*

## Business Policy Rules & Boundaries

To prevent catastrophic overspending or hallucinated pricing, AgentTill explicitly isolates generative AI from transaction execution.

| Rule ID | Type | Description |
|---|---|---|
| `mandate_ceiling` | Deny | Blocks single carts > ₹50,000. |
| `max_basket_value` | Deny | Blocks unapproved purchases based on dynamic logic. |
| `hourly_spend_cap` | Deny | Hard caps total agent spend within a sliding 60-minute window (₹20,000) using audit history. |
| `velocity_limit` | Deny | Prevents the agent from creating more than 4 checkouts in an hour. |
| `category_allowlist` | Deny | Ensures procured SKUs match allowed B2B MCC codes. |
| `approval_above` | Gate | Checkouts exceeding ₹1,000 silently pause the mission and request manual approval. |

## Deep Dives
- [Documentation Guide](docs/00_DOCUMENTATION_GUIDE.md) - How documents should be.
- [Failure Playbook](docs/failure-playbook.md) - Error Classes, API Fallbacks, Chrome extension DevTools bugs.
