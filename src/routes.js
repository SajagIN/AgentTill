/**
 * API routers — thin by law (R5): zod-validate at the edge → call a module →
 * shape the response. No business logic lives here.
 */
import express from "express";
import { z } from "zod";
import { getCatalog, quoteItems, persistQuote } from "./catalog.js";
import { createOrder } from "./money-actions.js";
import { listAllMissions } from "./missions.js";

export const api = express.Router();

/** Wrap async handlers so rejections reach the error middleware (R4). */
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
    actor: { type: "human", id: "operator" }, // agent actor arrives with Phase 6 tools
  });
  if (result.status === "created") return res.status(200).json(result);
  return res.status(403).json({ ...result, error: { code: "POLICY_DENIED", message: result.reason } });
}));

api.get("/missions", (_req, res) => {
  res.json({ missions: listAllMissions() });
});
