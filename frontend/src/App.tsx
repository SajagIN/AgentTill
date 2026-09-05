import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Target, CheckSquare, ShoppingCart, Activity, ShieldCheck, ArrowRight } from "lucide-react";

import { MissionsView } from "./views/MissionsView";
import { ApprovalsView } from "./views/ApprovalsView";
import { CatalogView } from "./views/CatalogView";
import { AuditView } from "./views/AuditView";
import { PoliciesView } from "./views/PoliciesView";

function DashboardLayout() {
  const location = useLocation();
  
  const navItems = [
    { name: "Overview", path: "/", icon: LayoutDashboard },
    { name: "Missions", path: "/missions", icon: Target },
    { name: "Approvals", path: "/approvals", icon: CheckSquare },
    { name: "Catalog", path: "/catalog", icon: ShoppingCart },
    { name: "Audit Trail", path: "/audit", icon: Activity },
    { name: "Policies", path: "/policies", icon: ShieldCheck },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 text-zinc-900 border-zinc-200">
      <div className="w-64 bg-zinc-950 text-zinc-50 flex flex-col h-full border-r border-zinc-800">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight">AgentTill</h1>
          <p className="text-zinc-500 text-sm">AI Procurement</p>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                location.pathname === item.path
                  ? "bg-zinc-800 text-zinc-50 font-medium"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/50"
              }`}
            >
              <item.icon size={18} />
              {item.name}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-auto bg-white">
        <header className="h-16 border-b flex items-center px-8">
          <h2 className="text-lg font-semibold">{navItems.find(i => i.path === location.pathname)?.name || "Dashboard"}</h2>
        </header>
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Overview() {
  const [missions, setMissions] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch('/api/missions').then(r => r.json()),
      fetch('/api/approvals').then(r => r.json())
    ]).then(([mRes, aRes]) => {
      setMissions(mRes.missions || []);
      setApprovals(aRes.approvals || []);
    });
  }, []);

  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  const activeMissions = missions.filter(m => !['CONFIRMED', 'FAILED', 'FAILED_FINAL', 'REJECTED', 'CANCELLED'].includes(m.state));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="border p-5 rounded-lg bg-white shadow-sm flex flex-col gap-1">
          <span className="text-zinc-500 text-sm font-medium">Total Missions</span>
          <span className="text-3xl font-semibold">{missions.length || "—"}</span>
          <span className="text-xs text-zinc-400 mt-1">all time</span>
        </div>
        <div className="border p-5 rounded-lg bg-white shadow-sm flex flex-col gap-1">
          <span className="text-zinc-500 text-sm font-medium">Confirmed</span>
          <span className="text-3xl font-semibold text-green-600">{missions.filter(m => m.state === 'COMPLETED').length || "—"}</span>
          <span className="text-xs text-zinc-400 mt-1">completed orders</span>
        </div>
        <div className="border p-5 rounded-lg bg-white shadow-sm flex flex-col gap-1">
          <span className="text-zinc-500 text-sm font-medium">Pending Approval</span>
          <span className="text-3xl font-semibold text-amber-500">{pendingApprovals.length || "—"}</span>
          <span className="text-xs text-zinc-400 mt-1">awaiting your decision</span>
        </div>
        <div className="border p-5 rounded-lg bg-white shadow-sm flex flex-col gap-1">
          <span className="text-zinc-500 text-sm font-medium">In Progress</span>
          <span className="text-3xl font-semibold text-blue-600">{activeMissions.length || "—"}</span>
          <span className="text-xs text-zinc-400 mt-1">running now</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border rounded-lg bg-white shadow-sm">
          <div className="border-b p-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-zinc-600" />
            <h2 className="font-semibold text-lg">Recent Missions</h2>
          </div>
          <div className="p-4 grid gap-3">
            {missions.length === 0 ? (
              <div className="text-center py-10 text-zinc-500">
                <Target className="w-8 h-8 opacity-20 mx-auto mb-2" />
                No missions yet.<br/> Ask your AI to buy something.
              </div>
            ) : (
              missions.slice(0, 4).map(m => (
                <div key={m.missionId} onClick={() => navigate('/missions')} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-zinc-50 cursor-pointer transition-colors">
                  <div className="bg-zinc-100 p-2 rounded-full shrink-0">
                    <Target className="w-4 h-4 text-zinc-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{m.intent}</div>
                    <div className="text-xs text-zinc-500 font-mono mt-0.5">{m.missionId}</div>
                  </div>
                  <div className="text-right shrink-0 block">
                    <div className="text-sm font-medium">{(m.budgetPaise ? `₹${(m.budgetPaise / 100).toFixed(2)}` : "Unbounded")}</div>
                    <div className="text-xs text-zinc-500">{m.state}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border rounded-lg bg-white shadow-sm">
          <div className="border-b p-4 flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-zinc-600" />
            <h2 className="font-semibold text-lg">Needs Your Attention</h2>
          </div>
          <div className="p-4 grid gap-3">
            {pendingApprovals.length === 0 ? (
              <div className="text-center py-10 text-zinc-500">
                <CheckSquare className="w-8 h-8 opacity-20 mx-auto mb-2" />
                All clear.<br/> Nothing pending your approval.
              </div>
            ) : (
              pendingApprovals.map(a => (
                <div key={a.approvalId} className="flex flex-col gap-2 p-3 rounded-lg border bg-zinc-50">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <div className="text-xs font-mono text-zinc-500 mb-1">{a.missionId}</div>
                      <div className="text-sm font-medium">{a.reason}</div>
                    </div>
                    <div className="text-right shrink-0 block">
                      <div className="text-sm font-medium">₹{(a.amountPaise / 100).toFixed(2)}</div>
                    </div>
                  </div>
                  <button onClick={() => navigate('/approvals')} className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
                    Review Approval <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<Overview />} />
          <Route path="missions" element={<MissionsView />} />
          <Route path="approvals" element={<ApprovalsView />} />
          <Route path="catalog" element={<CatalogView />} />
          <Route path="audit" element={<AuditView />} />
          <Route path="policies" element={<PoliciesView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
