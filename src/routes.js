import express from "express";
import { z } from "zod";

import { config } from "./config.js";
import { findLatestOrderByMission, findOrder, getAllPolicyConfigs, updatePolicyConfig } from "./db.js";
import { getCatalog, quoteItems, persistQuote } from "./catalog.js";
import { createMission, getMission, listAllMissions, transition } from "./missions.js";
import { listApprovals, resolveApproval } from "./approvals.js";
import { getMissionTimeline, getMissionReceipt } from "./audit.js";
import { createMandate, getMandate, revokeMandate } from "./mandates.js";
import { createOrder, refund, retryPayment } from "./money-actions.js";
import { processRfq, getSession } from "./negotiation.js";
import { runMission, TERMINAL } from "./agent/agent.js";
import { NotFoundError, ValidationError } from "./errors.js";

export const api = express.Router();

/** Route bodies are validated at the edge; anything else is a programming error. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const issuesFrom = (error) => error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

function parse(schema, body, label) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(`invalid ${label}`, issuesFrom(parsed.error));
  return parsed.data;
}

const idSchema = z.string().min(1).max(128);

const QuoteBody = z
  .object({
    items: z
      .array(z.object({ sku: z.string().min(1).max(64), qty: z.number().int().min(1).max(99) }))
      .min(1, "at least one item is required")
      .max(50, "at most 50 line items per quote"),
  })
  .strict();

const CheckoutBody = z
  .object({
    cartId: z.string().min(6).max(32),
    missionId: z.string().max(64).optional(),
    buyerId: z.string().optional(),
  })
  .strict();

const MissionBody = z
  .object({
    intent: z.string().min(1).max(500),
    budgetPaise: z.number().int().positive().optional(),
  })
  .strict();

const RefundBody = z
  .object({
    paymentId: z.string().min(1).max(64),
    amountPaise: z.number().int().positive(),
    reason: z.string().min(1).max(500),
  })
  .strict();

const RetryBody = z
  .object({
    orderId: z.string().min(1).max(64),
    missionId: z.string().min(1).max(64),
    attempt: z.number().int().min(1).max(2),
  })
  .strict();

const RfqBody = z
  .object({
    items: z
      .array(
        z.object({
          sku: z.string().min(1).max(64),
          qty: z.number().int().min(1),
          target_unit_price_paise: z.number().int().min(1),
        }),
      )
      .min(1),
    session_id: z.string().optional(),
    merchant_id: z.string().optional(),
    buyer_id: z.string().optional(),
    buyer_mandate: z
      .object({ max_amount: z.number().int(), autopay_enabled: z.boolean().optional() })
      .optional(),
  })
  .strict();

const AcceptOfferBody = z
  .object({
    session_id: z.string().min(1),
    option_id: z.string().min(1),
    missionId: z.string().max(64).optional(),
    buyer_id: z.string().optional(),
    buyer_mandate: z.object({ max_amount: z.number().int(), autopay_enabled: z.boolean().optional() }).optional(),
  })
  .strict();

/* ── Catalog & quotes ─────────────────────────────────────────────────────── */

api.get("/catalog", (_req, res) => {
  res.json({ products: getCatalog() });
});

api.post("/quote", wrap((req, res) => {
  const { items } = parse(QuoteBody, req.body, "quote body");
  const result = quoteItems(items);
  if (!result.ok) {
    return res.status(400).json({
      error: {
        code: "UNKNOWN_SKU",
        message: `unknown sku: ${result.unknownSkus.join(", ")}`,
        unknownSkus: result.unknownSkus,
        validSkus: result.validSkus,
      },
    });
  }
  const cartId = persistQuote(result.lines, result.totalPaise);
  res.json({ cartId, items: result.lines, totalPaise: result.totalPaise });
}));

/* ── Checkout ─────────────────────────────────────────────────────────────── */

api.post("/checkout", wrap(async (req, res) => {
  const { cartId, missionId, buyerId } = parse(CheckoutBody, req.body, "checkout body");
  const result = await createOrder({
    cartId,
    missionId,
    actor: { type: buyerId ? "human" : "agent", id: buyerId || "operator" },
  });
  if (result.status === "denied") {
    return res.status(403).json({ ...result, error: { code: "POLICY_DENIED", message: result.reason } });
  }
  res.json(result);
}));

api.post("/orders/:orderId/retry", wrap(async (req, res) => {
  const { missionId, attempt } = parse(RetryBody, req.body, "retry body");
  const result = await retryPayment({
    orderId: req.params.orderId,
    missionId,
    attempt,
    actor: { type: "system", id: "retry-operator" },
  });
  if (result.status === "denied") {
    return res.status(403).json({ ...result, error: { code: "POLICY_DENIED", message: result.reason } });
  }
  res.json(result);
}));

