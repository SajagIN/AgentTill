# AgentTill Development Memory

This document tracks the temporal memory and foundational principles underlying the architecture of AgentTill, matching the structure dictated in `docs/00_DOCUMENTATION_GUIDE.md`.

## Core Foundational Truths
1. **Zero Trust LLM Boundaries (M1/M2)**: 
   - **Theoretical vs Actual**: generative AI is completely isolated from checkout execution. 
   - **Path**: The agent formulates a cart, but `src/money-actions.js` fetches absolute truth from the database, executing the API call. M2 boundary enforces strict catalog pricing matches, rejecting hallucinations on syntax.
2. **Deterministic State Workflows**: 
   - Missions strictly adhere to chronological locking.
   - Flow: `PLANNING -> QUOTED -> POLICY_CHECK -> PAYING -> (AWAITING_APPROVAL) -> CONFIRMED | FAILED | REJECTED`.
3. **Immutable Auditing**: 
   - **Path**: `src/audit.js`
   - All gateway state transitions (create, approve, capture, reject, fail) must append an immutable event. Approval/Capture operations emit a 4-leaf cryptographic Merkle root reflecting the invoice sum.

## Temporal Progression (Phases)
- **Phase 1-2**: SQLite schema, `src/server.js`, webhook handler mapped to `src/webhooks.js` with HMAC-SHA256 signature verification.
- **Phase 3**: Decoupled `src/money-actions.js`.
- **Phase 4-5**: `src/policy-engine.js` implemented with 7 rules (velocity, scale, ceiling limits). Rule evaluations generate hit-by-hit audit events. Implemented explicit multi-leaf Merkle Receipts for receipt generation.
- **Phase 6**: Built `src/agent/agent.js` background polling loop. Handled Razorpay API rate-limit (429) fallback and replanning logic (active cart-culling based on policy `REJECTED` results). 
- **Phase 7**: Authored `docs/failure-playbook.md` highlighting rate limitations, invariant violations (422), and state lock protections.
- **Phase 8 (React SPA Migration)**: Moved vanilla HTML dashboard to strict `/frontend` React 19 SPA running standard Vite configuration.
- **Phase 9**: Fixed unfixable React 19 `startTime` scheduler crashes triggered by third-party Chrome extensions mapping over UI threads. Implemented an immutable `cleanFetch.ts` iframe capture to neutralize native scheduler hijack behaviors. Back-ended `/api/*` 404 falls back to strict JSON on `src/server.js`.

*Note: For the official video demo outline, see `PLAN.md`.*
