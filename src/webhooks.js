import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { isDuplicateWebhookEvent, recordWebhookEvent } from "./db.js";
import { confirmPayment, noteFailedPayment, noteRefundProcessed } from "./money-actions.js";
import {
  WebhookMisconfiguredError,
  WebhookPayloadError,
  WebhookVerificationError,
} from "./errors.js";


const SUPPORTED_EVENT_TYPES = new Set(["payment.captured", "payment.failed", "refund.processed"]);

export function isSupportedEventType(eventType) {
  return SUPPORTED_EVENT_TYPES.has(eventType);
}

// Timing-safe HMAC-SHA256 verification over the raw request body bytes.
export function verifySignature(rawBody, signature) {
  if (!config.razorpayWebhookSecret) {
    throw new WebhookMisconfiguredError();
  }
  const expected = createHmac("sha256", config.razorpayWebhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature ?? ""), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new WebhookVerificationError("webhook signature verification failed");
  }
}

export async function processWebhook({ eventId, rawBody, signature }) {
  verifySignature(rawBody, signature);

  if (!eventId) {
    throw new WebhookPayloadError("missing X-Razorpay-Event-Id header");
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new WebhookPayloadError("webhook body is not valid JSON");
  }
  const eventType = typeof body.event === "string" ? body.event : "unknown";

  if (isDuplicateWebhookEvent(eventId)) {
    console.log(`[webhook] duplicate ${eventId} (${eventType}) — stored, not reprocessed`);
    return { duplicate: true, eventType };
  }

  console.log(`[webhook] processing ${eventId} (${eventType})`);
  if (body?.payload) {
    const entityKey = Object.keys(body.payload)[0];
    const entity = body.payload[entityKey]?.entity;
    if (entity) console.log(`[webhook] payload ${eventType}·${entityKey}: ${JSON.stringify(entity)}`);
  }

  let result;
  if (eventType === "payment.captured" || eventType === "payment.failed") {
    const entity = body?.payload?.payment?.entity;
    if (!entity?.order_id || !entity?.id) {
      throw new WebhookPayloadError(`malformed ${eventType} payload: missing payload.payment.entity ids`);
    }
    result =
      eventType === "payment.captured"
        ? await confirmPayment({
            orderId: entity.order_id,
            paymentId: entity.id,
            missionHint: entity.notes?.missionId ?? entity.notes?.correlationId ?? null,
            source: "webhook",
          })
        : await noteFailedPayment({
            orderId: entity.order_id,
            paymentId: entity.id,
            missionHint: entity.notes?.missionId ?? entity.notes?.correlationId ?? null,
            amountPaise: entity.amount,
            reason: entity.error_description ?? "payment.failed webhook",
          });
  } else if (eventType === "refund.processed") {
    const entity = body?.payload?.refund?.entity;
    result = await noteRefundProcessed({
      refundId: entity?.id,
      paymentId: entity?.payment_id,
      amountPaise: entity?.amount,
    });
  } else {
    result = {
      status: "ignored",
      reason: isSupportedEventType(eventType) ? "no handler" : `unhandled event type: ${eventType}`,
    };
  }

  recordWebhookEvent(eventId, eventType);
  console.log(`[webhook] done ${eventId} (${eventType}) → ${JSON.stringify(result)}`);
  return { duplicate: false, eventType, result };
}

export function webhookHandler(req, res, next) {
  processWebhook({
    eventId: req.get("X-Razorpay-Event-Id"),
    rawBody: req.body,
    signature: req.get("X-Razorpay-Signature"),
  })
    .then((out) => res.status(200).json({ received: true, ...out }))
    .catch(next);
}
