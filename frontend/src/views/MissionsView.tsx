import { useState } from "react";
import { Play, ScrollText } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StateBadge } from "@/components/state-badge";
import { EmptyState } from "@/components/empty-state";
import { AuditTimeline } from "@/components/audit-timeline";
import { MerkleReceipt } from "@/components/merkle-receipt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { formatINR, formatTimestamp } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { AuditEvent, MerkleReceipt as Receipt, Mission, Order } from "@/lib/types";

/**
 * Missions — where an operator hands a goal to the buyer agent.
 *
 * A mission is a plain-language intent plus an optional budget. The agent plans
 * a cart from the catalog and attempts a checkout; the policy engine, not the
 * agent, decides whether that checkout may proceed.
 */
export function MissionsView() {
  const missions = useResource<Mission[]>(
    () => api.get<{ missions: Mission[] }>("/api/missions").then((r) => r.missions),
    { pollMs: 5000 },
  );
  const [intent, setIntent] = useState("");
  const [budget, setBudget] = useState("2000");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<Mission | null>(null);

  async function deploy(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const budgetRupees = Number(budget);
    if (!intent.trim()) return setFormError("Describe what the agent should buy.");
    if (!Number.isInteger(budgetRupees) || budgetRupees <= 0) {
      return setFormError("Budget must be a positive whole number of rupees.");
    }

    setSubmitting(true);
    try {
      await api.post("/api/missions", { intent: intent.trim(), budgetPaise: budgetRupees * 100 });
      setIntent("");
      setBudget("2000");
      missions.reload();
    } catch (cause) {
      setFormError(cause instanceof ApiError ? cause.message : "Could not create the mission.");
    } finally {
      setSubmitting(false);
    }
  }

  const rows = missions.data ?? [];

  return (
    <div>
      <PageHeader
        title="Missions"
        description="Each mission is one purchasing goal handed to the autonomous buyer agent — an intent in plain language and a budget in rupees. The agent searches the catalog, requests a server-priced quote, and attempts checkout."
        usage="Write intents the way you would brief an assistant: “restock: notebooks, markers, coffee”. Anything the policy engine gates lands in Approvals instead of spending money."
      />

      <Card className="mb-8">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Deploy a new mission</CardTitle>
          <CardDescription>The agent starts planning as soon as the mission is created.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={deploy} className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="intent">Mission goal</Label>
              <Input
                id="intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="restock: notebooks, markers, coffee"
              />
            </div>
            <div className="space-y-2 md:w-40">
              <Label htmlFor="budget">Budget (₹)</Label>
              <Input
                id="budget"
                type="number"
                min={1}
                step={1}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting} className="md:w-40">
              <Play className="mr-2 h-4 w-4" />
              {submitting ? "Deploying…" : "Deploy agent"}
            </Button>
          </form>
          {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}
        </CardContent>
      </Card>

      {missions.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{missions.error}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No missions yet"
          hint="Deploy one above and the agent will plan a cart from the catalog."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Intent</TableHead>
                <TableHead className="hidden md:table-cell">Mission ID</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="hidden lg:table-cell">Updated</TableHead>
                <TableHead className="text-right">Trail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((mission) => (
                <TableRow key={mission.missionId}>
                  <TableCell className="font-medium text-zinc-900">{mission.intent}</TableCell>
                  <TableCell className="hidden font-mono text-xs text-zinc-500 md:table-cell">
                    {mission.missionId}
                  </TableCell>
                  <TableCell>{formatINR(mission.budgetPaise)}</TableCell>
                  <TableCell>
                    <StateBadge state={mission.state} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-zinc-500 lg:table-cell">
                    {formatTimestamp(mission.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setInspecting(mission)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <MissionDialog mission={inspecting} onClose={() => setInspecting(null)} />
    </div>
  );
}

function MissionDialog({ mission, onClose }: { mission: Mission | null; onClose: () => void }) {
  const timeline = useResource<AuditEvent[]>(
    () =>
      mission
        ? api.get<{ timeline: AuditEvent[] }>(`/api/missions/${mission.missionId}/timeline`).then((r) => r.timeline)
        : Promise.resolve([]),
    { pollMs: 4000, key: mission?.missionId ?? "none" },
  );
  const receipt = useResource<Receipt | null>(
    () =>
      mission
        ? api.get<Receipt>(`/api/missions/${mission.missionId}/receipt`).catch((cause) =>
            cause instanceof ApiError && cause.status === 404 ? null : Promise.reject(cause),
          )
        : Promise.resolve(null),
    { pollMs: 8000, key: mission?.missionId ?? "none" },
  );
  const order = useResource<Order | null>(
    () =>
      mission
        ? api.get<{ order: Order | null }>(`/api/missions/${mission.missionId}`).then((r) => r.order)
        : Promise.resolve(null),
    { pollMs: 4000, key: mission?.missionId ?? "none" },
  );

  return (
    <Dialog open={mission !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-left text-lg">{mission?.intent}</DialogTitle>
          <DialogDescription className="text-left font-mono text-xs">{mission?.missionId}</DialogDescription>
          {mission && (
            <div className="-mt-2 flex justify-start">
              <StateBadge state={mission.state} />
            </div>
          )}
        </DialogHeader>

        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Audit trail</TabsTrigger>
            <TabsTrigger value="order">Order</TabsTrigger>
            <TabsTrigger value="receipt">Merkle receipt</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="mt-4">
            {timeline.error ? (
              <p className="text-sm text-red-600">{timeline.error}</p>
            ) : (
              <AuditTimeline events={timeline.data ?? []} />
            )}
          </TabsContent>

          <TabsContent value="order" className="mt-4">
            {order.data ? (
              <dl className="space-y-2 text-sm">
                {[
                  ["Order ID", order.data.orderId],
                  ["Cart", order.data.cartId],
                  ["Amount", formatINR(order.data.amountPaise)],
                  ["Status", order.data.status],
                  ["Payment", order.data.paymentId ?? "not captured yet"],
                  ["Created", formatTimestamp(order.data.createdAt)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b pb-2">
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="break-all font-mono text-xs text-zinc-900">{value}</dd>
                  </div>
                ))}
                {order.data.paymentLinkUrl && (
                  <a
                    href={order.data.paymentLinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block break-all text-xs text-blue-600 underline"
                  >
                    {order.data.paymentLinkUrl}
                  </a>
                )}
              </dl>
            ) : (
              <EmptyState
                icon={ScrollText}
                title="No order yet"
                hint="An order only exists once the policy engine has allowed the checkout."
              />
            )}
          </TabsContent>

          <TabsContent value="receipt" className="mt-4">
            {receipt.error ? (
              <p className="text-sm text-red-600">{receipt.error}</p>
            ) : receipt.data ? (
              <MerkleReceipt receipt={receipt.data} />
            ) : (
              <EmptyState
                icon={ScrollText}
                title="No receipt yet"
                hint="A receipt is generated once the mission has audit events to hash."
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
