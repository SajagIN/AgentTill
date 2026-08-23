/**
 * Missions: CRUD + the state machine (Architecture §7). This module is the
 * SINGLE transition authority — nothing else writes mission.state.
 *
 * PLANNING → QUOTED → POLICY_CHECK → PAYING → CONFIRMED
 *                      ↘ AWAITING_APPROVAL → PAYING (human approved)
 * POLICY_CHECK/REJECTED paths, FAILED → RETRYING (≤2) → FAILED_FINAL → ESCALATED,
 * CONFIRMED → REFUNDED, anything → CANCELLED where sensible.
 */
import { insertMission, getMissionRow, setMissionState, listMissions } from "./db.js";

/** Invalid transition — 409 conflict (R4). */
export class TransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransitionError";
    this.status = 409;
    this.code = "INVALID_TRANSITION";
  }
}

/** Allowed transitions (Architecture §7). Terminal states map to []. */
const ALLOWED = {
  PLANNING: ["QUOTED", "REJECTED", "CANCELLED"],
  QUOTED: ["POLICY_CHECK", "CANCELLED"],
  POLICY_CHECK: ["PAYING", "AWAITING_APPROVAL", "REJECTED", "CANCELLED"],
  AWAITING_APPROVAL: ["PAYING", "REJECTED", "CANCELLED"],
  PAYING: ["CONFIRMED", "FAILED", "CANCELLED"],
  FAILED: ["RETRYING", "FAILED_FINAL", "ESCALATED", "CANCELLED"],
  RETRYING: ["PAYING", "FAILED", "FAILED_FINAL", "ESCALATED", "CANCELLED"],
  FAILED_FINAL: ["ESCALATED", "CANCELLED"],
  CONFIRMED: ["REFUNDED", "CANCELLED"],
  REJECTED: ["PLANNING", "CANCELLED"], // agent may re-plan (≤2, enforced by agent in Phase 6)
  ESCALATED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Create a mission in PLANNING.
 * @param {{intent:string, budgetPaise?:number|null}} input
 * @returns {{missionId:string, intent:string, budgetPaise:number|null, state:string}}
 */
export function createMission({ intent, budgetPaise = null }) {
  const missionId = insertMission(intent, budgetPaise, "PLANNING");
  return { missionId, intent, budgetPaise, state: "PLANNING" };
}

/** @param {string} missionId @returns {object|undefined} mission row (camelCase) */
export function getMission(missionId) {
  return getMissionRow(missionId);
}

/** @returns {Array<object>} missions newest-first with audit eventCount */
export function listAllMissions() {
  return listMissions();
}

/**
 * Transition a mission's state — the only door to mission.state.
 * @param {string} missionId @param {string} to target state
 * @returns {object} updated mission
 * @throws {TransitionError} if the mission doesn't exist or from→to is invalid
 */
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
