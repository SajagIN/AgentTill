# AgentTill Development Memory

## Core Principles
1. **Zero Trust LLM Boundaries (M1/M2)**: The AI does not generate prices or call Razorpay directly. It formulates a cart (`cartId`), and `money-actions.js` fetches truth from the database, executing the API call. M2 boundary enforces absolute catalog pricing matches.
2. **Immutable Auditing**: All gateway state transitions (create, approve, capture, reject, fail) must append an immutable event.
3. **Deterministic State Workflows**: Missions strictly adhere to `PLANNING -> QUOTED -> POLICY_CHECK -> PAYING -> CONFIRMED | FAILED | REJECTED`.

## Completed Phases
- **Phase 1-2**: SQLite schema, basic web server, webhook handler with HMAC-SHA256 signature verification.
- **Phase 3**: Decoupled `money-actions.js`.
- **Phase 4-5**: `policy-engine.js` implemented with 7 rules (max limits, velocity, budget limits, categories). Rule evaluations generate hit-by-hit audit events. Added multi-leaf Merkle Receipts for receipt generation.
- **Phase 6**: Built `agent/agent.js` autonomous polling loop. Added rate-limit (429) fallback and replanning logic (cart-culling based on policy REJECTED results). 
- **Phase 7**: Authored `failure-playbook.md` highlighting rate limitations, invariant violations (422), and state lock protections.
- **Phase 8**: Authored `Research.md`. Documented RazorpayX Corporate Cards, Smart Collect, and Route applicability. Finished README.md architecture diagrams. Fully configured test runner using `bun test`.

## Run Instruction
- Initialize `.env`: `cp .env.example .env` and inject standard Test Keys.
- Interactive mode requires `bun scripts/demo-mission.js`.
