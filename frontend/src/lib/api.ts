/**
 * Single client for the AgentTill API.
 *
 * `purifiedFetch` defends against a real-world failure: some Chrome extensions
 * (copy-enablers, grammar checkers, devtools overlays) monkey-patch
 * `window.fetch` and break the response contract, which stalls React's
 * scheduler. A hidden iframe gets its own untouched `fetch`, so we borrow that
 * one. If the iframe is unavailable (SSR, a locked-down CSP) we fall back to
 * the global `fetch` rather than failing outright.
 *
 * Every route lives under `/api`, and in production the Express server serves
 * both the SPA and the API from the same origin, so paths stay relative.
 */

let cachedFetch: typeof fetch | null = null;

function purifiedFetch(): typeof fetch {
  if (cachedFetch) return cachedFetch;

  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    document.body.appendChild(iframe);
    const scoped = iframe.contentWindow?.fetch;
    if (scoped) cachedFetch = scoped.bind(iframe.contentWindow);
  } catch {
    // Blocked by CSP or not in a document — fall through to the global fetch.
  }

  cachedFetch ??= fetch.bind(globalThis);
  return cachedFetch;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public ruleEvals?: unknown[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await purifiedFetch()(path, init);
  } catch (cause) {
    throw new ApiError(0, "NETWORK_ERROR", `cannot reach the AgentTill API: ${(cause as Error).message}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? response.statusText,
      body?.error?.ruleEvals,
    );
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);

const send = <T>(path: string, method: string, body?: unknown) =>
  request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const api = {
  get,
  post: <T>(path: string, body?: unknown) => send<T>(path, "POST", body),
  put: <T>(path: string, body?: unknown) => send<T>(path, "PUT", body),
  delete: <T>(path: string) => send<T>(path, "DELETE"),
};