api.post("/refunds", wrap(async (req, res) => {
  const { paymentId, amountPaise, reason } = parse(RefundBody, req.body, "refund body");
  const result = await refund({
    paymentId,
    amountPaise,
    reason,
    actor: { type: "human", id: "operator" },
  });
  if (result.status === "denied") {
    return res.status(403).json({ ...result, error: { code: "POLICY_DENIED", message: result.reason } });
  }
  res.json(result);
}));

/* ── Missions ─────────────────────────────────────────────────────────────── */

/**
 * Agent outcomes that mean "the agent gave up" — the mission is closed so the
 * dashboard never shows a PLANNING row that nothing will ever advance.
 */
const ABANDONED = new Set([
  "no_products",
  "budget_exhausted",
  "api_error",
  "rate_limited",
  "attempts_exhausted",
  "unexpected_response",
]);

function closeMissionIfAbandoned(missionId, status) {
  if (!ABANDONED.has(status)) return;
  const mission = getMission(missionId);
  if (!mission || TERMINAL.has(mission.state)) return;
  try {
    transition(missionId, "CANCELLED");
  } catch (err) {
    console.warn(`[missions] could not cancel ${missionId} from ${mission.state}: ${err.message}`);
  }
}

api.post("/missions", wrap((req, res) => {
  const mission = createMission(parse(MissionBody, req.body, "mission body"));

  runMission(mission)
    .then((result) => closeMissionIfAbandoned(mission.missionId, result.status))
    .catch((err) => {
      console.error(`[agent] mission ${mission.missionId} crashed:`, err);
      closeMissionIfAbandoned(mission.missionId, "api_error");
    });

  res.status(201).json({ missionId: mission.missionId, state: mission.state });
}));

api.get("/missions", (_req, res) => {
  res.json({ missions: listAllMissions() });
});

api.get("/missions/:id", wrap((req, res) => {
  parse(idSchema, req.params.id, "mission id");
  const mission = getMission(req.params.id);
  if (!mission) throw new NotFoundError(`no mission with id ${req.params.id}`);
  res.json({ mission, order: findLatestOrderByMission(mission.missionId) ?? null });
}));

api.get("/missions/:id/timeline", wrap((req, res) => {
  parse(idSchema, req.params.id, "mission id");
  res.json({ timeline: getMissionTimeline(req.params.id) });
}));

api.get("/missions/:id/receipt", wrap((req, res) => {
  parse(idSchema, req.params.id, "mission id");
  const receipt = getMissionReceipt(req.params.id);
  if (!receipt) throw new NotFoundError(`no audit events for ${req.params.id} to build a receipt from`);
  res.json(receipt);
}));

/* ── Approvals ────────────────────────────────────────────────────────────── */

api.get("/approvals", (_req, res) => {
  res.json({ approvals: listApprovals() });
});

api.post("/approvals/:id/approve", wrap(async (req, res) => {
  const approval = resolveApproval({ approvalId: req.params.id, decision: "approved" });
  const checkout = await createOrder({
    missionId: approval.missionId,
    cartId: approval.cartId,
    approvalId: approval.approvalId,
    actor: { type: "human", id: "operator" },
  });
  res.json({ approval, checkout });
}));

api.post("/approvals/:id/deny", wrap((req, res) => {
  const approval = resolveApproval({ approvalId: req.params.id, decision: "denied" });
  res.json({ approval });
}));

/* ── Audit ────────────────────────────────────────────────────────────────── */

const CorrelationIdParam = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_\-]+$/, "correlationId must be alphanumeric with underscores or hyphens");

api.get("/audit/:correlationId", wrap((req, res) => {
  parse(CorrelationIdParam, req.params.correlationId, "correlationId");
  res.json({ timeline: getMissionTimeline(req.params.correlationId) });
}));

api.get("/audit/:correlationId/receipt", wrap((req, res) => {
  parse(CorrelationIdParam, req.params.correlationId, "correlationId");
  const receipt = getMissionReceipt(req.params.correlationId);
  if (!receipt) throw new NotFoundError(`no timeline found for ${req.params.correlationId}`);
  res.json(receipt);
}));

/* ── Policies ─────────────────────────────────────────────────────────────── */

api.get("/policies", (_req, res) => {
  res.json({ policies: getAllPolicyConfigs() });
});

