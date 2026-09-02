/**
 * M3 proof gates (R8): the money path never touches the SDK unless policy
 * allows. razorpay-client is stubbed AT THE MODULE BOUNDARY (test-only) and
 * every stub starts as a booby-trap that throws — so any unexpected call
 * fails loudly. Covers: needs_approval (no SDK), budget deny (no SDK),
 * approve → resume → order created (exactly one SDK create call).
 */
import { test, expect, mock, beforeAll } from "bun:test";

const boom = (name) => () => {
  throw new Error(`SDK booby-trap: ${name} must not be called`);
};
const sdk = {
  createOrder: mock(boom("createOrder")),
  createPaymentLink: mock(boom("createPaymentLink")),
  fetchPayment: mock(boom("fetchPayment")),
  refundPayment: mock(boom("refundPayment")),
};
mock.module("./razorpay-client.js", () => sdk);

const { createOrder } = await import("./money-actions.js");
const { resolveApproval } = await import("./approvals.js");
const { getMission } = await import("./missions.js");
const { replaceAllProducts } = await import("./db.js");
const { SEED_PRODUCTS, quoteItems, persistQuote } = await import("./catalog.js");

const ACTOR = { type: "human", id: "tester" };
let gated = null; // state shared across the gate → resume tests

beforeAll(() => {
  replaceAllProducts(SEED_PRODUCTS); // deterministic catalog
});

const cartFor = (skusWithQty) => {
  const q = quoteItems(skusWithQty);
  if (!q.ok) throw new Error(`quote failed: ${q.unknownSkus.join(",")}`);
  return persistQuote(q.lines, q.totalPaise);
};

test("cart above approval threshold → needs_approval, ZERO SDK calls, mission AWAITING", async () => {
  // IT-HUBB-4PT = 189900 paise: under basket (250000), over threshold (100000).
  const cartId = cartFor([{ sku: "IT-HUBB-4PT", qty: 1 }]);
  const result = await createOrder({ cartId, actor: ACTOR });

  expect(result.status).toBe("needs_approval");
  expect(result.approvalId).toBeDefined();
  expect(result.reason).toContain("approval threshold");
  expect(sdk.createOrder.mock.calls.length).toBe(0); // booby-trap never tripped
  expect(sdk.createPaymentLink.mock.calls.length).toBe(0);
  expect(getMission(result.missionId).state).toBe("AWAITING_APPROVAL");

  gated = { approvalId: result.approvalId, missionId: result.missionId, cartId };
});

test("cart over mission budget → denied, ZERO SDK calls, mission REJECTED", async () => {
  const cartId = cartFor([{ sku: "IT-HUBB-4PT", qty: 1 }]); // 189900 paise
  const { createMission } = await import("./missions.js");
  const m = createMission({ intent: "budget test", budgetPaise: 50000 }); // ₹500 budget

  const callsBefore = sdk.createOrder.mock.calls.length;
  const result = await createOrder({ missionId: m.missionId, cartId, actor: ACTOR });
  expect(result.status).toBe("denied");
  expect(result.reason).toContain("mission budget");
  expect(sdk.createOrder.mock.calls.length).toBe(callsBefore); // ZERO new SDK calls
  expect(getMission(m.missionId).state).toBe("REJECTED");
});

test("approve → resume → order created with exactly one SDK create call", async () => {
  const { approvalId, cartId } = gated;

  const approval = resolveApproval({ approvalId, decision: "approved" });
  expect(approval.status).toBe("approved");

  // Swap the booby-trap for a controlled stub — the ONE allowed call.
  sdk.createOrder.mockImplementation(() => ({ id: "order_mock_resume_1" }));
  sdk.createPaymentLink.mockImplementation(() => ({ id: "plink_mock", short_url: "https://rzp.io/rzp/mockpay" }));

  const result = await createOrder({
    missionId: approval.missionId,
    cartId,
    approvalId,
    actor: ACTOR,
  });

  expect(result.status).toBe("created");
  expect(result.orderId).toBe("order_mock_resume_1");
  expect(result.paymentLinkUrl).toBe("https://rzp.io/rzp/mockpay");
  expect(sdk.createOrder.mock.calls.length).toBe(1); // exactly one, ever
  expect(getMission(approval.missionId).state).toBe("PAYING");

  // Restoring the booby-trap guards any future test in this file.
  sdk.createOrder.mockImplementation(boom("createOrder"));
  sdk.createPaymentLink.mockImplementation(boom("createPaymentLink"));
});

test("resume with a bogus approval id → 404 APPROVAL_NOT_FOUND, no SDK call", async () => {
  const cartId = cartFor([{ sku: "IT-HUBB-4PT", qty: 1 }]);
  const { createMission } = await import("./missions.js");
  const m = createMission({ intent: "resume-reject test", budgetPaise: null });
  const callsBefore = sdk.createOrder.mock.calls.length;
  await expect(
    createOrder({ missionId: m.missionId, cartId, approvalId: "appr_does_not_exist", actor: ACTOR }),
  ).rejects.toMatchObject({ status: 404, code: "APPROVAL_NOT_FOUND" });
  expect(sdk.createOrder.mock.calls.length).toBe(callsBefore); // ZERO new SDK calls
});
