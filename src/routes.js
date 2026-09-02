import express from "express";
import { z } from "zod";
import { getCatalog, quoteItems, persistQuote } from "./catalog.js";
import { createOrder } from "./money-actions.js";
import { createMission, listAllMissions, getMission } from "./missions.js";
import { listApprovals, resolveApproval } from "./approvals.js";
import { getMissionTimeline } from "./audit.js";

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
