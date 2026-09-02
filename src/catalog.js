import { listProducts, findProduct, replaceAllProducts, saveCart } from "./db.js";

export const SEED_PRODUCTS = [
  // office
  { sku: "OFF-FILE-A4", name: "Lever Arch File A4", category: "office", pricePaise: 34900, stock: 25 },
  { sku: "OFF-MARK-BLK", name: "Whiteboard Marker Black", category: "office", pricePaise: 4500, stock: 60 },
  { sku: "OFF-NOTE-A4", name: "Spiral Notebook A4 (200 pg)", category: "office", pricePaise: 5990, stock: 40 },
  { sku: "OFF-PEN-BLU", name: "Ball Pen Blue (pack of 10)", category: "office", pricePaise: 9000, stock: 80 },
  { sku: "OFF-STIK-NOTE", name: "Sticky Notes 3×3 (100 sheets)", category: "office", pricePaise: 7500, stock: 50 },
  // it
  { sku: "IT-CABL-USBC", name: "USB-C Cable 1m", category: "it", pricePaise: 29900, stock: 30 },
  { sku: "IT-HUBB-4PT", name: "USB-C Hub 4-port", category: "it", pricePaise: 189900, stock: 15 },
  { sku: "IT-KEYB-MECH", name: "Mechanical Keyboard", category: "it", pricePaise: 249900, stock: 10 },
  { sku: "IT-MOUS-WRLS", name: "Wireless Mouse", category: "it", pricePaise: 79900, stock: 20 },
  // supplies
  { sku: "SUP-COFF-500", name: "Filter Coffee Powder 500g", category: "supplies", pricePaise: 49900, stock: 35 },
  { sku: "SUP-CUP-PAP", name: "Paper Cups (pack of 50)", category: "supplies", pricePaise: 3500, stock: 100 },
  { sku: "SUP-TEA-250", name: "Green Tea 250g", category: "supplies", pricePaise: 29900, stock: 30 },
  { sku: "SUP-TOWL-ROL", name: "Kitchen Towel Rolls (6)", category: "supplies", pricePaise: 21000, stock: 45 },
  // catering — denied by the category_allowlist rule in the policy engine
  { sku: "CAT-LUNC-BOX", name: "Team Lunch Box (per person)", category: "catering", pricePaise: 25000, stock: 60 },
];

export function getCatalog() {
  return listProducts();
}

export function seedCatalog() {
  replaceAllProducts(SEED_PRODUCTS);
}

// All-or-nothing quote: if any SKU is unknown, nothing is priced.
export function quoteItems(items) {
  const unknownSkus = [];
  const lines = [];
  for (const item of items) {
    const product = findProduct(item.sku);
    if (!product) {
      if (!unknownSkus.includes(item.sku)) unknownSkus.push(item.sku);
      continue;
    }
    lines.push({
      sku: product.sku,
      name: product.name,
      category: product.category,
      qty: item.qty,
      unitPaise: product.pricePaise,
      linePaise: item.qty * product.pricePaise, // integer × integer — no floats (M1)
    });
  }
  if (unknownSkus.length > 0) {
    return { ok: false, unknownSkus, validSkus: listProducts().map((p) => p.sku) };
  }
  const totalPaise = lines.reduce((sum, line) => sum + line.linePaise, 0);
  return { ok: true, lines, totalPaise };
}

export function persistQuote(lines, totalPaise) {
  return saveCart(lines, totalPaise);
}
