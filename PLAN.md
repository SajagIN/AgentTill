# PLAN: AgentTill Roadmap & Demo Script

As per our `00_DOCUMENTATION_GUIDE.md`, this document serves as the temporal map for AgentTill, charting past execution, present status, and future vision.

## 1. Past Execution (Phases 0-9)

| Phase | What Was Achieved | Status |
|---|---|---|
| **0-1** | Skeleton, DB, Catalog + Quotes (`catalog.js`) | ✅ Done |
| **2**   | Money core M1/M2 boundary, policy stubs (`money-actions.js`) | ✅ Done |
| **3**   | Webhooks & Ngrok/Cloudflared integration (`webhooks.js`) | ✅ Done |
| **4**   | Real AI Policy engine + Human Approval Flow (`policy-engine.js`, `approvals.js`) | ✅ Done |
| **5**   | Audit store `audit.js` (Merkle Cryptographic Ledgers) | ✅ Done |
| **6**   | React 19 SPA Frontend Migration (Replacing vanilla `/public`) | ✅ Done |
| **7**   | Deep bypass of DOM-Mutating Chrome extensions (React 19 Schedulers bug) | ✅ Done |
| **8**   | Video Demo polishing, `DOCS_LOOP_TRACKER` activation. | 🔄 Active |

*See `specs/Phases.md` for historical, granular step-by-step acceptance criteria.*

## 2. Present Execution (The Video Demo)

**Title**: AgentTill: The Policy-Gated Autonomous Buyer
**Length**: ~3 minutes
**Format**: Screen recording (Terminal + Browser)

### 0:00 - 0:30 | Introduction
- "Welcome to AgentTill, an autonomous procurement agent that manages bulk buying missions entirely via Razorpay."
- Introduce the core problem: Autonomous agents shouldn't be given untethered API keys. Hallucinations cost money.
- **Visual**: Show the Architecture map in the `README.md`. Show the clear separation of the (Agent Runtime) from the (Money Boundary M1/M2).

### 0:30 - 1:15 | The Happy Path (With Approval)
- Run `bun run server.js`.
- **Narration**: "We launch the server. It seeds the local database and starts the background agent."
- Load the React SPA at http://localhost:3000. Create a new mission: `restock: notebooks, markers, coffee`.
- Explain the terminal log: the Agent searches the catalog, adds 3 items, quotes ₹603.90, and attempts checkout.
- Watch it hit a `category_allowlist` or `approval_above` threshold. The UI updates to "AWAITING_APPROVAL". Click approve on the dashboard to generate the payment link.

### 1:15 - 2:00 | Scripted Failure & The Iframe Bypass
- **Action**: Explain what happens if an agent grabs a cart that violates a policy rule (e.g. `velocity_limit`).
- Watch the agent realize the policy blocked it. It doesn't break—it actively drops the most expensive item from its plan and re-quotes.
- **Visual**: Briefly show the `cleanFetch.ts` code highlighting how we bypassed the external extensions breaking the event loop (showing robustness in real environments).

### 2:00 - 2:45 | Immutable Audits (Merkle receipts)
- **Visual**: Show the Audit Trail view on the React SPA. Click to see the raw JSON data.
- Explain: Every rule execution generates a cryptographic row in the DB with outcome `pass`, `fail`, or `needs_approval`.
- An order build creates a 4-leaf Merkle root of the invoice.

### 2:45 - 3:00 | Conclusion
- AgentTill keeps agents inside boundaries while solving real B2B restocking tasks.
- Outro + GitHub link.

## 3. Future Vision
- A2A (Agent-to-Agent) reverse auctions.
- Google AP2 mandate chains.
- Telegram Bot omnichannel commerce layer.
