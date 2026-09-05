import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { titleCase } from "@/lib/format";
import type { RuleEval } from "@/lib/types";

const ICON = {
  pass: { Icon: CheckCircle2, className: "text-emerald-500" },
  fail: { Icon: XCircle, className: "text-red-500" },
  triggered: { Icon: AlertTriangle, className: "text-amber-500" },
} as const;

/**
 * The rule-by-rule verdict behind a policy decision. This is the "explainable"
 * half of AgentTill: every gate and denial shows which rule fired and why.
 */
export function RuleEvals({ evals }: { evals: RuleEval[] }) {
  if (!Array.isArray(evals) || evals.length === 0) {
    return <p className="font-mono text-xs text-zinc-500">No rule evaluations recorded.</p>;
  }

  return (
    <ul className="space-y-2">
      {evals.map((rule) => {
        const { Icon, className } = ICON[rule.outcome] ?? ICON.pass;
        return (
          <li key={rule.ruleId} className="flex items-start gap-2">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900">{titleCase(rule.ruleId)}</p>
              <p className="text-xs leading-relaxed text-zinc-500">{rule.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
