/**
 * API routers — thin by law (R5): zod-validate at the edge → call a module →
 * shape the response. No business logic lives here.
 */
import express from "express";
import { z } from "zod";
import { getCatalog, quoteItems, persistQuote } from "./catalog.js";

export const api = express.Router();

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
  .strict(); // reject unknown fields (cheap — R3)

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
