import { SEED_PRODUCTS, seedCatalog } from "../src/catalog.js";
import { resetDemoData } from "../src/db.js";

function paiseToRupeeString(paise) {
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return `₹${rupees}.${String(rem).padStart(2, "0")}`;
}

resetDemoData();
seedCatalog();

console.log(`seeded ${SEED_PRODUCTS.length} products into agenttill.db:`);
for (const p of SEED_PRODUCTS) {
  console.log(
    `  ${p.sku.padEnd(14)} ${p.category.padEnd(9)} ${String(p.pricePaise).padStart(7)} paise (${paiseToRupeeString(p.pricePaise)}) · stock ${p.stock}`,
  );
}
const categories = [...new Set(SEED_PRODUCTS.map((p) => p.category))];
console.log(`categories: ${categories.join(", ")}`);
console.log("SEED OK");
