/**
 * Smoke script — quote → money-actions.createOrder → print order + link + timeline.
 *
 * Phase 2 rewrite: the direct Razorpay SDK import is GONE. This now exercises
 * the real money path (authorize → execute → audit), so the M3 grep test
 * ("razorpay-client" imported only by money-actions.js) stays green.
 * Uses a fresh ad-hoc mission; safe to run repeatedly (test mode).
 */
import { quoteItems, persistQuote } from "../src/catalog.js";
import { createOrder } from "../src/money-actions.js";
import { getMissionTimeline } from "../src/audit.js";

const ACTOR = { type: "human", id: "smoke-script" };

try {
  const quote = quoteItems([{ sku: "OFF-NOTE-A4", qty: 3 }]); // ₹179.70 = 17970 paise
  if (!quote.ok) throw new Error(`quote failed: ${quote.unknownSkus.join(", ")}`);
  const cartId = persistQuote(quote.lines, quote.totalPaise);
  console.log(`cart ${cartId} quoted at ${quote.totalPaise} paise`);

  const result = await createOrder({ cartId, actor: ACTOR });
  console.log("── checkout result ──");
  console.log(JSON.stringify(result, null, 2));

  const checks = [
    ["status === 'created'", result.status === "created"],
    ["orderId starts with order_", typeof result.orderId === "string" && result.orderId.startsWith("order_")],
    ["paymentLinkUrl is https", typeof result.paymentLinkUrl === "string" && result.paymentLinkUrl.startsWith("https://")],
    [`amountPaise === ${quote.totalPaise}`, result.amountPaise === quote.totalPaise],
  ];
  for (const [label, ok] of checks) console.log(`${ok ? "✔" : "✘"} ${label}`);

  const timeline = getMissionTimeline(result.missionId);
  console.log(`── audit timeline for ${result.missionId} (${timeline.length} event) ──`);
  for (const e of timeline) {
    console.log(`  ${e.ts} ${e.action} ${e.outcome} · ${e.amountPaise ?? "-"} paise · ${e.eventId}`);
  }
  if (checks.some(([, ok]) => !ok) || timeline.length < 1) process.exit(1);
  console.log("SMOKE OK");
} catch (err) {
  // Wrapped, greppable, no secrets (R3/R4). 401/502 here usually means
  // placeholder keys in .env — paste real test keys from the dashboard.
  console.error("smoke-order failed:", err?.message ?? err);
  process.exit(1);
}
