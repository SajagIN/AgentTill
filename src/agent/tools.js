import { config } from "../config.js";

/**
 * The buyer agent talks to AgentTill over HTTP, exactly like any external
 * agent would. Every route lives under the `/api` mount — see src/server.js.
 *
 * `startServer()` calls setAgentApiBase() once it knows the port it actually
 * bound, so an in-process agent always reaches the server beside it instead of
 * whatever BASE_URL happened to say.
 */
let apiBaseOverride = null;

export function setAgentApiBase(url) {
  apiBaseOverride = `${url.replace(/\/$/, "")}/api`;
}

function apiBase() {
  return apiBaseOverride ?? `${config.baseUrl.replace(/\/$/, "")}/api`;
}

/** Statuses that will not change by retrying, so the agent must stop at once. */
const NON_RETRYABLE = new Set([400, 404, 422]);

class ApiError extends Error {
  constructor(status, code, message, body) {
    super(`[${status}] ${message}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryable = !NON_RETRYABLE.has(status);
  }
}

async function request(path, init) {
  let res;
  try {
    res = await fetch(`${apiBase()}${path}`, init);
  } catch (cause) {
    const err = new ApiError(0, "NETWORK_ERROR", `cannot reach AgentTill API at ${apiBase()}${path}: ${cause.message}`);
    err.cause = cause;
    throw err;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? res.statusText ?? "request failed",
      body,
    );
  }
  return body;
}

const jsonInit = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** @returns {Promise<Array<{sku:string,name:string,category:string,pricePaise:number,stock:number}>>} */
export async function searchCatalog(query) {
  const { products = [] } = await request("/catalog");
  if (!query) return products;
  const needle = query.toLowerCase();
  return products.filter(
    (p) =>
      p.sku.toLowerCase().includes(needle) ||
      p.name.toLowerCase().includes(needle) ||
      p.category.toLowerCase().includes(needle),
  );
}

/** @returns {Promise<{cartId:string,totalPaise:number,items:Array}>} */
export async function getQuote(items) {
  const body = await request("/quote", jsonInit("POST", { items }));
  return { cartId: body.cartId, totalPaise: body.totalPaise, items: body.items };
}

/**
 * Begin checkout. A 403 is a policy verdict, not a transport failure, so it is
 * returned to the agent (which can re-plan) rather than thrown.
 */
export async function beginCheckout(cartId, missionId) {
  const payload = { cartId };
  if (missionId != null) payload.missionId = missionId;
  return request("/checkout", jsonInit("POST", payload)).catch((err) => {
    if (err.status === 403) return err.body;
    throw err;
  });
}

export async function getMissionStatus(missionId) {
  return request(`/missions/${encodeURIComponent(missionId)}`);
}

export { ApiError };
