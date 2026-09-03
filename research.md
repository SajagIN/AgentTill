# AgentTill — Research & Design Notes

## Why AgentTill?

Enterprise procurement involves repetitive purchasing decisions that follow predictable rules. An autonomous buyer agent can handle routine restocking while deferring anomalous or expensive purchases to humans. AgentTill demonstrates this pattern using:

- **Deterministic policy gate**: No LLM in the decision loop — policy rules are pure functions
- **Append-only audit**: Every state change is timestamped and Merkle-verified
- **Razorpay test mode**: Real payment infrastructure without real money risk

## Design Decisions

### Money Law M1: Integer Paise Everywhere

Floating-point arithmetic is unsuitable for financial calculations due to precision errors. AgentTill represents all amounts as integers (paise), derived from user-provided rupees via `amountPaise = rupees * 100`.

```javascript
// WRONG — floating point
const amount = 0.1 + 0.2; // 0.30000000000000004

// CORRECT — integer paise
const amountPaise = 1000 + 2000; // 3000 paise = ₹30.00
```

### Money Law M2: Server-Side Pricing Only

Client-provided prices are untrusted. The quote flow:
1. Client sends `{items: [{sku, qty}]}`
2. Server resolves SKUs from catalog and computes totals
3. Server returns `{cartId, totalPaise, items: [...]}`
4. At checkout, server **re-totals** from catalog to catch tampering

```javascript
// In createOrder() — the M2 guard
const cart = findCart(cartId);
const verifiedTotal = retotalFromCatalog(cart.items);
if (verifiedTotal !== cart.totalPaise) {
  throw new Error("M2 VIOLATION: quote altered");
}
```

### Money Law M3: Single Razorpay Importer

The `razorpay-client.js` module is imported only by `money-actions.js`. This creates a clear audit boundary:

```
money-actions.js
    │
    └──► razorpay-client.js (sole importer)
         │
         └──► @ razorpay/sdk (official SDK)
```

All Razorpay operations follow the pattern:
```
authorize() → execute() → audit()
```

### Policy Engine Precedence

Rules are evaluated in a fixed order (deny → needs_approval → allow). This prevents subtle bugs where a "gate" rule might hide a "deny" rule:

```
1. category_allowlist (deny)
2. max_basket_value (deny)
3. mission_budget (deny)
4. hourly_spend_cap (deny)
5. velocity_max_checkouts_per_hour (deny)
6. mandate_ceiling (deny)
7. approval_above (needs_approval)
8. ← implicit allow if no rule matched
```

### Audit Trail: Merkle Receipts

Each mission timeline is hashed into a 4-leaf balanced Merkle tree:

```
         [root]
        /      \
    [node0]   [node1]
    /    \    /    \
  L0     L1  L2    L3 (leaf events)
```

- SHA-256 throughout
- Receipt contains root hash + all intermediate nodes + raw event data
- Client can verify no events were removed or reordered

### State Machine

```
PLANNING → QUOTED → POLICY_CHECK → PAYING → CONFIRMED
              │                         │
              │                         ├──► FAILED → RETRYING → PAYING
              │                         │                 ↓
              │                         └──► FAILED_FINAL → ESCALATED
              │
              ├──► AWAITING_APPROVAL → POLICY_CHECK → PAYING
              │
              ├──► REJECTED → (back to PLANNING for re-plan)
              │
              └──► CANCELLED
```

### Human-in-the-Loop Approvals

When `approval_above` (₹1,000) is triggered:
1. Mission pauses at `AWAITING_APPROVAL`
2. No Razorpay API call is made (verified by stubbed tests)
3. Operator sees approval in dashboard
4. `POST /approvals/:id/approve` resumes with fresh policy check
5. Agent continues to payment

### Webhook Security

Raw body HMAC-SHA256 before any JSON parsing:

```javascript
app.post("/webhooks/razorpay", express.raw({ type: "application/json" }), webhookHandler);
//                                                              ^^^^^^^^
//                                            Captures raw bytes for signature verification
```

Timing-safe comparison prevents timing attacks:

```javascript
const crypto = await import("node:crypto");
const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
if (!crypto.timingSafeEqual(signature, expected)) {
  return res.status(401).send("invalid signature");
}
```

## Razorpay Integration Details

### Test Mode Constraints

- 30 payment links per hour limit (dashboard error `RATE_LIMIT_EXCEEDED`)
- Cards: `4111 1111 1111 1111` (any future expiry/CVV)
- UPI: `failure@razorpay` (simulates decline)

### Order Lifecycle

1. `createOrder()` → Razorpay `orders.create()`
2. `createPaymentLink()` → Razorpay `payment_links.create()`
3. Customer pays via link
4. Webhook `payment.captured` → `confirmPayment()`
5. Order status → `CONFIRMED`

### Refund Flow

1. `refund({ paymentId, amountPaise, reason, actor })`
2. Policy check (different rules than checkout)
3. `refunds.create()` via Razorpay SDK
4. Webhook `refund.processed` → audit event

## Agent Design

The buyer agent is a hand-rolled loop (no LangChain/Autogen):

```javascript
while (attempt < 3) {
  try {
    const products = await searchCatalog(intent);
    const items = selectItemsWithinBudget(products, budget);
    const quote = await getQuote(items);
    const checkout = await beginCheckout(quote.cartId, missionId);

    if (checkout.status === 'needs_approval') {
      await approve(checkout.approvalId);
    }
    return checkout;
  } catch (e) {
    attempt++;
    await backoff(attempt² × 1s);
  }
}
```

**Why not LLM-driven?**
- Phase 6 acceptance requires deterministic "3 retries then exit" behavior
- LLM calls would introduce non-determinism in the audit timeline
- Simple keyword extraction suffices for the demo catalog

## Database Schema

```sql
products(sku, name, category, price_paise, stock)
mandates(id, buyer_id, max_amount_paise, allowed_merchants, active, created_at)
carts(id, items_json, total_paise, created_at, negotiated_total_paise)
missions(id, intent, budget_paise, state, created_at, updated_at)
orders(order_id, mission_id, cart_id, amount_paise, payment_link_id, payment_link_url, status, created_at)
audit_events(id, correlation_id, action, reason, details, timestamp, merkle_hash)
webhook_events(event_id, event_type, payload, received_at, processed_at, processing_result)
negotiation_sessions(session_id, merchant_id, session_json, created_at)
approvals(id, mission_id, rule_evals, reason, state, decided_by, decided_at, created_at)
```

## Incident Log

| Date | Issue | Fix |
|------|-------|-----|
| 2025-08-29 | `require()` calls in ESM module | Converted to top-level imports |
| 2025-08-29 | MCP server syntax errors (stray `{`) | Complete rewrite of tool list |
| 2025-08-29 | `bun test` ESM URL scheme error | Use `bun` not `node` |
| 2025-08-30 | Demo agent not finding products | Extended catalog search to name/category |
| 2025-08-30 | Mission ID format mismatch | Use `insertMission()` return value |
| 2025-08-30 | Razorpay rate limit (30/hour) | Added graceful 429 handling to agent |

## References

- Razorpay API Docs: https://razorpay.com/docs/api
- Bun SQLite: https://bun.sh/docs/api/sqlite
- Model Context Protocol: https://modelcontextprotocol.io