import { Fingerprint } from "lucide-react";

import type { MerkleReceipt as Receipt } from "@/lib/types";

const short = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-6)}`;

function Node({ hash, label }: { hash: string; label: string }) {
  return (
    <div className="rounded-md border bg-white px-2 py-1.5 text-center shadow-sm" title={hash}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="font-mono text-[11px] text-zinc-700">{short(hash)}</p>
    </div>
  );
}

/**
 * The cryptographic receipt for a mission's timeline.
 *
 * The events are chunked into four leaves, hashed with SHA-256, and folded into
 * a balanced tree. Re-running the fold over the same events must reproduce the
 * same root, so removing or reordering a stored event is detectable.
 */
export function MerkleReceipt({ receipt }: { receipt: Receipt }) {
  const [left, right] = receipt.nodes.intermediate;
  const [l0, l1, l2, l3] = receipt.nodes.leaves;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
        <Fingerprint className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-900">Root hash</p>
          <p className="break-all font-mono text-xs text-emerald-800">{receipt.root}</p>
          <p className="mt-1 text-xs text-emerald-700">
            Topology {receipt.topology} · SHA-256 · 4 leaves
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-center">
          <Node hash={receipt.root} label="root" />
        </div>
        <div className="flex justify-center gap-16">
          <Node hash={left} label="node 0" />
          <Node hash={right} label="node 1" />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[l0, l1, l2, l3].map((leaf, index) => (
            <Node key={leaf} hash={leaf} label={`leaf ${index}`} />
          ))}
        </div>
      </div>

      <details className="rounded-lg border bg-zinc-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-700">
          Inspect the hashed payloads
        </summary>
        <p className="mt-2 text-xs text-zinc-500">
          Each leaf is the SHA-256 of one of these JSON chunks, in order.
        </p>
        <div className="mt-3 space-y-2">
          {receipt.payloadChunks.map((chunk, index) => (
            <pre
              key={index}
              className="max-h-40 overflow-auto rounded border bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-600"
            >
              {chunk.length === 0 ? "(empty — fewer than four events)" : chunk}
            </pre>
          ))}
        </div>
      </details>
    </div>
  );
}
