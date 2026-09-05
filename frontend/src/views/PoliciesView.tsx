import { useState } from "react";
import { RotateCcw, Save, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { formatINR, titleCase } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { PolicyConfig } from "@/lib/types";

/**
 * Policies — the guardrails themselves.
 *
 * These values are the only inputs the deterministic rule engine reads. Editing
 * one changes what the agent is allowed to do on its very next checkout, with
 * no code deploy and no LLM in the loop.
 */
export function PoliciesView() {
  const policies = useResource<PolicyConfig[]>(() =>
    api.get<{ policies: PolicyConfig[] }>("/api/policies").then((r) => r.policies),
  );
  const [notice, setNotice] = useState<string | null>(null);

  if (policies.error) {
    return (
      <div>
        <PageHeader
          title="Policies"
          description="The guardrails the deterministic rule engine enforces on every checkout."
        />
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{policies.error}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Policies"
        description="The guardrails the deterministic rule engine enforces on every checkout. Rules are plain code reading these values — no model, no judgement, no drift."
        usage="Change a limit and save; it applies to the next checkout attempt. Deny rules stop a purchase outright, while the approval gate pauses it for a human instead."
      />

      {notice && (
        <p className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {(policies.data ?? []).length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No policies configured" hint="Run `bun run seed` to initialise the database." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {(policies.data ?? []).map((policy) => (
            <PolicyCard
              key={`${policy.key}:${JSON.stringify(policy.value)}`}
              policy={policy}
              onSaved={(key) => {
                setNotice(`${titleCase(key)} saved — it applies to the next checkout.`);
                policies.reload();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const POLICY_BLURB: Record<string, { summary: string; kind: "deny" | "gate" }> = {
  max_basket_value: { summary: "Hard ceiling on a single cart. Anything above it is denied outright.", kind: "deny" },
  hourly_spend_cap: { summary: "Rolling 60-minute spend ceiling across every mission combined.", kind: "deny" },
  velocity_max_checkouts: { summary: "Maximum checkout attempts in the trailing hour, to stop retry storms.", kind: "deny" },
  category_allowlist: { summary: "Product categories the agent is permitted to buy at all.", kind: "deny" },
  approval_above: { summary: "Amounts strictly above this pause the mission for human approval.", kind: "gate" },
};

const FIELD_LABEL: Record<string, string> = {
  limitPaise: "Limit (₹)",
  thresholdPaise: "Threshold (₹)",
  maxCheckouts: "Max checkouts",
  categories: "Allowed categories",
};

function PolicyCard({ policy, onSaved }: { policy: PolicyConfig; onSaved: (key: string) => void }) {
  const blurb = POLICY_BLURB[policy.key];
  // Drafts are strings so the inputs can hold partial values while typing. The
  // card is keyed on the saved value, so a save remounts it with a clean draft
  // rather than syncing state in an effect.
  const [draft, setDraft] = useState<Record<string, string>>(() => stringify(policy.value));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const dirty = JSON.stringify(parse(draft, policy.value)) !== JSON.stringify(policy.value);

  async function save() {
    setSaving(true);
    setFailure(null);
    try {
      await api.put(`/api/policies/${policy.key}`, parse(draft, policy.value));
      onSaved(policy.key);
    } catch (cause) {
      setFailure(cause instanceof ApiError ? cause.message : "Could not save the policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{titleCase(policy.key)}</CardTitle>
          {blurb && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                blurb.kind === "deny" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {blurb.kind === "deny" ? "Denies" : "Gates"}
            </span>
          )}
        </div>
        {blurb && <CardDescription>{blurb.summary}</CardDescription>}
      </CardHeader>

      <CardContent className="space-y-4">
        {Object.keys(policy.value).map((field) => (
          <div key={field} className="space-y-1.5">
            <label htmlFor={`${policy.key}-${field}`} className="text-sm font-medium text-zinc-700">
              {FIELD_LABEL[field] ?? titleCase(field)}
            </label>
            <Input
              id={`${policy.key}-${field}`}
              type={isMoney(field) ? "number" : Array.isArray(policy.value[field]) ? "text" : "number"}
              step={isMoney(field) ? 1 : undefined}
              value={draft[field] ?? ""}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            />
            <p className="text-xs text-zinc-400">{hintFor(field, draft[field], policy.value[field])}</p>
          </div>
        ))}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-zinc-400">
            {failure ? (
              <span className="text-red-600">{failure}</span>
            ) : dirty ? (
              <span className="text-amber-600">Unsaved changes</span>
            ) : (
              "In effect now"
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setDraft(stringify(policy.value))}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset
            </Button>
            <Button size="sm" disabled={!dirty || saving} onClick={save}>
              <Save className="mr-1 h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const isMoney = (field: string) => field.endsWith("Paise");

/** Rupee fields are edited in rupees and stored as paise (rule M1). */
function stringify(value: Record<string, number | string[]>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([field, raw]) => [
      field,
      Array.isArray(raw) ? raw.join(", ") : isMoney(field) ? String(raw / 100) : String(raw),
    ]),
  );
}

function parse(draft: Record<string, string>, original: Record<string, number | string[]>) {
  return Object.fromEntries(
    Object.entries(original).map(([field, raw]) => {
      const text = draft[field] ?? "";
      if (Array.isArray(raw)) {
        return [field, text.split(",").map((entry) => entry.trim()).filter(Boolean)];
      }
      const number = Number(text);
      return [field, isMoney(field) ? Math.round(number * 100) : number];
    }),
  );
}

function hintFor(field: string, text: string | undefined, original: number | string[]) {
  if (Array.isArray(original)) return "Comma-separated. Match the categories in the catalog.";
  if (!isMoney(field)) return "A plain count.";
  const rupees = Number(text);
  return Number.isFinite(rupees) ? `Stored as ${Math.round(rupees * 100)} paise (${formatINR(Math.round(rupees * 100))})` : "Enter a number of rupees.";
}
