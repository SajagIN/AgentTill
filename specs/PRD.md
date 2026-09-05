# PRD — AgentTill

**Working title:** AgentTill — the agent-operated checkout till a merchant can trust.
**Track:** 01 · AI Growth & Agentic Commerce · **Build mode:** Razorpay test mode only.

---

## 1. Problem

Agentic commerce is arriving (NPCI's UAP, ACP, AP2, x402). AI buyers will soon shop and pay on behalf of people and businesses. The blocker is not intelligence — it is **trust**: no merchant will let an autonomous agent spend money unless every action is:

1. **Bounded** — hard limits on how much and how often,
2. **Gated** — a human approves anything above threshold,
3. **Explainable** — every action carries a machine-checkable reason, and
4. **Auditable** — a tamper-evident trail of every rupee, including failures and denials.

Today, "agent checkout" demos are a chat that calls a payment API. Nobody has shipped the safety layer that makes an AI buyer production-grade.

## 2. Product

AgentTill is a small merchant platform + AI buyer agent + **policy gate** that sits between them:

- A merchant exposes an **agent-readable catalog API** (`/api/catalog`).
- A **buyer agent** receives a *mission* — e.g. "restock office supplies, budget ₹2,000" — plans a cart, and attempts a checkout.
- Every money action (`create_order`, `confirm_payment`, `retry_payment`) passes through a **deterministic policy engine** (spend caps, velocity, category allowlist, human-approval threshold) **before** touching Razorpay.
- All actions — allowed, denied, gated, failed, retried — are written to an **append-only SQLite audit trail** backed by cryptographic 4-leaf Merkle Receipts.
- Payments settle through **Razorpay test mode** (orders → payment links → signed webhooks). No real money, ever.

## 3. Users

| User | Who | Needs |
|---|---|---|
| **Merchant operator** (primary) | Small business owner | To let an agent buy from their catalog WITHOUT giving it a blank cheque; to see, at a glance, everything the agent did with money. |
| **Human approver** | The operator or a finance teammate | A dead-simple queue: what's pending, why, one-click approve/deny. |
| **AI buyer agent** (machine user) | The buyer's autonomous agent | Clear catalog, quotes it can trust, checkout that tells it *why* it was refused so it can replan. |

## 4. Scope (Delivered)

### Core Primitives
1. **Catalog API**: Seeded products accessible via `GET /api/catalog`.
2. **Quotes**: `POST /api/quote` — server computes totals from catalog; generative AI input never sets prices.
3. **Money Boundaries**: Explicit code separation. M1/M2 isolation blocks LLM from transactional boundaries.
4. **Policy Engine**: Deterministic rules (max basket, hourly spend cap, velocity, category allowlist, approval-above-threshold).
5. **Approvals**: `needs_approval` pauses the mission; approve/deny API via React Dashboard.
6. **Razorpay Test-Mode**: Order creation, payment link generation.
7. **Webhooks**: HMAC-verified (timing-safe), idempotent (`payment.captured`, `payment.failed`).
8. **Buyer Agent**: Background looping agent reading DB intents, using tool-calling to enforce logical boundaries. Handles its own replanning upon policy rejection.
9. **Audit Trail**: Append-only event store generating cryptographic Merkle Receipts. `correlation_id` ties events to missions.
10. **React 19 SPA Dashboard**: Replaced the vanilla HTML stack. A fully localized Vite dashboard for approval management and audit trail visualization. (Protected via `cleanFetch` DOM-mutation bypasses).

### Explicitly Excluded (Non-goals)
Real/live payments, multi-merchant tenancy, user auth, production DB infrastructures (Postgres, K8s), LangChain frameworks, Voice UI.

## 5. Success Criteria

| Judged on | AgentTill shows it by |
|---|---|
| Build quality | Fresh clone → `bun i`, `cp .env.example .env`, `bun run build`, and `bun src/server.js` works as a full-stack integrated Node API & React app. |
| AI judgment | LLM used for intent→cart, re-planning, explanations. **Not** used for policy, arithmetic, signatures, state transitions — and the codebase topology proves that. |
| Failure recovery | Rate Limits (429), Invariant violations (422), Webhook spoofing, and Native React 19 scheduler bugs are all handled, proven, and explicitly bypassed safely. |

