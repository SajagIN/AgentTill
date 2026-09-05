import {
  insertApproval,
  getApprovalRow,
  listApprovalRows,
  setApprovalDecision,
  getPendingApprovalForCart,
} from "./db.js";
import { appendEvent } from "./audit.js";
import { getMission, transition } from "./missions.js";
import { NotFoundError, TransitionError, ValidationError } from "./errors.js";

const HUMAN = { type: "human", id: "operator" };

export function createApproval({ missionId, cartId, amountPaise, reason, ruleEvals }) {
  const existing = getPendingApprovalForCart(cartId);
  if (existing) {
    return { approvalId: existing.approvalId, status: "pending" };
  }
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
    throw new NotFoundError(`no approval with id ${approvalId}`);
  }
  if (approval.status !== "pending") {
    throw new TransitionError(`approval ${approvalId} is already ${approval.status}`);
  }
  if (decision !== "approved" && decision !== "denied") {
    throw new ValidationError('decision must be "approved" or "denied"');
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
