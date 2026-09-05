import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { cleanFetch } from "@/cleanFetch";

export function ApprovalsView() {
  const [approvals, setApprovals] = useState<any[]>([]);

  const fetchApprovals = () => {
    cleanFetch('/api/approvals').then(r => r.json()).then(data => setApprovals(data.approvals || []));
  };

  useEffect(() => { fetchApprovals() }, []);

  const resolve = async (id: string, action: 'approve' | 'deny') => {
    await cleanFetch(`/api/approvals/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: `Human ${action}d via dashboard` })
    });
    fetchApprovals();
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        {approvals.map(a => (
          <div key={a.approvalId} className="border p-6 rounded-lg bg-white shadow-sm space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="font-mono text-xs text-zinc-500">Mission: {a.missionId} • Approval: {a.approvalId}</span>
                <h4 className="font-medium mt-1">{a.reason}</h4>
              </div>
              <span className={`text-xs px-2 py-1 rounded font-medium ${a.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100'}`}>
                {a.status}
              </span>
            </div>

            <div className="text-sm bg-zinc-50 p-4 rounded border text-zinc-700 space-y-2">
              <h5 className="font-semibold text-zinc-900 mb-3 text-xs uppercase tracking-wider">Policy Evaluation Rules</h5>
              {a.ruleEvals && Array.isArray(a.ruleEvals) ? a.ruleEvals.map((rule: any, idx: number) => (
                <div key={idx} className="flex items-start gap-2">
                  {rule.outcome === 'pass' ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div className="font-medium text-zinc-900">{rule.ruleId.replace(/_/g, " ")}</div>
                    <div className="text-zinc-500 text-xs">{rule.detail}</div>
                  </div>
                </div>
              )) : (
                <div className="font-mono text-xs text-zinc-500">{JSON.stringify(a.ruleEvals, null, 2)}</div>
              )}
            </div>

            {a.status === 'pending' && (
              <div className="flex gap-3 pt-2 border-t">
                <Button onClick={() => resolve(a.approvalId, 'approve')} className="bg-green-600 hover:bg-green-700 text-white border-0">Approve</Button>
                <Button variant="outline" onClick={() => resolve(a.approvalId, 'deny')} className="text-red-600 hover:text-red-700 hover:bg-red-50">Reject</Button>
              </div>
            )}
          </div>
        ))}
        {approvals.length === 0 && <div className="text-center py-12 text-zinc-400 border border-dashed rounded-lg">No approvals pending</div>}
      </div>
    </div>
  );
}
