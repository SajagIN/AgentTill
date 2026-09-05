import { useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatINR, titleCase } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { Product } from "@/lib/types";

const NO_PRODUCTS: Product[] = [];

/**
 * Catalog — the merchant's agent-readable inventory.
 *
 * This is the only source of pricing in the system. The buyer agent may propose
 * SKUs from here, but the server always re-derives totals from these rows, so a
 * hallucinated price can never reach Razorpay.
 */
export function CatalogView() {
  const catalog = useResource<Product[]>(() => api.get<{ products: Product[] }>("/api/catalog").then((r) => r.products));
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const products = catalog.data ?? NO_PRODUCTS;
  const categories = useMemo(() => ["all", ...new Set(products.map((p) => p.category))], [products]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      if (category !== "all" && product.category !== category) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.category.toLowerCase().includes(needle)
      );
    });
  }, [products, category, query]);

  return (
    <div>
      <PageHeader
        title="Catalog"
        description="The products the buyer agent is allowed to purchase, with server-side prices. These rows are the single source of truth for every total AgentTill computes."
        usage="Search or filter to see what the agent can find. Categories outside the policy allowlist are still listed here but will be denied at checkout — see Policies."
        actions={
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, SKU or category…"
            className="w-64"
          />
        }
      />

      <Tabs value={category} onValueChange={setCategory} className="mb-6">
        <TabsList>
          {categories.map((entry) => (
            <TabsTrigger key={entry} value={entry}>
              {entry === "all" ? "All" : titleCase(entry)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {catalog.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{catalog.error}</p>
      ) : visible.length === 0 ? (
        <EmptyState icon={PackageSearch} title="No products match" hint="Try a different search or category." />
      ) : (
        <div className="rounded-lg border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((product) => (
                <TableRow key={product.sku}>
                  <TableCell className="font-medium text-zinc-900">{product.name}</TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500">{product.sku}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{titleCase(product.category)}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatINR(product.pricePaise)}</TableCell>
                  <TableCell className="text-right font-mono text-zinc-500">{product.stock}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
