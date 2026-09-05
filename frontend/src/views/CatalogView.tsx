import { useState, useEffect } from "react";
import { cleanFetch } from "@/cleanFetch";

export function CatalogView() {
  const [catalog, setCatalog] = useState<any[]>([]);

  useEffect(() => {
    cleanFetch('/api/catalog').then(r => r.json()).then(data => setCatalog(data.products));
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {catalog.map(p => (
        <div key={p.sku} className="border p-5 rounded-lg bg-white shadow-sm flex flex-col gap-2">
          <div className="flex justify-between items-start">
            <h4 className="font-semibold">{p.name}</h4>
            <span className="font-mono text-xs text-zinc-500">{p.sku}</span>
          </div>
          <p className="text-zinc-600 font-medium">₹{(p.pricePaise / 100).toFixed(2)}</p>
          <div className="text-sm text-zinc-500 mt-2">
            Category: {p.category}<br/>
            In Stock: {p.stock}
          </div>
        </div>
      ))}
    </div>
  );
}
