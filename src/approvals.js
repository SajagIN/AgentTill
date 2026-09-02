import {
  insertApproval,
  getApprovalRow,
  listApprovalRows,
  setApprovalDecision,
} from "./db.js";
import { appendEvent } from "./audit.js";
import { getMission, transition, TransitionError } from "./missions.js";

const HUMAN = { type: "human", id: "operator" };

export function createApproval({ missionId, cartId, amountPaise, reason, ruleEvals }) {
  const approvalId = insertApproval({ missionId, cartId, amountPaise, reason, ruleEvals });
  return { approvalId, status: "pending" };
}

export function getApproval(approvalId) {
  return getApprovalRow(approvalId);
}

export function listApprovals() {
  return listApprovalRows();
}

export function resolveApproval({ approvalId, decision, actor = HUMAN }) {
  const approval = getApprovalRow(approvalId);
  if (!approval) {
    const err = new Error(`no approval with id ${approvalId}`);
    err.status = 404;
    err.code = "APPROVAL_NOT_FOUND";
    throw err;
  }
  if (approval.status !== "pending") {
    const err = new Error(`approval ${approvalId} is already ${approval.status}`);
    err.status = 409;
    err.code = "APPROVAL_ALREADY_RESOLVED";
    throw err;
  }
  if (decision !== "approved" && decision !== "denied") {
    const err = new Error(`decision must be "approved" or "denied"`);
    err.status = 400;
    err.code = "INVALID_DECISION";
    throw err;
  }

  setApprovalDecision(approvalId, decision, actor.id);
  appendEvent({
    correlationId: approval.missionId,
    actor,
    action: "approval_resolved",
    amountPaise: approval.amountPaise,
    decision: {
      result: decision,
      reason: decision === "approved" ? "human approved the gated checkout" : "human denied the gated checkout",
      ruleEvals: approval.ruleEvals,
    },
    entities: { approvalId, cartId: approval.cartId },
    outcome: "info",
  });

  if (decision === "denied") {
    const mission = getMission(approval.missionId);
    if (mission && mission.state === "AWAITING_APPROVAL") {
      transition(approval.missionId, "REJECTED");
    }
  }
  return { ...approval, status: decision, decidedBy: actor.id };
}

export { TransitionError };
