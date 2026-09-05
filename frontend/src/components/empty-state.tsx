import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
}

/** Shown instead of an empty grid so a blank page always explains itself. */
export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      <Icon className="h-8 w-8 text-zinc-300" />
      <p className="text-sm font-medium text-zinc-600">{title}</p>
      {hint && <p className="max-w-sm text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}
