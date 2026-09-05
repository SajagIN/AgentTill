import { useCallback, useEffect, useRef, useState } from "react";

interface Resource<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

interface Options {
  /** Refetch interval in milliseconds. Omit for a one-shot fetch. */
  pollMs?: number;
  /** Changing this discards the current value and fetches again. */
  key?: string | number;
}

/**
 * Fetch on mount, optionally on an interval, and expose a `reload` for
 * optimistic refreshes after a mutation.
 *
 * The dashboard polls rather than opening a socket: AgentTill's value
 * proposition is a tamper-evident ledger, so reading it back over plain HTTP
 * keeps the path identical to what an external agent sees.
 */
export function useResource<T>(loader: () => Promise<T>, { pollMs, key }: Options = {}): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Hold the latest loader without making it an effect dependency, so callers
  // can pass an inline closure without retriggering the fetch on every render.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const result = await loaderRef.current();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    };

    tick();
    if (pollMs) timer = setInterval(tick, pollMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [nonce, pollMs, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, reload };
}
