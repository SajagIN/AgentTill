import { randomUUID } from "node:crypto";
import { findProduct } from "./db.js";

const negotiationSessions = new Map();

// Margin floors and caps
const MIN_MARGIN_PCT = 15.0;
const MAX_DISCOUNT_PCT = 20.0;

export function processRfq(body) {
  const sessionId = body.session_id || `neg_${randomUUID().substring(0, 12)}`;
  const merchantId = body.merchant_id || "m_001";
  
  if (!body.items || body.items.length === 0) {
    throw new Error("No items in RFQ");
  }

  let totalCatalogPaise = 0;
  let totalCostPaise = 0;
  let totalBuyerTargetPaise = 0;
  const productMap = {};

  for (const item of body.items) {
    const product = findProduct(item.sku);
    if (!product) {
      return {
        status: "REJECTED_SKU_NOT_FOUND",
        session_id: sessionId,
        reason: `Product with SKU '${item.sku}' not found in store catalog.`
      };
    }
    productMap[item.sku] = product;
    totalCatalogPaise += product.pricePaise * item.qty;
    
    // Assume cost is 70% of catalog.
    const productCost = Math.floor(product.pricePaise * 0.7);
    totalCostPaise += productCost * item.qty;
    totalBuyerTargetPaise += item.target_unit_price_paise * item.qty;
  }

  const proposedMargin = totalBuyerTargetPaise <= 0 ? 0 : 
    ((totalBuyerTargetPaise - totalCostPaise) / totalBuyerTargetPaise) * 100;

  const isFloorBreached = proposedMargin < MIN_MARGIN_PCT;

  const minAllowedTotal = Math.floor(totalCostPaise / (1 - (MIN_MARGIN_PCT / 100)));
  const primaryItem = body.items[0];
  const primaryProd = productMap[primaryItem.sku];
  const unitCatalog = primaryProd.pricePaise;
  const unitTarget = primaryItem.target_unit_price_paise;
  
  const clampedUnitTarget = Math.max(unitTarget, Math.floor(minAllowedTotal / primaryItem.qty));

  const counterOffers = [];
  const profitBuyerTarget = totalBuyerTargetPaise - totalCostPaise;

  // Case 1: Buyer proposes price very close to or above catalog price (<= 2% discount)
  if (unitTarget >= Math.floor(unitCatalog * 0.98)) {
    const directUnitPrice = Math.min(unitTarget, unitCatalog);
    const directTotal = directUnitPrice * primaryItem.qty;
    const directMargin = ((directTotal - totalCostPaise) / directTotal) * 100;
    const directDiscPct = Math.max(0, ((totalCatalogPaise - directTotal) / totalCatalogPaise) * 100);

    counterOffers.push({
      option_id: "OPT_DIRECT_PRICE",
      option_type: "DIRECT_PRICE_COUNTER",
      title: `Direct Acceptance: ₹${(directUnitPrice/100).toFixed(2)}/unit`,
      description: `Your proposed price matches our terms. Direct fulfillment authorized.`,
      unit_price_paise: directUnitPrice,
      total_amount_paise: directTotal,
      discount_pct: Number(directDiscPct.toFixed(2)),
      projected_gross_margin_pct: Number(directMargin.toFixed(2)),
      margin_floor_satisfied: directMargin >= MIN_MARGIN_PCT
    });
  } else {
    // Case 2: Standard volume discount negotiation (guarantees margin floor)
    const compromiseUnitPrice = Math.max(clampedUnitTarget, Math.floor(unitTarget + ((unitCatalog - unitTarget) * 0.35)));
    const compromiseTotal = compromiseUnitPrice * primaryItem.qty;
    const compromiseMargin = ((compromiseTotal - totalCostPaise) / compromiseTotal) * 100;
    const compromiseDiscountPct = ((totalCatalogPaise - compromiseTotal) / totalCatalogPaise) * 100;
    const profitCompromise = compromiseTotal - totalCostPaise;

    counterOffers.push({
      option_id: "OPT_PRICE_COMPROMISE",
      option_type: "DIRECT_PRICE_COUNTER",
      title: `Direct Unit Price Counter: ₹${(compromiseUnitPrice/100).toFixed(2)}/unit`,
      description: `We can fulfill ${primaryItem.qty}x ${primaryProd.name} at ₹${(compromiseUnitPrice/100).toFixed(2)}/unit.`,
      unit_price_paise: compromiseUnitPrice,
      total_amount_paise: compromiseTotal,
      discount_pct: Number(compromiseDiscountPct.toFixed(2)),
      projected_gross_margin_pct: Number(compromiseMargin.toFixed(2)),
      margin_floor_satisfied: compromiseMargin >= MIN_MARGIN_PCT,
      merchant_profit_lift_paise: Math.max(0, profitCompromise - profitBuyerTarget)
    });
  }

  // Strategy B: Bundle Sweetener
  const companionProd = findProduct("IT-CABL-USBC") || findProduct("OFF-MARK-BLK");
  if (companionProd && companionProd.sku !== primaryProd.sku) {
    const addonQty = primaryItem.qty;
    const addonOrigPrice = companionProd.pricePaise;
    const addonDiscPct = MAX_DISCOUNT_PCT; // max 20% discount on addon
    const addonDiscPrice = Math.floor(addonOrigPrice * (1 - (addonDiscPct / 100)));
    const addonCost = Math.floor(addonOrigPrice * 0.4);

    const baseUnitForBundle = Math.max(clampedUnitTarget, unitTarget);
    const bundleTotalRev = (baseUnitForBundle * primaryItem.qty) + (addonDiscPrice * addonQty);
    const bundleTotalCost = totalCostPaise + (addonCost * addonQty);
    const bundleMargin = ((bundleTotalRev - bundleTotalCost) / bundleTotalRev) * 100;
    const bundleProfit = bundleTotalRev - bundleTotalCost;
    const bundleOrigTotal = (unitCatalog * primaryItem.qty) + (addonOrigPrice * addonQty);
    const bundleDiscPct = ((bundleOrigTotal - bundleTotalRev) / bundleOrigTotal) * 100;

    counterOffers.push({
      option_id: "OPT_BUNDLE_SWEETENER",
      option_type: "BUNDLE_SWEETENER",
      title: `Target Price Deal + ${addonQty}x ${companionProd.name} @ ${addonDiscPct}% Off`,
      description: `Fulfill ${primaryItem.qty}x ${primaryProd.name} with companion ${addonQty}x ${companionProd.name} at ₹${(addonDiscPrice/100).toFixed(2)}.`,
      unit_price_paise: baseUnitForBundle,
      total_amount_paise: bundleTotalRev,
      discount_pct: Number(bundleDiscPct.toFixed(2)),
      projected_gross_margin_pct: Number(bundleMargin.toFixed(2)),
      margin_floor_satisfied: bundleMargin >= MIN_MARGIN_PCT,
      bundled_items: [
        {
          addon_sku: companionProd.sku,
          addon_name: companionProd.name,
          addon_qty: addonQty,
          original_price_paise: addonOrigPrice,
          discounted_price_paise: addonDiscPrice,
          discount_pct: addonDiscPct
        }
      ],
      merchant_profit_lift_paise: Math.max(0, bundleProfit - profitBuyerTarget)
    });
  }

  negotiationSessions.set(sessionId, {
    session_id: sessionId,
    merchant_id: merchantId,
    primary_item: {
      sku: primaryItem.sku,
      qty: primaryItem.qty,
      catalog_price: primaryProd.pricePaise,
    },
    counter_offers: Object.fromEntries(counterOffers.map(o => [o.option_id, o]))
  });

  return {
    status: isFloorBreached ? "REJECTED_MARGIN_FLOOR" : "OFFERS_PROPOSED",
    session_id: sessionId,
    minimum_margin_floor_pct: MIN_MARGIN_PCT,
    counter_offers: counterOffers,
    reason: isFloorBreached 
      ? `Target price breaches merchant minimum margin policy (${MIN_MARGIN_PCT}%). Counter-offers formulated to protect margin floor.`
      : "Counter-offers computed within merchant gross margin constraints.",
  };
}

export function getSession(sessionId) {
  return negotiationSessions.get(sessionId);
}
