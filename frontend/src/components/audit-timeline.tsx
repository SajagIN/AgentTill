import { CheckCircle2, Info, XCircle } from "lucide-react";

import { RuleEvals } from "@/components/rule-evals";
import { EmptyState } from "@/components/empty-state";
import { formatINR, formatTimestamp, titleCase } from "@/lib/format";
import type { AuditEvent } from "@/lib/types";

const OUTCOME = {
  succeeded: { Icon: CheckCircle2, className: "border-emerald-200 bg-emerald-50 text-emerald-600" },
  denied: { Icon: XCircle, className: "border-red-200 bg-red-50 text-red-600" },
  failed: { Icon: XCircle, className: "border-red-200 bg-red-50 text-red-600" },
  awaiting_approval: { Icon: Info, className: "border-amber-200 bg-amber-50 text-amber-600" },
  info: { Icon: Info, className: "border-zinc-200 bg-zinc-100 text-zinc-500" },
} as const;

/**
 * The append-only audit trail for one correlation id.
 *
 * Every row is a real `audit_events` record — denials and failures are stored
 * alongside successes, which is the point: the trail cannot be told to forget.
 */
export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return <EmptyState icon={Info} title="No audit events yet" hint="Events appear as soon as the agent touches the money layer." />;
  }

  return (
    <ol className="relative space-y-4 border-l pl-6">
      {events.map((event) => {
        const { Icon, className } = OUTCOME[event.outcome as keyof typeof OUTCOME] ?? OUTCOME.info;
        return (
          <li key={event.eventId} className="relative">
            <span
              className={`absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border bg-white ${className}`}
            >
              <Icon className="h-3 w-3" />
            </span>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900">{titleCase(event.action)}</p>
                <span className="font-mono text-xs text-zinc-400">{formatTimestamp(event.ts)}</span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-zinc-400">{event.eventId}</p>

              {event.decision?.reason && (
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">{event.decision.reason}</p>
              )}

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
                <div>
                  <dt className="inline text-zinc-400">Actor: </dt>
                  <dd className="inline font-mono">
                    {event.actor?.type}/{event.actor?.id}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-zinc-400">Outcome: </dt>
                  <dd className="inline font-mono">{event.outcome}</dd>
                </div>
                {event.amountPaise !== null && event.amountPaise !== undefined && (
                  <div>
                    <dt className="inline text-zinc-400">Amount: </dt>
                    <dd className="inline font-mono font-medium text-zinc-700">{formatINR(event.amountPaise)}</dd>
                  </div>
                )}
              </dl>

              {event.decision?.ruleEvals && event.decision.ruleEvals.length > 0 && (
                <div className="mt-3 rounded-md bg-zinc-50 p-3">
                  <RuleEvals evals={event.decision.ruleEvals} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
