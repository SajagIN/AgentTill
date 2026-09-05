# Product requirements — AgentTill

**Working title:** AgentTill — the agent-operated checkout till a merchant can trust.
**Track:** 01 · AI Growth & Agentic Commerce · **Build mode:** Razorpay test mode only.

This document is retained as the original statement of intent, corrected where the implementation diverged from it. Corrections are marked.

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
- Every money action (`create_order`, `confirm_payment`, `retry_payment`, `refund`) passes through a **deterministic policy engine** — spend caps, velocity, category allowlist, human-approval threshold — **before** touching Razorpay.
- All actions, allowed, denied, gated, failed or retried, are written to an **append-only SQLite audit trail** with 4-leaf Merkle receipts.
- Payments settle through **Razorpay test mode**: orders → payment links → signed webhooks. No real money, ever.

## 3. Users

| User | Who | Needs |
|---|---|---|
| **Merchant operator** (primary) | Small business owner | To let an agent buy from their catalog *without* giving it a blank cheque; to see at a glance everything the agent did with money. |
| **Human approver** | The operator or a finance teammate | A simple queue: what is pending, why, one-click approve or deny. |
| **AI buyer agent** (machine user) | The buyer's autonomous agent | A clear catalog, quotes it can trust, and a checkout that tells it *why* it was refused so it can re-plan. |

## 4. Scope

### Delivered

1. **Catalog API** — 14 seeded products across four categories via `GET /api/catalog`.
2. **Quotes** — `POST /api/quote`; the server computes totals from the catalog. Caller-supplied prices are ignored.
3. **Money boundaries** — M1–M4 in [`04-policies.md`](04-policies.md). The policy engine cannot reach the SDK on a deny.
4. **Policy engine** — seven deterministic rules with fixed precedence and live-editable thresholds.
5. **Approvals** — `needs_approval` freezes the mission; approve or deny from the dashboard or the API.
6. **Razorpay test mode** — order creation, payment links, and a Standard Checkout fallback for when test-mode link limits are hit.
7. **Webhooks** — HMAC-verified with timing-safe comparison, idempotent on event id: `payment.captured`, `payment.failed`, `refund.processed`.
8. **Buyer agent** — plans, quotes, checks out, and re-plans on denial. Reaches the system only over HTTP.
9. **Audit trail** — append-only events with 4-leaf Merkle receipts; `correlation_id` ties events to missions.
10. **Dashboard** — React 19 + Vite + Tailwind v4 + shadcn/ui. Six pages, each with an inline explanation of its purpose and use.
11. **MCP server** — eight tools over HTTP and stdio, sharing the same policy engine and audit trail.
12. **Mandates & negotiation** — buyer autopay mandates and margin-floored counter-offers, via API and MCP.

### Non-goals

Live payments. Multi-merchant tenancy. User authentication. Production databases or orchestration (Postgres, Kubernetes). Agent frameworks (LangChain and equivalents). Voice UI.

## 5. Success criteria

| Judged on | How AgentTill demonstrates it |
|---|---|
| **Build quality** | Fresh clone → `bun install`, `cp .env.example .env`, `bun run build`, `bun run start`. One port serves the API and the dashboard. 42 tests pass offline. |
| **Trust boundary** | The agent's only access is the public HTTP API. One module can call the payment SDK, and a test proves it is never called on a deny. Policy is deterministic code. |
| **Explainability** | Every verdict returns the full `ruleEvals` array, not just the rule that fired. The dashboard renders it. |
| **Auditability** | Append-only events, including denials and failures, folded into a Merkle receipt per mission. |
| **Failure recovery** | Rate limits, M2 invariant violations, forged webhooks, duplicate deliveries, out-of-order events, and unbuildable frontends all produce a defined response rather than a crash. |

### Correction to the original criteria

The original document claimed the project uses an LLM for intent-to-cart, re-planning, and explanations, while keeping the LLM away from policy and arithmetic.

**That was not true of the code.** No LLM is called anywhere. Intent parsing is keyword extraction, re-planning is a deterministic "drop the most expensive item" loop, and explanations come from the rule engine. The `OPENAI_*` environment variables were configured but read by nothing, and have been removed.

The important half of the claim still holds and is stronger for it: the boundary that would matter if an LLM were added is already in place, because the agent reaches the system only through the HTTP API and the policy engine is pure code.

## 6. Roadmap

- A2A reverse auctions between competing merchant agents
- Google AP2 mandate chains
- RazorpayX virtual cards, to cap per-mission blast radius physically rather than by policy
- Refund controls in the dashboard (the API path exists today)
- Anchoring Merkle roots externally, to turn tamper-evidence into non-repudiation
