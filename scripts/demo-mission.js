import { startServer } from "../src/server.js";
import { resetDemoData } from "../src/db.js";
import { seedCatalog } from "../src/catalog.js";
import { insertMission } from "../src/db.js";
import { runMission } from "../src/agent/agent.js";
import { getMissionTimeline } from "../src/audit.js";

function paiseToINR(paise) {
  const rupees = Math.floor(paise / 100);
  const rem = paise % 100;
  return `₹${rupees}.${String(rem).padStart(2, "0")}`;
}

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  AgentTill Demo Mission — Track 01");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// Step 1: Seed database
console.log("⚙  Seeding database...");
resetDemoData();
seedCatalog();
console.log("✓  Database seeded\n");

// Step 2: Start server
console.log("⚙  Starting server...");
const server = startServer();
// Wait for server to be ready
await new Promise(resolve => setTimeout(resolve, 500));
console.log("✓  Server ready\n");

try {
  // Step 3: Create mission
  const missionIntent = "restock: notebooks, markers, coffee";
  const budgetPaise = 200000; // ₹2,000 — will trigger approval (>₹1,000)

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Mission Brief");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Intent:  ${missionIntent}`);
  console.log(`Budget:  ${paiseToINR(budgetPaise)}`);
  console.log();

  const missionId = insertMission(missionIntent, budgetPaise, "PLANNING");

  // Step 4: Run buyer agent
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Agent Execution");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const mission = { missionId, intent: missionIntent, budgetPaise };
  const result = await runMission(mission);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Agent Result");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (result) {
    console.log(`Status:     ${result.status}`);
    console.log(`Order ID:   ${result.orderId || "—"}`);
    console.log(`Amount:     ${result.amountPaise ? paiseToINR(result.amountPaise) : "—"}`);

    if (result.status === "needs_approval") {
      console.log(`Approval:   ${result.approvalId || "—"}`);
      console.log("\n⚠  Mission paused — approval required");
      console.log("   Run: curl -X POST http://localhost:3000/approvals/[ID]/approve");
    }

    if (result.status === "rate_limited") {
      console.log(`Message:    ${result.message}`);
      console.log("\n⚠  Razorpay test mode rate limit — visit dashboard to view/close existing payment links");
    }

    if (result.paymentLinkUrl) {
      console.log(`Pay:        ${result.paymentLinkUrl}`);
    }
  } else if (result?.status === "rate_limited") {
    console.log(`Status:     ${result.status}`);
    console.log(`Message:    ${result.message}`);
  } else {
    console.log("Status:     failed / denied");
  }

  // Step 5: Print mission timeline
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Audit Timeline");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const timeline = getMissionTimeline(missionId);
  for (const event of timeline) {
    const ts = formatTimestamp(event.timestamp);
    const actionPad = event.action.padEnd(20);
    console.log(`${ts}  ${actionPad}  ${event.reason || ""}`);

    if (event.details) {
      const details = typeof event.details === "string" ? JSON.parse(event.details) : event.details;

      if (details.ruleEvals) {
        console.log(`                                          ├─ Rules evaluated: ${details.ruleEvals.length}`);
        for (const rule of details.ruleEvals) {
          const symbol = rule.result === "deny" ? "✗" : rule.result === "needs_approval" ? "!" : "✓";
          console.log(`                                          │  ${symbol} ${rule.rule}: ${rule.result}`);
        }
      }

      if (details.amountPaise) {
        console.log(`                                          ├─ Amount: ${paiseToINR(details.amountPaise)}`);
      }
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Demo Complete");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Mission ID: ${missionId}`);
  console.log("Dashboard:  http://localhost:3000/dashboard.html");
  console.log("\n✓  All systems operational\n");

} catch (error) {
  console.error("\n✖  Demo failed:", error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  // Clean shutdown
  server.close();
  process.exit(0);
}
