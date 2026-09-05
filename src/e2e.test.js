/**
 * End-to-end gate for the integrated stack.
 *
 * Boots the real Express app, points the buyer agent at it over HTTP, and
 * drives complete journeys: mission → catalog → quote → policy → order →
 * signed webhook → CONFIRMED. Razorpay is stubbed at the module boundary so no
 * network is involved; everything else is production code.
 */
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolated database, ephemeral port: the suite must not collide with a
// developer's running server, and bun test may load src/config.js long before
// this file executes.
process.env.AGENTTILL_DB_PATH = path.join(tmpdir(), `agenttill-e2e-${Date.now()}.db`);
process.env.RAZORPAY_WEBHOOK_SECRET = "e2e_webhook_secret";

import { test, expect, mock, beforeAll, afterAll } from "bun:test";

let orderSeq = 0;
let lastOrderAmountPaise = 0;

const sdk = {
  createOrder: mock(async ({ amountPaise }) => {
    lastOrderAmountPaise = amountPaise;
    return { id: `order_e2e_${(orderSeq += 1)}`, amount: amountPaise };
  }),
  createPaymentLink: mock(async () => ({ id: "plink_e2e", short_url: "https://rzp.io/e2e" })),
  fetchPayment: mock(async (paymentId) => ({ id: paymentId, amount: lastOrderAmountPaise, status: "captured" })),
  refundPayment: mock(async (paymentId) => ({ id: "rfnd_e2e", payment_id: paymentId })),
};
mock.module("./razorpay-client.js", () => sdk);

const { app } = await import("./server.js");
const { config } = await import("./config.js");
const { seedCatalog } = await import("./catalog.js");
const { resetDemoData } = await import("./db.js");
const { runMission, extractKeywords } = await import("./agent/agent.js");
const { setAgentApiBase } = await import("./agent/tools.js");

let server;
let BASE;

beforeAll(async () => {
  resetDemoData();
  seedCatalog();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  BASE = `http://127.0.0.1:${server.address().port}`;
  // Point the in-process buyer agent at the port we actually bound.
  setAgentApiBase(BASE);
});

afterAll(() => {
  server?.close();
});

const json = (res) => res.json();
const post = (url, body) =>
  fetch(`${BASE}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function waitFor(predicate, { timeoutMs = 20000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function missionState(missionId) {
  const { mission } = await json(await fetch(`${BASE}/api/missions/${missionId}`));
  return mission.state;
}

test("health and catalog are served", async () => {
  const health = await json(await fetch(`${BASE}/health`));
  expect(health.ok).toBe(true);

  const { products } = await json(await fetch(`${BASE}/api/catalog`));
  expect(products.length).toBeGreaterThan(0);
  expect(products[0]).toMatchObject({ sku: expect.any(String), pricePaise: expect.any(Number) });
});

test("agent resolves intents against the /api catalog", () => {
  expect(extractKeywords("restock: notebooks, markers and coffee")).toEqual(["notebook", "marker", "coffee"]);
});

test("full happy path: mission → order → signed webhook → CONFIRMED", async () => {
  // OFF-MARK-BLK is ₹45 — under the ₹1,000 approval gate, so policy allows it.
  const { missionId } = await json(await post("/api/missions", { intent: "restock: markers", budgetPaise: 100000 }));

  await waitFor(async () => (await missionState(missionId)) === "PAYING", { label: "mission to reach PAYING" });
  expect(sdk.createOrder.mock.calls.length).toBeGreaterThan(0);

  const { order } = await json(await fetch(`${BASE}/api/missions/${missionId}`));
  expect(order).toBeTruthy();
  expect(order.paymentLinkUrl).toBe("https://rzp.io/e2e");

  const payload = Buffer.from(
    JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_e2e_happy", order_id: order.orderId, amount: order.amountPaise } } },
    }),
  );
  const signature = createHmac("sha256", config.razorpayWebhookSecret).update(payload).digest("hex");
  const hookRes = await fetch(`${BASE}/webhooks/razorpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Razorpay-Event-Id": "evt_e2e_happy", "X-Razorpay-Signature": signature },
    body: payload,
  });
  expect(hookRes.status).toBe(200);

  await waitFor(async () => (await missionState(missionId)) === "CONFIRMED", { label: "mission to reach CONFIRMED" });

  const { timeline } = await json(await fetch(`${BASE}/api/audit/${missionId}`));
  const actions = timeline.map((e) => e.action);
  expect(actions).toContain("create_order");
  expect(actions).toContain("confirm_payment");

  // Regression guard: the audit view renders these exact field names.
  expect(timeline[0]).toMatchObject({
    eventId: expect.any(String),
    ts: expect.any(String),
    action: expect.any(String),
    outcome: expect.any(String),
  });

  const receipt = await json(await fetch(`${BASE}/api/audit/${missionId}/receipt`));
  expect(receipt.root).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.nodes.leaves).toHaveLength(4);
});

