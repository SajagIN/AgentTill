/**
 * Webhook gates (R8): forged signature → 401-class rejection with ZERO state
 * change; duplicate delivery → single processing. Offline unit tests — no
 * network, no Razorpay. The live tunnel run (Phase 3 acceptance) proves the
 * real delivery path; these make the guarantees repeatable.
 *
 * NOTE: requires RAZORPAY_WEBHOOK_SECRET in .env (it's a Phase 3 requirement
 * anyway — Dashboard → Settings → Webhooks).
 */
import { test, expect, beforeAll } from "bun:test";
import { createHmac } from "node:crypto";
import { processWebhook, isSupportedEventType } from "./webhooks.js";
import { WebhookVerificationError } from "./errors.js";
import { isDuplicateWebhookEvent } from "./db.js";

const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
const BODY = JSON.stringify({ event: "ping.test", payload: {} });
const sign = (body) => createHmac("sha256", secret).update(body).digest("hex");

beforeAll(() => {
  if (!secret) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET missing — set it in .env (same value as the dashboard webhook)");
  }
});

test("forged signature is rejected with zero state change", async () => {
  const eventId = `evt_testforge_${Date.now()}`;
  await expect(
    processWebhook({ eventId, rawBody: Buffer.from(BODY), signature: "deadbeefdeadbeef" }),
  ).rejects.toBeInstanceOf(WebhookVerificationError);
  expect(isDuplicateWebhookEvent(eventId)).toBe(false); // nothing recorded
});

test("signature over a different body does not verify (tamper)", async () => {
  const tampered = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_fake", order_id: "order_fake" } } } });
  await expect(
    processWebhook({
      eventId: `evt_testtamper_${Date.now()}`,
      rawBody: Buffer.from(tampered),
      signature: sign(BODY), // valid sig for the ORIGINAL body
    }),
  ).rejects.toBeInstanceOf(WebhookVerificationError);
});

test("valid signature processes once; duplicate delivery is a no-op", async () => {
  const eventId = `evt_testdup_${Date.now()}`;
  const first = await processWebhook({ eventId, rawBody: Buffer.from(BODY), signature: sign(BODY) });
  expect(first.duplicate).toBe(false);

  const second = await processWebhook({ eventId, rawBody: Buffer.from(BODY), signature: sign(BODY) });
  expect(second.duplicate).toBe(true);
  expect(isDuplicateWebhookEvent(eventId)).toBe(true); // exactly one record
});

test("missing event id is rejected before any processing", async () => {
  await expect(
    processWebhook({ eventId: undefined, rawBody: Buffer.from(BODY), signature: sign(BODY) }),
  ).rejects.toThrow(/event-id/i);
});

test("unhandled event types are stored and ignored, not errors", async () => {
  const eventId = `evt_testping_${Date.now()}`;
  const out = await processWebhook({ eventId, rawBody: Buffer.from(BODY), signature: sign(BODY) });
  expect(out.result.status).toBe("ignored");
  expect(isSupportedEventType("ping.test")).toBe(false);
  expect(isSupportedEventType("payment.captured")).toBe(true);
});

test("payment-link correlation: internal order_id misses, notes.missionId resolves our order", async () => {
  // Mirrors the live 2026-08-23 finding: link payments carry the LINK's internal
  // order id; our notes ride on the payment entity.
  const { resolveOrderForPayment } = await import("./money-actions.js");
  const { insertMission, saveOrder } = await import("./db.js");

  const missionId = insertMission("correlation test", 500000, "PAYING");
  saveOrder({
    orderId: `order_ours_${missionId.slice(-6)}`,
    missionId,
    cartId: "cart_test01",
    amountPaise: 11980,
    paymentLinkId: "plink_test",
    paymentLinkUrl: "https://example.com/l",
    status: "created",
  });

  const resolved = resolveOrderForPayment({
    orderId: `order_internal_${missionId.slice(-6)}`, // NOT ours
    missionHint: missionId, // from payment.notes.missionId
  });
  expect(resolved).toBeDefined();
  expect(resolved.missionId).toBe(missionId);
  expect(resolved.amountPaise).toBe(11980);

  const direct = resolveOrderForPayment({ orderId: `order_ours_${missionId.slice(-6)}`, missionHint: null });
  expect(direct?.missionId).toBe(missionId);

  const nothing = resolveOrderForPayment({ orderId: "order_unknown", missionHint: null });
  expect(nothing).toBeUndefined();
});
