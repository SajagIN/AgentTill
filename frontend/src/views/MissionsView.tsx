import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cleanFetch } from "@/cleanFetch";

export function MissionsView() {
  const [missions, setMissions] = useState<any[]>([]);

  const fetchMissions = () => {
    cleanFetch('/api/missions').then(r => r.json()).then(data => setMissions(data.missions || []));
  };

  useEffect(() => {
    fetchMissions();
  }, []);

  const createMission = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    await cleanFetch('/api/missions', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: (form.elements.namedItem('goal') as HTMLInputElement).value,
        budgetPaise: parseInt((form.elements.namedItem('budget') as HTMLInputElement).value, 10) * 100
      })
    });
    fetchMissions();
    form.reset();
  };

  return (
    <div className="space-y-8">
      <div className="border p-6 rounded-lg bg-white shadow-sm">
        <h4 className="font-semibold mb-4 text-lg">Spawn New Mission</h4>
        <form onSubmit={createMission} className="flex gap-4 items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Mission Goal</label>
            <input name="goal" required placeholder="Buy an ergonomic chair..." className="w-full border px-3 py-2 rounded-md" />
          </div>
          <div className="w-32 space-y-2">
            <label className="text-sm font-medium">Budget (₹)</label>
            <input name="budget" required type="number" defaultValue="2000" className="w-full border px-3 py-2 rounded-md" />
          </div>
          <Button type="submit">Deploy Agent</Button>
        </form>
      </div>

      <div className="grid gap-4">
        {missions.map(m => (
          <div key={m.missionId} className="border p-5 rounded-lg bg-white shadow-sm flex flex-col gap-3">
            <div className="flex justify-between items-start">
              <span className="font-mono text-xs text-zinc-500">{m.missionId}</span>
              <span className={`text-xs px-2 py-1 rounded font-medium ${m.state === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                {m.state}
              </span>
            </div>
            <h4 className="font-medium text-lg">{m.intent}</h4>
            <div className="text-sm text-zinc-500">Budget: ₹{(m.budgetPaise ? (m.budgetPaise / 100).toFixed(2) : "Unbounded")}</div>
          </div>
        ))}
        {missions.length === 0 && <div className="text-center py-12 text-zinc-400 border border-dashed rounded-lg">No active missions</div>}
      </div>
    </div>
  );
}
