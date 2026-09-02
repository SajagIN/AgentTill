import { expect, test, beforeAll } from "bun:test";
import { authorize } from "./policy-engine.js";
import { createMandate } from "./mandates.js";
import { db, resetDemoData } from "./db.js";

beforeAll(() => {
  resetDemoData();
});

test("mandate ceiling allows within limit", () => {
  createMandate("test_b1", 100000);
  const result = authorize({
    actorId: "test_b1",
    actorType: "programmatic",
    action: "create_order",
    amountPaise: 50000,
    ctx: {}
  });
  expect(result.decision).toBe("allow");
  expect(result.ruleEvals.find(r => r.ruleId === "mandate_ceiling").outcome).toBe("pass");
});

test("mandate ceiling denies above limit", () => {
  createMandate("test_b2", 100000);
  const result = authorize({
    actorId: "test_b2",
    actorType: "programmatic",
    action: "create_order",
    amountPaise: 150000,
    ctx: {}
  });
  expect(result.decision).toBe("deny");
  const ev = result.ruleEvals.find(r => r.ruleId === "mandate_ceiling");
  expect(ev.outcome).toBe("fail");
});
