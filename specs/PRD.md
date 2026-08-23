# PRD — AgentTill

**Working title:** AgentTill — the agent-operated checkout till a merchant can trust.
**Track:** 01 · AI Growth & Agentic Commerce · **Build mode:** Razorpay test mode only. **Deadline:** 2 weeks. Solo builder.

---

## 1. Problem

Agentic commerce is arriving (NPCI's UAP, ACP, AP2, x402). AI buyers will soon shop and pay on behalf of people and businesses. The blocker is not intelligence — it is **trust**: no merchant will let an autonomous agent spend money unless every action is

1. **Bounded** — hard limits on how much and how often,
2. **Gated** — a human approves anything above threshold,
3. **Explainable** — every action carries a machine-checkable reason, and
4. **Auditable** — a tamper-evident trail of every rupee, including failures and denials.

Today, "agent checkout" demos are a chat that calls a payment API. Nobody has shipped the safety layer that makes an AI buyer production-grade.

## 2. Product

AgentTill is a small merchant platform + AI buyer agent + **policy gate** that sits between them:

- A merchant exposes an **agent-readable catalog API** (products, prices, stock).
- A **buyer agent** receives a *mission* — e.g. "restock office supplies, budget ₹2,000" — plans a cart, and checks out.
- Every money action (`create_order`, `confirm_payment`, `retry_payment`, `refund`) passes through a **deterministic policy engine** (spend caps, velocity, category allowlist, human-approval threshold) **before** touching Razorpay.
- All actions — allowed, denied, gated, failed, retried, refunded — are written to an **append-only audit trail** with a replay UI.
- Payments settle through **Razorpay test mode** (orders → payment links → signed webhooks → refunds). No real money, ever.

**The demo sentence:** "Watch an AI agent try to overspend — and get stopped, on camera, with the receipt."

## 3. Users

| User | Who | Needs |
|---|---|---|
| **Merchant operator** (primary) | Small business owner / ops person | To let an agent buy from their catalog WITHOUT giving it a blank cheque; to see, at a glance, everything the agent did with money |
| **Human approver** | The operator or a finance teammate | A dead-simple queue: what's pending, why, one-click approve/deny |
| **AI buyer agent** (machine user) | The buyer's agent, acting on a mission | Clear catalog, quotes it can trust, checkout that tells it *why* it was refused so it can re-plan |

There is deliberately no end-customer login/UX. This is infrastructure + operator tooling, not a storefront.

## 4. Scope

### P0 — must exist (the submission)

1. Catalog: 12–15 seeded products (sku, name, category, price_paise, stock), `GET /catalog`
2. Quotes: `POST /quote` — server computes totals from catalog; agent input never sets prices
3. Money actions module — exactly four functions, the only code that touches Razorpay
4. Policy engine: ≥5 rules (max basket, hourly spend cap, velocity, category allowlist, approval-above-threshold); pure, deterministic, unit-tested
5. Approvals: `needs_approval` pauses the mission; approve/deny API + minimal UI
6. Razorpay test-mode integration: order create, payment link, payment fetch, refund
7. Webhooks: HMAC-verified (timing-safe), idempotent, `payment.captured` / `payment.failed` / `refund.processed`
8. Buyer agent: hand-rolled LLM loop (OpenAI), tool-calling, explicit state machine, mission budget enforced in code not prompt
9. Audit trail: append-only event store, `correlation_id` per mission, retry chains via `parent_event_id`; replay UI timeline
10. Failure playbook (all five staged, handled, visible in audit): declined payment → policy-checked retry w/ backoff → escalation; budget-breach denied; forged webhook rejected; duplicate webhook no-op; quote/order amount mismatch hard-stop
11. One-command demo: `bun run demo` seeds data and runs a scripted mission
12. Dashboard UI: missions list, mission timeline with rule-evaluation cards, approvals queue

### P1 — if on schedule

- Paybot: headless script that completes the payment link with a test card → fully autonomous agent loop
- Second mission archetype (upsell: agent proposes an optimized cart under budget)
- Audit replay "explanation" line written by the agent (LLM) per event — clearly marked as commentary, never as authorization

### P2 — explicitly not now (non-goals)

Real/live payments · multi-merchant tenancy · user auth & accounts · production DB · Docker/K8s · agent frameworks (LangChain etc.) · voice · frontend frameworks (React etc.) · live UPI intent flows · notifications (email/SMS).

## 5. Success criteria (mapped to how this is judged)

| Judged on | AgentTill shows it by |
|---|---|
| Problem taste | The trust layer for the #1 open problem in payments right now; bar text ("explainable, bounded, gated, audit trail, one graceful failure") answered feature-for-feature |
| Build quality | Fresh clone → `bun i && bun run demo` works; money code is one tested module; honest incident log |
| AI judgment | LLM used for intent→cart, re-planning, explanations. **Not** used for policy, arithmetic, signatures, state transitions — and the code structure makes that provable |
| Failure recovery | Five staged failures with graceful handling on camera + a real `docs/incident-log.md` |

**Quantified targets:** 100% of money actions pass through the policy gate (enforced by module structure + a repo grep test) · policy engine ≥95% unit-test line coverage · webhook handler rejects forged signatures and duplicate deliveries in tests · demo runs green twice in a row.

## 6. Constraints & risks

- **Solo + 2 weeks** → scope discipline is the top risk; Phases.md enforces order; P2 list is a pressure valve.
- **No prior payments-API experience** → Phase 0–3 are deliberately Razorpay-fluency-building; decision gate after Phase 3 (see Phases.md) either commits or pivots the same skills to a Track 03 recovery agent.
- **Test-mode limits** → no real settlements/UPI-intent; all money is simulated with test instruments (`4111 1111 1111 1111`, `success@razorpay`, `failure@razorpay`).
- **Chat-paste AI workflow** → context loss is a real risk; mitigated by Memory.md protocol and complete-file outputs (see Rules.md).
