import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cleanFetch } from "@/cleanFetch";

export function PoliciesView() {
  const [policies, setPolicies] = useState<{key: string, value: any}[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cleanFetch('/api/policies').then(r => r.json()).then(data => {
      setPolicies(data);
      setLoading(false);
    });
  }, []);

  const handleUpdate = async (key: string, newValue: any) => {
    await cleanFetch(`/api/policies/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newValue)
    });
    setPolicies(policies.map(p => p.key === key ? { ...p, value: newValue } : p));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="grid gap-6">
        {policies.map(p => (
          <div key={p.key} className="border p-6 rounded-lg bg-zinc-50 space-y-4">
            <h4 className="font-semibold text-lg capitalize">{p.key.replace(/_/g, " ")}</h4>
            <div className="space-y-2">
              {Object.keys(p.value).map(field => (
                <div key={field} className="flex gap-4 items-center">
                  <label className="text-sm font-medium w-32">{field}</label>
                  <input
                    type="number"
                    value={p.value[field]}
                    onChange={(e) => {
                      const val = p.value;
                      val[field] = typeof val[field] === 'number' ? Number(e.target.value) : e.target.value;
                      setPolicies([...policies]);
                    }}
                    className="border px-3 py-1 rounded w-full max-w-xs"
                  />
                  <Button size="sm" onClick={() => handleUpdate(p.key, p.value)}>Save</Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