api.put("/policies/:key", wrap((req, res) => {
  const key = parse(z.string().min(1).max(64), req.params.key, "policy key");
  const value = parse(z.record(z.string(), z.union([z.number(), z.array(z.string())])), req.body, "policy value");
  updatePolicyConfig(key, value);
  res.json({ key, value });
}));

/* ── Mandates ─────────────────────────────────────────────────────────────── */

api.get("/mandates/:buyerId", wrap((req, res) => {
  const buyerId = parse(idSchema, req.params.buyerId, "buyerId");
  const mandate = getMandate(buyerId);
  if (!mandate) throw new NotFoundError(`no active mandate for ${buyerId}`);
  res.json({ mandate });
}));

api.post("/mandates", wrap((req, res) => {
  const { buyerId, maxAmountPaise } = parse(
    z.object({ buyerId: z.string().min(1).max(64), maxAmountPaise: z.number().int().positive() }).strict(),
    req.body,
    "mandate body",
  );
  const mandateId = createMandate(buyerId, maxAmountPaise);
  res.status(201).json({ mandateId, buyerId, maxAmountPaise });
}));

api.delete("/mandates/:mandateId", wrap((req, res) => {
  const mandateId = parse(idSchema, req.params.mandateId, "mandateId");
  revokeMandate(mandateId);
  res.json({ mandateId, status: "revoked" });
}));

/* ── Negotiation ──────────────────────────────────────────────────────────── */

api.post("/negotiate/rfq", wrap((req, res) => {
  const body = parse(RfqBody, req.body, "rfq body");
  res.json(processRfq(body));
}));

api.post("/negotiate/accept", wrap(async (req, res) => {
  const { session_id, option_id, missionId, buyer_id, buyer_mandate } = parse(
    AcceptOfferBody,
    req.body,
    "accept-offer body",
  );
  const session = getSession(session_id);
  if (!session) throw new NotFoundError(`no negotiation session ${session_id}`);

  const option = session.counter_offers?.[option_id];
  if (!option) throw new ValidationError(`session ${session_id} has no option "${option_id}"`);

  const catalog = getCatalog();
  const categoryOf = (sku) => catalog.find((p) => p.sku === sku)?.category ?? "unknown";
  const listPriceOf = (sku) => catalog.find((p) => p.sku === sku)?.pricePaise ?? 0;

  const lines = [];
  const qty = option.new_qty || session.primary_item.qty;
  lines.push({
    sku: session.primary_item.sku,
    name: session.primary_item.name ?? session.primary_item.sku,
    category: categoryOf(session.primary_item.sku),
    qty,
    unitPaise: option.unit_price_paise,
    linePaise: option.unit_price_paise * qty,
  });

  for (const bundle of option.bundled_items ?? []) {
    lines.push({
      sku: bundle.addon_sku,
      name: bundle.addon_name,
      category: categoryOf(bundle.addon_sku),
      qty: bundle.addon_qty,
      unitPaise: bundle.discounted_price_paise,
      linePaise: bundle.discounted_price_paise * bundle.addon_qty,
    });
  }

  // The cart stores the LIST total so the M2 re-total check passes; the
  // negotiated total rides alongside it and is what policy authorises.
  const listTotalPaise = lines.reduce((sum, line) => sum + listPriceOf(line.sku) * line.qty, 0);
  const cartId = persistQuote(lines, listTotalPaise, option.total_amount_paise);

  if (buyer_id && buyer_mandate) {
    const existing = getMandate(buyer_id);
    if (existing) revokeMandate(existing.id);
    createMandate(buyer_id, buyer_mandate.max_amount);
  }

  const checkout = await createOrder({
    cartId,
    missionId,
    actor: { type: "agent", id: buyer_id || "negotiator" },
  });

  if (checkout.status === "denied") {
    return res.status(403).json({
      settled: true,
      option_id,
      cartId,
      checkout: { ...checkout, error: { code: "POLICY_DENIED", message: checkout.reason } },
    });
  }

  res.json({ settled: true, option_id, cartId, checkout });
}));

/* ── Diagnostics ──────────────────────────────────────────────────────────── */

api.get("/orders/:orderId", wrap((req, res) => {
  const orderId = parse(idSchema, req.params.orderId, "orderId");
  const order = findOrder(orderId);
  if (!order) throw new NotFoundError(`no order with id ${orderId}`);
  res.json({ order });
}));

api.get("/config", (_req, res) => {
  // Public, non-secret view of what the deployment is wired to.
  res.json({
    baseUrl: config.baseUrl,
    razorpayKeyMode: config.razorpayKeyId.startsWith("rzp_test_") ? "test" : "live",
    webhookConfigured: config.razorpayWebhookSecret.length > 0,
  });
});
