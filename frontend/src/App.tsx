import { Link, Outlet, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
import {
  Activity,
  CheckSquare,
  LayoutDashboard,
  PackageSearch,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ApprovalsView } from "@/views/ApprovalsView";
import { AuditView } from "@/views/AuditView";
import { CatalogView } from "@/views/CatalogView";
import { MissionsView } from "@/views/MissionsView";
import { OverviewView } from "@/views/OverviewView";
import { PoliciesView } from "@/views/PoliciesView";

const NAV = [
  { name: "Overview", path: "/", icon: LayoutDashboard },
  { name: "Missions", path: "/missions", icon: ScrollText },
  { name: "Approvals", path: "/approvals", icon: CheckSquare },
  { name: "Catalog", path: "/catalog", icon: PackageSearch },
  { name: "Audit Trail", path: "/audit", icon: Activity },
  { name: "Policies", path: "/policies", icon: ShieldCheck },
] as const;

function Shell() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 text-zinc-900">
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 text-zinc-50">
        <div className="border-b border-zinc-800 p-6">
          <h1 className="text-xl font-bold tracking-tight">AgentTill</h1>
          <p className="text-sm text-zinc-500">Policy-gated AI procurement</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {NAV.map(({ name, path, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                pathname === path
                  ? "bg-zinc-800 font-medium text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
              )}
            >
              <Icon className="h-4 w-4" />
              {name}
            </Link>
          ))}
        </nav>
        <div className="border-t border-zinc-800 p-4 text-xs leading-relaxed text-zinc-500">
          Test mode only. No live payments are ever created.
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto bg-white">
        <main className="mx-auto max-w-6xl p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<OverviewView />} />
          <Route path="missions" element={<MissionsView />} />
          <Route path="approvals" element={<ApprovalsView />} />
          <Route path="catalog" element={<CatalogView />} />
          <Route path="audit" element={<AuditView />} />
          <Route path="policies" element={<PoliciesView />} />
          <Route path="*" element={<OverviewView />} />
        </Route>
      </Routes>
    </Router>
  );
}
