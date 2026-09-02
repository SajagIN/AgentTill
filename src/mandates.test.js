import { expect, test, beforeAll, afterAll } from "bun:test";
import { createMandate, getMandate, revokeMandate } from "./mandates.js";
import { db, resetDemoData } from "./db.js";

beforeAll(() => {
  resetDemoData();
});

test("create, retrieve, and revoke mandate", () => {
  const buyerId = "test_buyer_1";
  const id = createMandate(buyerId, 50000);
  
  let mandate = getMandate(buyerId);
  expect(mandate.id).toBe(id);
  expect(mandate.max_amount_paise).toBe(50000);
  expect(mandate.active).toBe(1);

  revokeMandate(id);
  
  mandate = getMandate(buyerId);
  expect(mandate).toBeNull();
});
