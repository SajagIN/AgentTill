/** Shapes returned by the AgentTill API. Money is always integer paise (rule M1). */

export interface Product {
  sku: string;
  name: string;
  category: string;
  pricePaise: number;
  stock: number;
}

export type MissionState =
  | "PLANNING"
  | "QUOTED"
  | "POLICY_CHECK"
  | "AWAITING_APPROVAL"
  | "PAYING"
  | "CONFIRMED"
  | "FAILED"
  | "RETRYING"
  | "FAILED_FINAL"
  | "REJECTED"
  | "ESCALATED"
  | "CANCELLED"
  | "REFUNDED";

export interface Mission {
  missionId: string;
  intent: string;
  budgetPaise: number | null;
  state: MissionState;
  createdAt: string;
  updatedAt: string;
  eventCount?: number;
}

export interface Order {
  orderId: string;
  missionId: string;
  cartId: string;
  amountPaise: number;
  paymentLinkId: string | null;
  paymentLinkUrl: string | null;
  status: string;
  paymentId: string | null;
  createdAt: string;
}

export type RuleOutcome = "pass" | "fail" | "triggered";

export interface RuleEval {
  ruleId: string;
  params: Record<string, unknown>;
  outcome: RuleOutcome;
  detail: string;
}

export interface Approval {
  approvalId: string;
  missionId: string;
  cartId: string;
  amountPaise: number;
  reason: string;
  ruleEvals: RuleEval[];
  status: "pending" | "approved" | "denied";
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface AuditEvent {
  eventId: string;
  ts: string;
  correlationId: string;
  parentEventId: string | null;
  actor: { type: string; id: string };
  action: string;
  amountPaise: number | null;
  /**
   * Money-layer events carry `decision` ("allow"/"deny"/"needs_approval");
   * webhook-driven events carry `result`. Both always include a reason.
   */
  decision: { decision?: string; result?: string; reason?: string; ruleEvals?: RuleEval[] } | null;
  entities: Record<string, unknown> | null;
  outcome: string;
}

export interface MerkleReceipt {
  root: string;
  topology: string;
  nodes: { intermediate: string[]; leaves: string[] };
  payloadChunks: string[];
}

export interface PolicyConfig {
  key: string;
  value: Record<string, number | string[]>;
}
