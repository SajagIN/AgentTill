import { useState } from "react";
import { Activity, FileKey2, Search } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { AuditTimeline } from "@/components/audit-timeline";
import { MerkleReceipt } from "@/components/merkle-receipt";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import type { AuditEvent, MerkleReceipt as Receipt, Mission } from "@/lib/types";

/**
 * Audit Trail — the tamper-evident record.
 *
 * Every money action writes an append-only row, including denials and failures.
 * Each mission's rows fold into a 4-leaf Merkle tree, so the stored history can
 * be checked for removal or reordering after the fact.
 */
export function AuditView() {
  const missions = useResource<Mission[]>(() =>
    api.get<{ missions: Mission[] }>("/api/missions").then((r) => r.missions),
  );
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("");

  const correlationId = selected || input.trim();
  const timeline = useResource<AuditEvent[]>(
    () =>
      correlationId
        ? api.get<{ timeline: AuditEvent[] }>(`/api/audit/${encodeURIComponent(correlationId)}`).then((r) => r.timeline)
        : Promise.resolve([]),
    { key: correlationId, pollMs: correlationId ? 5000 : undefined },
  );
  const receipt = useResource<Receipt | null>(
    () =>
      correlationId
        ? api
            .get<Receipt>(`/api/audit/${encodeURIComponent(correlationId)}/receipt`)
            .catch((cause) => (cause instanceof ApiError && cause.status === 404 ? null : Promise.reject(cause)))
        : Promise.resolve(null),
    { key: correlationId },
  );

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        description="The immutable log of every decision AgentTill made with money — approvals, denials, retries, captures and failures, each with the rule evaluation that produced it."
        usage="Pick a mission, or paste any correlation id. Denials are recorded too: an agent that was stopped is as auditable as one that spent."
      />

      <Card className="mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Select a mission</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1 space-y-2">
            <label htmlFor="mission-select" className="text-sm font-medium">
              Mission
            </label>
            <select
              id="mission-select"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setInput("");
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose a mission…</option>
              {(missions.data ?? []).map((mission) => (
                <option key={mission.missionId} value={mission.missionId}>
                  {mission.missionId} — {mission.intent}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 space-y-2">
            <label htmlFor="correlation-id" className="text-sm font-medium">
              Or enter a correlation id
            </label>
            <div className="flex gap-2">
              <Input
                id="correlation-id"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setSelected("");
                }}
                placeholder="mission_ab12cd34"
              />
              <Button variant="outline" disabled={!input.trim()} onClick={() => timeline.reload()}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!correlationId ? (
        <EmptyState icon={Activity} title="Nothing selected" hint="Choose a mission above to load its trail." />
      ) : (
        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">
              Timeline {timeline.data ? `(${timeline.data.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="receipt">
              <FileKey2 className="mr-2 h-3.5 w-3.5" />
              Merkle receipt
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="mt-6">
            {timeline.error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{timeline.error}</p>
            ) : (
              <AuditTimeline events={timeline.data ?? []} />
            )}
          </TabsContent>

          <TabsContent value="receipt" className="mt-6">
            {receipt.error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{receipt.error}</p>
            ) : receipt.data ? (
              <MerkleReceipt receipt={receipt.data} />
            ) : (
              <EmptyState
                icon={FileKey2}
                title="No receipt available"
                hint="A receipt is generated once the mission has at least one audit event."
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
