import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cleanFetch } from "@/cleanFetch";

export function AuditView() {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [mid, setMid] = useState("");
  const [error, setError] = useState("");

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mid.trim()) return;
    setError("");
    const res = await cleanFetch(`/api/audit/${mid}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error?.message || "Not found");
      setTimeline([]);
    } else {
      setTimeline(data.timeline);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="flex gap-4">
        <input 
          value={mid} 
          onChange={e => setMid(e.target.value)} 
          placeholder="Mission ID or Correlation ID" 
          className="border px-4 py-2 rounded-md w-96 flex-1 max-w-md"
        />
        <Button type="submit">Search Audit Trail</Button>
      </form>

      {error && <div className="text-red-500 font-medium">{error}</div>}

      <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
        {timeline.map((event, i) => (
          <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-300 text-slate-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow"></div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border bg-white shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <div className="font-bold text-slate-900">{event.event_type}</div>
                <time className="font-mono text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</time>
              </div>
              <div className="text-slate-500 text-sm font-mono whitespace-pre-wrap breakdown-all">
                {JSON.stringify(JSON.parse(event.payload_json), null, 2)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