test("gate path: cart above the approval threshold pauses for a human", async () => {
  // IT-HUBB-4PT is ₹1,899 — above the ₹1,000 gate, under the ₹2,500 basket cap.
  const { missionId } = await json(await post("/api/missions", { intent: "restock: hubs", budgetPaise: 200000 }));

  await waitFor(async () => (await missionState(missionId)) === "AWAITING_APPROVAL", {
    label: "mission to be gated",
  });

  const { approvals } = await json(await fetch(`${BASE}/api/approvals`));
  const pending = approvals.find((a) => a.missionId === missionId && a.status === "pending");
  expect(pending).toBeTruthy();
  expect(pending.ruleEvals.find((r) => r.ruleId === "approval_above").outcome).toBe("triggered");

  const callsBefore = sdk.createOrder.mock.calls.length;
  const { checkout } = await json(await post(`/api/approvals/${pending.approvalId}/approve`, {}));
  expect(checkout.status).toBe("created");
  expect(sdk.createOrder.mock.calls.length).toBe(callsBefore + 1);

  await waitFor(async () => (await missionState(missionId)) === "PAYING", { label: "resumed mission to reach PAYING" });
});

test("deny path: a non-allowlisted category is refused with rule evaluations", async () => {
  const quote = await json(
    await post("/api/quote", { items: [{ sku: "CAT-LUNC-BOX", qty: 1 }] }),
  );
  const res = await post("/api/checkout", { cartId: quote.cartId });
  expect(res.status).toBe(403);

  const body = await json(res);
  expect(body.error.code).toBe("POLICY_DENIED");
  expect(body.ruleEvals.find((r) => r.ruleId === "category_allowlist").outcome).toBe("fail");
});

test("M2: a tampered cart total is rejected before any SDK call", async () => {
  const quote = await json(await post("/api/quote", { items: [{ sku: "OFF-MARK-BLK", qty: 1 }] }));
  const { db } = await import("./db.js");
  db.query("UPDATE carts SET total_paise = total_paise + 1 WHERE id = ?").run(quote.cartId);

  const callsBefore = sdk.createOrder.mock.calls.length;
  const res = await post("/api/checkout", { cartId: quote.cartId });
  expect(res.status).toBe(422);
  expect((await json(res)).error.code).toBe("AMOUNT_MISMATCH");
  expect(sdk.createOrder.mock.calls.length).toBe(callsBefore);
});

test("unknown API routes return JSON, never the SPA shell", async () => {
  const res = await fetch(`${BASE}/api/does-not-exist`);
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect((await json(res)).error.code).toBe("NOT_FOUND");
});

test("MCP over HTTP lists tools and searches the catalog", async () => {
  const list = await json(
    await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  );
  const names = list.result.tools.map((t) => t.name);
  expect(names).toContain("search_catalog");
  expect(names).toContain("submit_machine_purchase");

  const call = await json(
    await post("/mcp", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "search_catalog", arguments: { query: "coffee" } },
    }),
  );
  const found = JSON.parse(call.result.content[0].text);
  expect(found.some((p) => p.sku === "SUP-COFF-500")).toBe(true);
});

test("the agent returns a structured result (never null) and the mission is closed", async () => {
  const { missionId } = await json(
    await post("/api/missions", { intent: "buy a time machine", budgetPaise: 100000 }),
  );

  const result = await runMission({ missionId, intent: "buy a time machine", budgetPaise: 100000 });
  expect(result).toBeTruthy();
  expect(result.status).toBe("no_products");

  await waitFor(async () => (await missionState(missionId)) === "CANCELLED", {
    label: "abandoned mission to be cancelled",
  });
});
