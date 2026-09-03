# Phase 8: Research Task - Razorpay B2B Operations

In traditional autonomous B2B workflows—spanning procurement, corporate gifting, vendor payouts, and payroll operations—security architectures must account for prompt-injection, non-deterministic agentic boundaries, and rogue loops executing massive transaction payloads. Razorpay provides several specialized product vectors suitable for augmenting security and operational fidelity in these workflows. 

## Architectural Alignment with Razorpay Products

### 1. RazorpayX Corporate Cards (Spend Management)
Instead of generating high-risk Payment Links, autonomous agents acting as buyers or procurers can be bound to **RazorpayX virtual cards**.
- **Agent Integration**: The agent is provisioned a virtual corporate card explicitly tied to the `missionId`.
- **Policy Enforcement**: RazorpayX provides native spend limits, MCC (Merchant Category Code) blacklisting, and zero-balance loading. 
- **Blast Radius**: Maximum loss is physically capped by the API balance loaded onto the card during the `PLANNING` phase avoiding infinite retry/spend spirals.

### 2. Razorpay Route (Payment Split/Distribution)
For autonomous multi-vendor checkout missions:
- **Agent Integration**: The agent builds a single cart comprising items from Vendor A and Vendor B. The agent triggers a single unified checkout sequence.
- **Policy Enforcement**: Route splits the payout underneath the hood to multiple linked accounts conditionally. 
- **Blast Radius**: Prevents the agent from accidentally dispatching 100% of the funds to a compromised/hijacked vendor ID because the settlement rules logic is deferred back to Razorpay's immutable Dashboard config instead of script-level LLM execution.

### 3. Smart Collect (Bank Transfers)
For massive recurring procurement that exceeds Payment Link caps or credit rails:
- **Agent Integration**: Agent generates Virtual Accounts (VA/UPI IDs) dedicated specifically for a single active vendor payload. 
- **Reconciliation**: Automated, matching exact incoming remittance to a specific agent `missionId` closing the loop programmatically rather than hoping the agent accurately checks the ledger.

## Closing the Loop safely
A common threat model in autonomous finance is **Authorization Disconnection**. An agent negotiates a cart and approves it, but an adversary intercepts the payload en-route to the payment gateway.
By decoupling agentic intent from `money-actions.js` execution, and bridging that execution with Razorpay's server-side webhooks (HMAC-SHA256 verified), the system establishes an absolute deterministic outcome. The LLM agent receives `PAYMENT_SUCCESS` not from its own hallucination, but validated back down from Razorpay network hooks into the strict state-machine.
