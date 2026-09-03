# Failure Scenarios & State Machine Responses

The autonomous agent delegates all policy adherence to the programmatic "money actions" interface, isolating policy decisions, state transitions, and audit generation entirely from agent behavior. As errors occur, the state of the entity informs agent recovery paths.

## Error Classes

| Class | HTTP Status | Source | Definition | Example |
|---|---|---|---|---|
| Policy Rejection | 403 | Policy Engine | Code evaluates the actor/action and yields a "deny" verdict based on business rules. | Category blacklisted (`stationary_electronics`). |
| Invariant Violation | 422 | Money M2 Layer | Guardrails detecting critical anomalies before evaluation. | Quoted cart total differs from current catalog lookup (M2 violation). |
| Hard Rate Limit | 429 | SDK / Razorpay API | Third-party dependencies enforcing fixed request boundaries. | `RATE_LIMIT_EXCEEDED` for test mode payment links >30 per hour. |
| Transition Lock | 409 | State Machine | Cannot process event since it leaves the entity in an ambiguous state. | Processing `PAYING` -> `REJECTED` for the same mission simultaneously. |

## Failure Playbooks

### SDK Throttle (`status: 429`)
- **Detection**: Agent catches `429 RATE_LIMIT_EXCEEDED`.
- **Response**: Halts the `runMission` polling.
- **Agent Behavior**: Gracefully fails back to shell output alerting the supervisor to check Razorpay test-mode dashboard limits. Mission remains open/failed until limit resets.

### Policy Rejection (`status: 403`)
- **Detection**: Policy rules evaluation output yields outcome `fail`.
- **Response**: The `createOrder` command forces the state to `REJECTED`, logging a full audit trail snapshotting the exact policies triggered and throwing a normalized exception back to the Agent.
- **Agent Behavior**: Agent checks rejection and re-plans the quote (i.e. finding the most expensive SKU, appending to `excludedSkus`, requoting). The mission is safely bounced back to `QUOTED` via `PLANNING` inside `createOrder` when the subsequent loop initiates. Max 2 re-plans.

### Out of Bound Pricing (`status: 422`)
- **Detection**: `retotalFromCatalog` checks cart items vs live DB. Mismatch yields `422 AMOUNT_MISMATCH`. M2 security check.
- **Response**: Throws `MoneyActionError(422)`.
- **Agent Behavior**: Currently crashes loop safely since quote mismatch is fatal and signals possible prompt drift.
