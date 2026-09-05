import type { ReactNode } from "react";
import { Info } from "lucide-react";

interface PageHeaderProps {
  title: string;
  /** Why this page exists and what it is for. */
  description: string;
  /** Concrete guidance on how to use the page. */
  usage?: string;
  actions?: ReactNode;
}

/**
 * Every page in the dashboard opens with this header, so a first-time operator
 * always learns what they are looking at before they act on it.
 */
export function PageHeader({ title, description, usage, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b pb-6 md:flex-row md:items-start md:justify-between">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        <p className="text-sm leading-relaxed text-zinc-600">{description}</p>
        {usage && (
          <p className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs leading-relaxed text-blue-900">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{usage}</span>
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
