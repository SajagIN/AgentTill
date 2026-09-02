export const SYSTEM_PROMPT =
  "You are a buyer AI that receives a mission to purchase items within a budget. " +
  "Use the provided tools to search catalog, get quotes, create checkout, handle approvals, " +
  "and confirm payment. Follow the mission constraints.";

export function getUserPrompt(mission) {
  const { intent, budgetPaise, missionId } = mission;

  const budgetLine =
    budgetPaise != null
      ? `Your total budget is ₹${(budgetPaise / 100).toFixed(2)} (${budgetPaise} paise). Do not exceed this amount.`
      : "No explicit budget cap has been set for this mission.";

  return (
    `Mission ID: ${missionId}\n` +
    `Intent: ${intent}\n` +
    `${budgetLine}\n\n` +
    "Complete this mission by using the available tools in order: search the catalog for " +
    "matching items, obtain quotes, create a checkout, resolve any approval requirements, " +
    "and confirm payment. Abort and report clearly if any policy constraint cannot be met."
  );
}
