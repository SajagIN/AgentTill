import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint: string;
  tone?: "default" | "success" | "warning" | "info";
}

const TONE = {
  default: "text-zinc-900",
  success: "text-emerald-600",
  warning: "text-amber-600",
  info: "text-blue-600",
} as const;

export function StatCard({ icon: Icon, label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className={`text-3xl font-semibold ${TONE[tone]}`}>{value}</span>
      <span className="mt-1 text-xs text-zinc-400">{hint}</span>
    </div>
  );
}
