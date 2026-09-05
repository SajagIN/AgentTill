import { useState } from "react";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { RuleEvals } from "@/components/rule-evals";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { formatINR, formatTimestamp } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { Approval } from "@/lib/types";

/**
 * Approvals — the human gate.
 *
 * When a checkout trips the `approval_above` rule the mission is frozen here.
 * No Razorpay order exists yet: approving is what authorises one to be created.
 */
export function ApprovalsView() {
  const approvals = useResource<Approval[]>(
    () => api.get<{ approvals: Approval[] }>("/api/approvals").then((r) => r.approvals),
    { pollMs: 5000 },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function resolve(approval: Approval, decision: "approve" | "deny") {
    setBusy(approval.approvalId);
    setNotice(null);
    try {
      if (decision === "approve") {
        const { checkout } = await api.post<{ checkout: { status: string; paymentLinkUrl?: string } }>(
          `/api/approvals/${approval.approvalId}/approve`,
        );
        setNotice({
          tone: "ok",
          text:
            checkout.status === "created"
              ? "Approved — a Razorpay order was created and the mission moved to Paying."
              : `Approved, but the checkout came back as “${checkout.status}”.`,
        });
      } else {
        await api.post(`/api/approvals/${approval.approvalId}/deny`);
        setNotice({ tone: "ok", text: "Denied — the mission was rejected and no money moved." });
      }
      approvals.reload();
    } catch (cause) {
      setNotice({
        tone: "bad",
        text: cause instanceof ApiError ? cause.message : "Could not record the decision.",
      });
    } finally {
      setBusy(null);
    }
  }

  const rows = approvals.data ?? [];
  const pending = rows.filter((a) => a.status === "pending");
  const resolved = rows.filter((a) => a.status !== "pending");

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Checkouts the policy engine refused to authorise on its own. Each one shows the full rule evaluation that produced the gate, so the decision is made with the same evidence the engine used."
        usage="Approving creates the Razorpay order and moves the mission to Paying. Denying rejects the mission outright. Neither action can be undone, and both are written to the audit trail."
      />

      {notice && (
        <div
          className={`mb-6 flex items-start gap-2 rounded-lg border p-3 text-sm ${
            notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {notice.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {approvals.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{approvals.error}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No approvals"
          hint="A checkout lands here when it exceeds the approval threshold or trips a gate rule."
        />
      ) : (
        <div className="space-y-4">
          {[...pending, ...resolved].map((approval) => {
            const isPending = approval.status === "pending";
            return (
              <Card key={approval.approvalId} className={isPending ? "border-amber-300" : "opacity-70"}>
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-zinc-900">{approval.reason}</p>
                    <p className="font-mono text-xs text-zinc-400">
                      {approval.missionId} · {approval.approvalId}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold text-zinc-900">{formatINR(approval.amountPaise)}</p>
                    <p className="text-xs text-zinc-400">
                      {isPending ? "pending" : `${approval.status} by ${approval.decidedBy ?? "unknown"}`}
                    </p>
                  </div>
                </CardHeader>

                <CardContent className="rounded-md bg-zinc-50 p-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Policy evaluation
                  </p>
                  <RuleEvals evals={approval.ruleEvals} />
                </CardContent>

                <CardFooter className="justify-between pt-4">
                  <span className="text-xs text-zinc-400">
                    {isPending ? "No payment link exists until you approve." : formatTimestamp(approval.decidedAt)}
                  </span>
                  {isPending && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={busy === approval.approvalId}
                        onClick={() => resolve(approval, "deny")}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Deny
                      </Button>
                      <Button disabled={busy === approval.approvalId} onClick={() => resolve(approval, "approve")}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {busy === approval.approvalId ? "Working…" : "Approve"}
                      </Button>
                    </div>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
