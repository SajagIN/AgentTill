import express from "express";
import { z } from "zod";
import { getCatalog, quoteItems, persistQuote } from "./catalog.js";
import { createOrder } from "./money-actions.js";
import { createMission, listAllMissions, getMission } from "./missions.js";
import { listApprovals, resolveApproval } from "./approvals.js";
import { getMissionTimeline } from "./audit.js";

import { processRfq, getSession } from "./negotiation.js";
export const api = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const QuoteBody = z
  .object({
    items: z
      .array(
        z.object({
          sku: z.string().min(1).max(64),
          qty: z.number().int().min(1).max(99),
        }),
      )
      .min(1, "at least one item is required")
      .max(50, "at most 50 line items per quote"),
  })
  .strict();

const CheckoutBody = z
  .object({
    cartId: z.string().min(6).max(32),
    missionId: z.string().max(64).optional(),
  })
  .strict();

api.get("/catalog", (_req, res) => {
  res.json({ products: getCatalog() });
});

api.post("/quote", (req, res) => {
  const parsed = QuoteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "invalid quote body",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
    });
  }
  const result = quoteItems(parsed.data.items);
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
  res.status(200).json({ cartId, items: result.lines, totalPaise: result.totalPaise });
});

api.post("/checkout", wrap(async (req, res) => {
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "invalid checkout body",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
    });
  }
  const result = await createOrder({
    cartId: parsed.data.cartId,
    missionId: parsed.data.missionId,
    actor: { type: "human", id: "operator" },
  });
  if (result.status === "denied") {
    return res.status(403).json({ ...result, error: { code: "POLICY_DENIED", message: result.reason } });
  }
  return res.status(200).json(result);
}));

const MissionBody = z
  .object({
    intent: z.string().min(1).max(500),
    budgetPaise: z.number().int().positive().optional(),
  })
  .strict();

api.post("/missions", (req, res) => {
  const parsed = MissionBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "invalid mission body",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
    });
  }
  const { missionId } = createMission(parsed.data);
  return res.status(201).json({ missionId });
});

api.get("/missions", (_req, res) => {
  res.json({ missions: listAllMissions() });
});

api.get("/missions/:id", (req, res) => {
  const mission = getMission(req.params.id);
  if (!mission) {
    return res.status(404).json({
      error: { code: "MISSION_NOT_FOUND", message: `no mission with id ${req.params.id}` },
    });
  }
  res.json({ mission });
});

const CorrelationIdParam = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_\-]+$/, "correlationId must be alphanumeric with underscores or hyphens");

api.get("/audit/:correlationId", wrap(async (req, res) => {
  const parsed = CorrelationIdParam.safeParse(req.params.correlationId);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "invalid correlationId",
        issues: parsed.error.issues.map((i) => i.message),
      },
    });
  }

  let timeline;
  try {
    timeline = getMissionTimeline(parsed.data);
  } catch (err) {
    return res.status(500).json({
      error: { code: "DB_ERROR", message: "failed to retrieve audit timeline" },
    });
  }

  if (timeline.length === 0) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `no timeline found for correlationId: ${parsed.data}`,
      },
    });
  }

  return res.status(200).json({ timeline });
}));

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

api.post("/approvals/:id/deny", wrap(async (req, res) => {
  const approval = resolveApproval({ approvalId: req.params.id, decision: "denied" });
  res.json({ approval });
}));


const RfqBody = z.object({
  items: z.array(z.object({
    sku: z.string(),
    qty: z.number().int().min(1),
    target_unit_price_paise: z.number().int().min(1)
  })).min(1),
  session_id: z.string().optional(),
  merchant_id: z.string().optional()
});

api.post("/negotiate/rfq", (req, res) => {
  const parsed = RfqBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_ERROR", issues: parsed.error.issues });
  }
  try {
    const result = processRfq(parsed.data);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: "BAD_REQUEST", message: err.message });
  }
});

api.post("/negotiate/accept", wrap(async (req, res) => {
  const { session_id, option_id, missionId } = req.body;
  if (!session_id || !option_id) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "session_id and option_id required" });
  }
  const session = getSession(session_id);
  if (!session) {
    return res.status(404).json({ error: "NOT_FOUND", message: "session not found" });
  }
  const option = session.counter_offers[option_id];
  if (!option) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "invalid option_id" });
  }

  // Build a cart out of the negotiated option
  const cartLines = [];
  
  // Primary
  cartLines.push({
    sku: session.primary_item.sku,
    name: session.primary_item.name || session.primary_item.sku, 
    qty: session.primary_item.qty,
    unitPaise: option.unit_price_paise,
    linePaise: option.unit_price_paise * session.primary_item.qty
  });

  // Companions
  if (option.bundled_items) {
    for (const b of option.bundled_items) {
      cartLines.push({
        sku: b.addon_sku,
        name: b.addon_name,
        qty: b.addon_qty,
        unitPaise: b.discounted_price_paise,
        linePaise: b.discounted_price_paise * b.addon_qty
      });
    }
  }

  const cartId = persistQuote(cartLines, option.total_amount_paise);

  // Directly create order
  const result = await createOrder({
    cartId: cartId,
    missionId: missionId,
    actor: { type: "agent", id: "negotiator" },
  });

  res.json({
    settled: true,
    option_id,
    cartId,
    checkout: result
  });
}));

