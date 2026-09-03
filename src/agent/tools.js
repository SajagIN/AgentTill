const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
async function handleResponse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      body?.error?.message ??
      body?.message ??
      `HTTP ${res.status} ${res.statusText}`;
    const err = new Error(`[${res.status}] ${message}`);
    err.status = res.status;
    err.code = body?.error?.code ?? "HTTP_ERROR";
    err.body = body;
    throw err;
  }
  return body;
}

export async function searchCatalog(query) {
  const res = await fetch(`${BASE_URL}/catalog`);
  const body = await handleResponse(res);
  const products = body.products ?? [];
  if (!query) return products;
  const needle = query.toLowerCase();
  return products.filter((p) =>
    p.sku.toLowerCase().includes(needle) ||
    p.name.toLowerCase().includes(needle) ||
    p.category.toLowerCase().includes(needle)
  );
}

export async function getQuote(items) {
  const res = await fetch(`${BASE_URL}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const body = await handleResponse(res);
  return { cartId: body.cartId, totalPaise: body.totalPaise, items: body.items };
}

export async function beginCheckout(cartId, missionId) {
  const payload = { cartId };
  if (missionId != null) payload.missionId = missionId;

  const res = await fetch(`${BASE_URL}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    return body;
  }

  return handleResponse(res);
}

export async function approve(approvalId) {
  const res = await fetch(`${BASE_URL}/approvals/${encodeURIComponent(approvalId)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse(res);
}

export async function deny(approvalId) {
  const res = await fetch(`${BASE_URL}/approvals/${encodeURIComponent(approvalId)}/deny`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse(res);
}
