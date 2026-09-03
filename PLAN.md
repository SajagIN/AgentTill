# AgentTill — Video Demo & Outline

## Title: AgentTill: The Policy-Gated Autonomous Buyer

**Length**: ~3 minutes
**Format**: Screen recording (Terminal + Browser)

## 0:00 - 0:30 | Introduction
- "Welcome to AgentTill, an autonomous procurement agent that can manage bulk buying missions entirely via Razorpay."
- Introduce the core problem: Autonomous agents shouldn't be given untethered API keys. Hallucinations cost money.
- **Visual**: Show the Architecture map in the README. Show the clear separation of the (Agent Runtime) from the (Money Boundary M1/M2).

## 0:30 - 1:15 | The Happy Path (With Approval)
- Run `bun run demo`.
- **Narration**: "We launch the demo script. It seeds the local database and starts the server."
- The agent takes the mission: `restock: notebooks, markers, coffee`.
- Explain the terminal log: the Agent searches the catalog, adds 3 items, quotes ₹603.90, and attempts checkout.
- Watch it hit a `needs_approval` threshold (if configured) or sail through. Since the cart is under ₹1000 here, it will just create the link.
- *For the video, we'll demonstrate what happens when Razorpay hits a rate limit or it's a smooth checkout.*

## 1:15 - 2:00 | Scripted Failure: Re-planning on Policy Denial
- **Action**: Explain what happens if an agent grabs a cart that violates a policy rule (e.g. `velocity_max_checkouts_per_hour`).
- **Visual**: Show the terminal logs of "Checkout denied: velocity". 
- Watch the agent realize the policy blocked it. It doesn't break—it actively drops the most expensive item from its plan and re-quotes.
- **Key point**: The LLM isn't writing the prices, it's just requesting the APIs. The deterministic "Money Actions" core throws errors if policy fails, and the agent reacts correctly.

## 2:00 - 2:45 | Immutable Audits (Merkle receipts)
- **Visual**: Show the terminal timeline where `create_order` logs are emitted.
- Explain: Every rule execution generates a cryptographic row in the DB with outcome `pass`, `fail`, or `needs_approval`.
- If an order succeeds, it builds a cryptographic 4-leaf Merkle root of the invoice.

## 2:45 - 3:00 | Conclusion
- AgentTill keeps agents inside boundaries while solving real B2B restocking tasks.
- Outro + GitHub link.
