# 06 · MCP integration

AgentTill exposes its commerce surface over the [Model Context Protocol](https://modelcontextprotocol.io) so any MCP-capable agent can buy from the catalog through the same guardrails the dashboard uses. There is no privileged path: MCP tools call the same policy engine, the same money boundary, and write to the same audit trail.

## Transports

### HTTP

Runs in the same process as the API. `POST /mcp` accepts JSON-RPC 2.0, single requests or batches.

```bash
# server metadata
curl http://localhost:3000/mcp

# initialise
curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
         "protocolVersion":"2024-11-05","capabilities":{},
         "clientInfo":{"name":"curl","version":"0"}}}'

# list tools
curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# call a tool
curl -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
         "name":"search_catalog","arguments":{"query":"coffee"}}}'
```

`notifications/initialized` carries no reply, so it returns `204 No Content`.

Implementation note: `src/mcp-http.js` bridges each request onto a freshly constructed MCP `Server` using an in-memory transport. Requests are independent, so there is no session state to track across calls.

### stdio

```bash
bun run mcp
```

Client configuration:

```json
{
  "mcpServers": {
    "agenttill": {
      "command": "bun",
      "args": ["src/mcp-server.js"],
      "cwd": "/path/to/AgentTill"
    }
  }
}
```

The stdio entry point seeds the catalog on start and logs to **stderr**, keeping stdout clean for JSON-RPC.

Both transports share `createMcpServer()`, so the tool list cannot drift between them.

## Tools

### `search_catalog`

```json
{ "query": "coffee" }
```

Filters over name, SKU and category. `query` is optional; `""`, `"*"` and `"all"` return everything.

### `request_quote`

```json
{ "items": [ { "sku": "OFF-NOTE-A4", "qty": 3 } ] }
```

Returns `{ cartId, items, totalPaise }`. Totals are computed server-side — the caller cannot influence price. An unknown SKU raises `UNKNOWN_SKU` with the offending list.

### `submit_machine_purchase`

```json
{ "cartId": "cart_…", "missionId": "mission_…", "approvalId": "appr_…" }
```

Attempts checkout and returns the money layer's verdict: `created`, `needs_approval`, or `denied` (with `ruleEvals`). Pass `approvalId` to resume a gated checkout after a human approved it — that satisfies the `approval_above` gate for this attempt while every other rule is re-evaluated.

The actor is `{ type: "agent", id: "mcp_client" }`, which is what appears in the audit trail.

### `submit_commerce_rfq`

```json
{ "items": [ { "sku": "OFF-NOTE-A4", "qty": 10, "target_unit_price_paise": 4500 } ] }
```

Asks the merchant for counter-offers against a target unit price, respecting a 15% minimum margin floor and a 20% discount cap. Returns a `session_id` and the offers.

### `accept_negotiation_offer`

```json
{ "session_id": "neg_…", "option_id": "opt_1", "missionId": "mission_…" }
```

Builds a cart from the accepted offer and checks it out in one step.

### `setup_autopay_mandate`

```json
{ "buyer_id": "buyer_1", "max_amount_paise": 500000 }
```

Creates a standing mandate. While active, purchases within the ceiling skip the approval gate — but every **deny** rule still applies. A mandate raises the ceiling for human sign-off, not the hard limits.

### `get_autopay_status`

```json
{ "buyer_id": "buyer_1" }
```

Returns the active mandate, or `{ "status": "NOT_FOUND" }`.

### `revoke_autopay_mandate`

```json
{ "mandate_id": "mand_…" }
```

Deactivates a mandate so future purchases are gated again.

## Error handling

Tool failures are returned as MCP tool errors rather than transport errors, so a client sees the message and can react:

```json
{ "result": { "content": [ { "type": "text", "text": "Error: UNKNOWN_SKU: OFF-NOPE" } ], "isError": true } }
```

A policy denial is **not** an error — it is a normal `denied` verdict with the rule evaluations attached, because being refused is an expected outcome an agent should be able to re-plan around.

## A complete agent session

```
1. search_catalog  { "query": "notebook" }        → SKU + price
2. request_quote   { items: [{sku, qty: 3}] }     → cartId, totalPaise
3. submit_machine_purchase { cartId }
     ├─ created          → done; a payment link exists
     ├─ needs_approval   → tell a human, then retry with approvalId
     └─ denied           → read ruleEvals, adjust the cart, re-quote
```

Every step in that sequence is written to `audit_events` under the mission's correlation id, attributable to `agent/mcp_client`.
