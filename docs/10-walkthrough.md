# 10 · Walkthrough

A five-minute tour of AgentTill: what problem it solves, how the pieces fit, and what happens when you run it.

An audio version narrating this script is at [`agenttill-walkthrough.mp3`](agenttill-walkthrough.mp3) — 5 minutes 27 seconds.

---

## Part 1 — The problem

AgentTill is an autonomous buyer agent for business procurement. You give it a goal in plain language — "restock: notebooks, markers, coffee" — and it searches a catalog, builds a cart, and tries to check out on your behalf.

That part is easy. The hard part is trust. An agent that hallucinates a price, or loops on a retry, or gets prompt-injected mid-checkout, spends real money while it does it. Every "agent checkout" demo so far has been a chat window that calls a payment API.

AgentTill is the missing layer. An agent's spending has to be **bounded** by hard limits, **gated** so a human approves anything significant, **explainable** so every decision carries a machine-checkable reason, and **auditable** — a tamper-evident record of every rupee, including the ones the agent was stopped from spending.

## Part 2 — The shape of the system

One process serves everything: an Express API, a React dashboard, an MCP server, and a webhook receiver, on one port, backed by a single SQLite file. Three boundaries matter.

The **agent boundary**: the buyer agent does not import the database or the payment SDK. It talks to AgentTill over HTTP, through the same public API an external client would use. So the agent has no privilege that any MCP client does not also have.

The **money boundary**: one module is the only importer of the Razorpay client, and the only path that can create an order. Every call follows the same shape — authorise, execute, audit. If the policy engine says deny, the SDK is never reached, and a test proves it with a stubbed client whose every method throws if touched.

The **policy boundary**: the rule engine is a pure function. An actor, an action, an integer amount, and a context object go in; a verdict and the complete rule evaluation come out. No model is involved anywhere near money. The agent proposes; deterministic code decides.

## Part 3 — What happens when you run it

You start the server. It seeds a fourteen-product catalog and serves the dashboard on port three thousand. You create a mission — an intent and a budget — and the agent starts in the background.

It splits the intent into keywords, searches the catalog, drops anything that would blow the budget, and caps the cart at three items. Then it asks for a quote. The server prices it from the catalog — the agent never sets a price — and returns a cart id.

Then it attempts checkout, and this is the interesting part. Before consulting any policy, the money layer re-totals the cart from the current catalog and compares it against the quoted total. Any mismatch is a hard stop. That guards against a price changing mid-flight, or against a doctored cart.

Only then does the policy engine run: the buyer's mandate ceiling, a maximum basket of two thousand five hundred rupees, an hourly spend cap of five thousand, a velocity limit of four checkouts an hour, a category allowlist, an approval gate above one thousand rupees, and the mission's own budget.

Precedence is short: any failure means deny; otherwise any triggered gate means approval needed; otherwise allow. A gate can never mask a deny, because gating a hard limit would imply a human could wave it through.

Three outcomes. **Allow**: an order and payment link are created. **Deny**: no order is created at all, and the agent re-plans by dropping the most expensive item, up to twice. **Needs approval**: the mission freezes — and critically, no order exists yet. Approving is what authorises one.

## Part 4 — The human, and the ledger

On the Approvals page an operator sees each frozen checkout with the full rule-by-rule evaluation behind the gate — what passed, what fired, and why. They decide with the same evidence the engine used.

Razorpay then calls back. The webhook route is registered before the JSON parser, so it sees raw bytes, verifies an HMAC signature with a timing-safe comparison, and only then parses. Duplicate deliveries are caught on the event id. Confirmation does not trust the payload — it refetches the payment and compares the amount against the stored order.

Every step wrote a row to the audit table: the checkout, the denial, the approval, the capture. That table is append-only; there is no update statement against it anywhere in the codebase. Each mission's events fold into a four-leaf SHA-256 Merkle tree.

To be precise: that is tamper-evidence, not non-repudiation. Someone with database write access could recompute the whole tree. Anchoring the root externally would close that gap, and it is deliberately out of scope.

## Part 5 — Why it holds together

AgentTill runs entirely in Razorpay test mode; live keys are rejected at startup. It installs with one command, builds with one command, and serves the API and dashboard from a single port.

The suite is forty-two tests and runs offline. It includes an end-to-end test that boots the real Express app and drives a mission from creation to Confirmed through a signed webhook, plus gates proving the SDK is never called on a deny, a forged signature changes no state, and a tampered cart total is rejected before any money moves.

The point is not the purchasing. It is that you can read the whole codebase end to end and point at the exact line where an agent is prevented from spending money it was not allowed to spend.
