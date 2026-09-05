import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckSquare, Hourglass, ShieldCheck, Target, Wallet } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StateBadge } from "@/components/state-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatINR, formatRelative } from "@/lib/format";
import { isActive } from "@/lib/mission-states";
import { useResource } from "@/lib/use-resource";
import type { Approval, Mission } from "@/lib/types";

/**
 * Overview — the operator's landing page.
 *
 * It answers three questions at a glance: is the agent working, is anything
 * waiting on me, and how much has it been allowed to spend. Nothing here can
 * change state; every action routes to the page that owns it.
 */
export function OverviewView() {
  const navigate = useNavigate();
  const missions = useResource<Mission[]>(() => api.get<{ missions: Mission[] }>("/api/missions").then((r) => r.missions), {
    pollMs: 5000,
  });
  const approvals = useResource<Approval[]>(
    () => api.get<{ approvals: Approval[] }>("/api/approvals").then((r) => r.approvals),
    { pollMs: 5000 },
  );

  const allMissions = missions.data ?? [];
  const allApprovals = approvals.data ?? [];
  const pending = allApprovals.filter((a) => a.status === "pending");
  const running = allMissions.filter((m) => isActive(m.state));
  const confirmed = allMissions.filter((m) => m.state === "CONFIRMED");
  const pendingValue = pending.reduce((sum, a) => sum + a.amountPaise, 0);

  if (missions.error) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{missions.error}</div>;
  }

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Live status of every autonomous purchase AgentTill is running on your behalf. The buyer agent works in the background; this page tells you whether it needs you."
        usage="Watch for anything in “Awaiting approval” — those checkouts are frozen until a human decides. Use the Missions page to start new work."
        actions={<Button onClick={() => navigate("/missions")}>New mission</Button>}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard icon={Target} label="Missions" value={allMissions.length} hint="all time" />
        <StatCard icon={Hourglass} label="In progress" value={running.length} hint="the agent is working" tone="info" />
        <StatCard icon={CheckSquare} label="Needs approval" value={pending.length} hint="frozen until you decide" tone="warning" />
        <StatCard icon={ShieldCheck} label="Confirmed" value={confirmed.length} hint="paid and verified" tone="success" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Recent missions</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/missions")}>
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {allMissions.length === 0 ? (
              <EmptyState
                icon={Target}
                title="No missions yet"
                hint="Give the agent a goal on the Missions page, for example “restock: notebooks, markers, coffee”."
              />
            ) : (
              allMissions.slice(0, 5).map((mission) => (
                <button
                  key={mission.missionId}
                  onClick={() => navigate("/missions")}
                  className="flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{mission.intent}</p>
                    <p className="font-mono text-xs text-zinc-400">{mission.missionId}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium">{formatINR(mission.budgetPaise)}</p>
                    <p className="text-xs text-zinc-400">{formatRelative(mission.updatedAt)}</p>
                  </div>
                  <StateBadge state={mission.state} />
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Needs your attention</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/approvals")}>
              Review <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.length === 0 ? (
              <EmptyState icon={CheckSquare} title="All clear" hint="No checkout is waiting on a human decision." />
            ) : (
              pending.map((approval) => (
                <div key={approval.approvalId} className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-sm font-medium text-zinc-900">{approval.reason}</p>
                    <span className="shrink-0 text-sm font-semibold text-amber-700">
                      {formatINR(approval.amountPaise)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <p className="font-mono text-xs text-zinc-500">{approval.missionId}</p>
                    <Button size="sm" variant="outline" onClick={() => navigate("/approvals")}>
                      Decide <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {pendingValue > 0 && (
        <p className="mt-6 flex items-center gap-2 text-xs text-zinc-500">
          <Wallet className="h-3.5 w-3.5" />
          {formatINR(pendingValue)} is currently held pending your approval. No payment link exists for it yet.
        </p>
      )}
    </div>
  );
}
