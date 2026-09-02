import { insertMission, getMissionRow, setMissionState, listMissions } from "./db.js";

export class TransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransitionError";
    this.status = 409;
    this.code = "INVALID_TRANSITION";
  }
}

// Valid state transitions. Terminal states map to [].
const ALLOWED = {
  PLANNING: ["QUOTED", "REJECTED", "CANCELLED"],
  QUOTED: ["POLICY_CHECK", "CANCELLED"],
  POLICY_CHECK: ["PAYING", "AWAITING_APPROVAL", "REJECTED", "CANCELLED"],
  AWAITING_APPROVAL: ["POLICY_CHECK", "PAYING", "REJECTED", "CANCELLED"],
  PAYING: ["CONFIRMED", "FAILED", "CANCELLED"],
  FAILED: ["RETRYING", "FAILED_FINAL", "ESCALATED", "CANCELLED"],
  RETRYING: ["PAYING", "FAILED", "FAILED_FINAL", "ESCALATED", "CANCELLED"],
  FAILED_FINAL: ["ESCALATED", "CANCELLED"],
  CONFIRMED: ["REFUNDED", "CANCELLED"],
  REJECTED: ["PLANNING", "CANCELLED"],
  ESCALATED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function createMission({ intent, budgetPaise = null }) {
  const missionId = insertMission(intent, budgetPaise, "PLANNING");
  return { missionId, intent, budgetPaise, state: "PLANNING" };
}

export function getMission(missionId) {
  return getMissionRow(missionId);
}

export function listAllMissions() {
  return listMissions();
}

export function transition(missionId, to) {
  const mission = getMissionRow(missionId);
  if (!mission) {
    throw new TransitionError(`mission ${missionId} not found`);
  }
  const from = mission.state;
  if (!(ALLOWED[from] ?? []).includes(to)) {
    throw new TransitionError(`mission ${missionId}: ${from} → ${to} is not a valid transition`);
  }
  setMissionState(missionId, to);
  return { ...mission, state: to, updatedAt: new Date().toISOString() };
}
