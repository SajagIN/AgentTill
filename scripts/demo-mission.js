/**
 * Scripted walkthrough of one mission, end to end.
 *
 *   bun run demo
 *
 * Starts the server, seeds the catalog, deploys a mission through the public
 * HTTP API, and prints what the policy engine decided along with the Merkle
 * receipt for the resulting audit trail.
 *
 * The mission is chosen so it trips the human-approval gate: that path performs
 * no Razorpay call, so the demo is reproducible with placeholder credentials.
 */
import { startServer } from "../src/server.js";
import { config } from "../src/config.js";
import { resetDemoData } from "../src/db.js";
import { seedCatalog } from "../src/catalog.js";
import { getMissionReceipt, getMissionTimeline } from "../src/audit.js";

const BASE = config.baseUrl.replace(/\/$/, "");
const INR = (paise) =>
  `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format((paise ?? 0) / 100)}`;

const RULE = "━".repeat(64);
const head = (title) => console.log(`\n${RULE}\n  ${title}\n${RULE}\n`);

const INTENT = "restock: hubs";
const BUDGET_PAISE = 200000; // ₹2,000 — the cart is ₹1,899, above the ₹1,000 gate
const SETTLE_MS = 6000;

console.log("AgentTill ▸ demo mission\n");
console.log("⚙  resetting and seeding the database…");
resetDemoData();
seedCatalog();

const server = startServer();
await new Promise((resolve) => setTimeout(resolve, 500));

let exitCode = 0;

try {
  head("Mission brief");
  console.log(`Intent   ${INTENT}`);
  console.log(`Budget   ${INR(BUDGET_PAISE)}`);

  const created = await fetch(`${BASE}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: INTENT, budgetPaise: BUDGET_PAISE }),
  }).then((res) => res.json());

  const missionId = created.missionId;
  console.log(`Mission  ${missionId}`);

  head("Agent execution");
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  const { mission, order } = await fetch(`${BASE}/api/missions/${missionId}`).then((res) => res.json());
  console.log(`State    ${mission.state}`);
  if (order) console.log(`Order    ${order.orderId} · ${INR(order.amountPaise)}`);

  head("Audit trail");
  const timeline = getMissionTimeline(missionId);
  if (timeline.length === 0) {
    console.log("No events recorded — the agent never reached the money layer.");
  }
  for (const event of timeline) {
    console.log(`${event.ts}  ${event.action.padEnd(16)}  ${event.outcome.padEnd(18)} ${event.decision?.reason ?? ""}`);
    for (const rule of event.decision?.ruleEvals ?? []) {
      const mark = rule.outcome === "pass" ? "✓" : rule.outcome === "triggered" ? "!" : "✗";
      console.log(`                                            ${mark} ${rule.ruleId}: ${rule.detail}`);
    }
  }

  head("Merkle receipt");
  const receipt = getMissionReceipt(missionId);
  if (receipt) {
    console.log(`Root     ${receipt.root}`);
    console.log(`Topology ${receipt.topology} · ${receipt.nodes.leaves.length} leaves`);
  } else {
    console.log("No receipt — the mission has no audit events yet.");
  }

  head("Next step");
  if (mission.state === "AWAITING_APPROVAL") {
    console.log(`The mission is frozen pending a human decision.`);
    console.log(`  Dashboard  ${BASE}/approvals`);
    console.log(`  Or by API  curl -X POST ${BASE}/api/approvals/<approvalId>/approve`);
    console.log(`\nNo Razorpay order exists yet — approving is what creates one.`);
  } else {
    console.log(`Mission reached ${mission.state}.`);
    if (!config.razorpayKeyId.startsWith("rzp_test_") || config.razorpayKeySecret.length < 8) {
      console.log("Set real Razorpay test-mode keys in .env to exercise the payment path.");
    }
  }

  console.log(`\n${RULE}\n  Demo complete · ${missionId}\n${RULE}\n`);
} catch (error) {
  console.error(`\n✖  demo failed: ${error.message}`);
  console.error(error.stack);
  exitCode = 1;
} finally {
  server.close();
  process.exit(exitCode);
}
