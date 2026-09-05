# 07 · State machine

`src/missions.js` is the sole authority on mission state. Every change goes through `transition(missionId, to)`, which throws `TransitionError` (`409 INVALID_TRANSITION`) if the move is not in the table below. No other module writes `missions.state`.

## States

| State | Meaning |
|---|---|
| `PLANNING` | Created. The agent is reading the catalog and building a cart. |
| `QUOTED` | The server has priced the cart. |
| `POLICY_CHECK` | The rule engine is evaluating. |
| `AWAITING_APPROVAL` | Gated. Frozen until a human decides. **No order exists.** |
| `PAYING` | A Razorpay order exists; payment is expected. |
| `CONFIRMED` | Payment captured and verified against the order. Terminal. |
| `FAILED` | A payment attempt failed. Retryable. |
| `RETRYING` | A new order is being raised. |
| `FAILED_FINAL` | Retries exhausted. Terminal. |
| `REJECTED` | A deny rule stopped the checkout. |
| `ESCALATED` | Needs manual intervention. Terminal. |
| `CANCELLED` | Closed without spending. Terminal. |
| `REFUNDED` | Payment returned. Terminal. |

## Transitions

```
                              ┌──────────► CANCELLED  (from any non-terminal state)
                              │
  PLANNING ──► QUOTED ──► POLICY_CHECK ──► PAYING ──► CONFIRMED ──► REFUNDED
     ▲            │            │   │          │
     │            │            │   │          └──► FAILED ──► RETRYING ──► PAYING
     │            │            │   │                        │        └──► FAILED
     │            │            │   │                        ▼
     └── REJECTED ◄┘            │   └──► AWAITING_APPROVAL ─┴──► FAILED_FINAL ──► ESCALATED
                                │            │   │  │
                                │            │   │  └──► REJECTED
                                │            │   └─────► POLICY_CHECK
                                │            └─────────► PAYING
                                └──► REJECTED
```

| From | Allowed |
|---|---|
| `PLANNING` | `QUOTED`, `REJECTED`, `CANCELLED` |
| `QUOTED` | `POLICY_CHECK`, `CANCELLED` |
| `POLICY_CHECK` | `PAYING`, `AWAITING_APPROVAL`, `REJECTED`, `CANCELLED` |
| `AWAITING_APPROVAL` | `POLICY_CHECK`, `PAYING`, `REJECTED`, `CANCELLED` |
| `PAYING` | `CONFIRMED`, `FAILED`, `CANCELLED` |
| `FAILED` | `RETRYING`, `FAILED_FINAL`, `ESCALATED`, `CANCELLED` |
| `RETRYING` | `PAYING`, `FAILED`, `FAILED_FINAL`, `ESCALATED`, `CANCELLED` |
| `FAILED_FINAL` | `ESCALATED`, `CANCELLED` |
| `CONFIRMED` | `REFUNDED`, `CANCELLED` |
| `REJECTED` | `PLANNING`, `QUOTED`, `CANCELLED` |
| `ESCALATED` | — |
| `CANCELLED` | — |
| `REFUNDED` | — |

`REJECTED → PLANNING` exists so a denied mission can be re-planned. In practice the buyer agent re-plans by building a **new** cart on the same mission rather than resetting the state.

## Who moves what

| Actor | Transitions it performs |
|---|---|
| `money-actions.createOrder` | `PLANNING/REJECTED → QUOTED`, `QUOTED/AWAITING_APPROVAL → POLICY_CHECK`, `POLICY_CHECK → REJECTED`, `POLICY_CHECK → AWAITING_APPROVAL`, `POLICY_CHECK → PAYING` |
| `money-actions.confirmPayment` | `PAYING → CONFIRMED` |
| `money-actions.noteFailedPayment` | `PAYING → FAILED` |
| `money-actions.retryPayment` | `FAILED → RETRYING`, `RETRYING → PAYING`, `RETRYING → REJECTED / AWAITING_APPROVAL / FAILED` |
| `approvals.resolveApproval` | `AWAITING_APPROVAL → REJECTED` on a denial |
| `routes.js` | `… → CANCELLED` when the agent abandons a mission |

The buyer agent never transitions state directly. It acts through the API, and the money layer moves the mission as a side effect of what it decided.

## Out-of-order and duplicate events

Webhooks arrive late, twice, and out of order. Rather than special-casing, the code lets `transition` throw and treats the throw as information:

- `confirmPayment` on an already-`CONFIRMED` mission catches `TransitionError`, writes an `info` event recording the out-of-order arrival, and returns `ignored_out_of_order`. State is untouched.
- `noteFailedPayment` does the same for a late `payment.failed`.
- An order already marked `captured` short-circuits to `already_confirmed` before any transition is attempted.

This is why the state table looks permissive but the system stays consistent: an illegal move is never forced through, it is recorded.

## Terminal states

`CONFIRMED`, `FAILED_FINAL`, `ESCALATED`, `CANCELLED`, `REFUNDED`. Nothing advances from these except `CONFIRMED → REFUNDED` and the universal `→ CANCELLED`.

The dashboard mirrors this set in `frontend/src/lib/mission-states.ts` for display purposes — "in progress" is everything not terminal. The two lists are separate on purpose: the backend table is a correctness constraint, the frontend set is a presentation choice, and conflating them is how a UI ends up describing a state the engine would reject.
