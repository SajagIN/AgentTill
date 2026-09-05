/**
 * Presentation metadata for the mission state machine.
 *
 * This is the single place that knows what each state looks like, so the
 * dashboard can never drift from `src/missions.js` again.
 */
import type { MissionState } from "./types";

type Tone = "idle" | "running" | "gated" | "success" | "danger" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  idle: "border-zinc-200 bg-zinc-100 text-zinc-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  gated: "border-amber-200 bg-amber-50 text-amber-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  muted: "border-zinc-200 bg-white text-zinc-400",
};

const STATE_META: Record<MissionState, { label: string; tone: Tone; blurb: string }> = {
  PLANNING: { label: "Planning", tone: "idle", blurb: "The agent is reading the catalog and building a cart." },
  QUOTED: { label: "Quoted", tone: "idle", blurb: "The server has priced the cart from the catalog." },
  POLICY_CHECK: { label: "Policy check", tone: "running", blurb: "The deterministic rule engine is evaluating the cart." },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "gated", blurb: "A human must approve or deny this checkout." },
  PAYING: { label: "Paying", tone: "running", blurb: "A Razorpay order exists and payment is expected." },
  CONFIRMED: { label: "Confirmed", tone: "success", blurb: "Payment captured and verified against the order." },
  FAILED: { label: "Failed", tone: "danger", blurb: "The payment attempt failed; it may be retried." },
  RETRYING: { label: "Retrying", tone: "running", blurb: "A new order is being raised for this mission." },
  FAILED_FINAL: { label: "Failed permanently", tone: "danger", blurb: "Retries are exhausted." },
  REJECTED: { label: "Rejected", tone: "danger", blurb: "A hard policy rule denied the checkout." },
  ESCALATED: { label: "Escalated", tone: "danger", blurb: "Needs manual intervention — the agent has stopped." },
  CANCELLED: { label: "Cancelled", tone: "muted", blurb: "The mission was closed without spending." },
  REFUNDED: { label: "Refunded", tone: "muted", blurb: "The payment was returned." },
};

/** Terminal states never advance again; anything else is still moving. */
const TERMINAL: ReadonlySet<MissionState> = new Set([
  "CONFIRMED",
  "FAILED_FINAL",
  "REJECTED",
  "ESCALATED",
  "CANCELLED",
  "REFUNDED",
]);

export function missionMeta(state: MissionState) {
  return STATE_META[state] ?? { label: state, tone: "idle" as Tone, blurb: "Unrecognised state." };
}

export function stateBadgeClass(state: MissionState): string {
  return TONE_CLASS[missionMeta(state).tone];
}

export function isTerminal(state: MissionState): boolean {
  return TERMINAL.has(state);
}

export function isActive(state: MissionState): boolean {
  return !TERMINAL.has(state);
}
