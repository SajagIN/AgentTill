import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { getCatalog, persistQuote, quoteItems, seedCatalog } from "./catalog.js";
import { createOrder } from "./money-actions.js";
import { createMandate, getMandate, revokeMandate } from "./mandates.js";
import { getSession, processRfq } from "./negotiation.js";

const text = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });

const TOOLS = [
  {
    name: "search_catalog",
    description: "List the merchant catalog, optionally filtered by a text query over name, SKU, or category.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
    },
  },
  {
    name: "request_quote",
    description: "Price line items against the catalog. Totals are computed server-side; the caller cannot set prices.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { sku: { type: "string" }, qty: { type: "number" } },
            required: ["sku", "qty"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "submit_machine_purchase",
    description:
      "Attempt a checkout. The policy engine may allow it, deny it, or gate it behind human approval. Pass approvalId to resume a gated checkout after a human approved it.",
    inputSchema: {
      type: "object",
      properties: { cartId: { type: "string" }, missionId: { type: "string" }, approvalId: { type: "string" } },
      required: ["cartId"],
    },
  },
  {
    name: "submit_commerce_rfq",
    description: "Request counter-offers for a target unit price, subject to the merchant's margin floor.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              qty: { type: "number" },
              target_unit_price_paise: { type: "number" },
            },
            required: ["sku", "qty", "target_unit_price_paise"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "accept_negotiation_offer",
    description: "Accept a counter-offer from a negotiation session and finalise the purchase.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" }, option_id: { type: "string" }, missionId: { type: "string" } },
      required: ["session_id", "option_id"],
    },
  },
  {
    name: "setup_autopay_mandate",
    description: "Create a standing mandate that lets a buyer auto-pay up to a ceiling without human approval.",
    inputSchema: {
      type: "object",
      properties: { buyer_id: { type: "string" }, max_amount_paise: { type: "number" } },
      required: ["buyer_id", "max_amount_paise"],
    },
  },
  {
    name: "get_autopay_status",
    description: "Read the active mandate for a buyer, if any.",
    inputSchema: {
      type: "object",
      properties: { buyer_id: { type: "string" } },
      required: ["buyer_id"],
    },
  },
  {
    name: "revoke_autopay_mandate",
    description: "Deactivate a mandate so future purchases are gated again.",
    inputSchema: {
      type: "object",
      properties: { mandate_id: { type: "string" } },
      required: ["mandate_id"],
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case "search_catalog": {
      const query = String(args.query ?? "").toLowerCase();
      const products = getCatalog();
      if (!query || query === "*" || query === "all") return text(products);
      return text(
        products.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.sku.toLowerCase().includes(query) ||
            p.category.toLowerCase().includes(query),
        ),
      );
    }

    case "request_quote": {
      const result = quoteItems(args.items);
      if (!result.ok) throw new Error(`UNKNOWN_SKU: ${result.unknownSkus.join(", ")}`);
      return text({ cartId: persistQuote(result.lines, result.totalPaise), items: result.lines, totalPaise: result.totalPaise });
    }

    case "submit_machine_purchase":
      return text(
        await createOrder({
          cartId: args.cartId,
          missionId: args.missionId,
          approvalId: args.approvalId,
          actor: { type: "agent", id: "mcp_client" },
        }),
      );

    case "submit_commerce_rfq":
      return text(processRfq({ items: args.items }));

    case "accept_negotiation_offer": {
      const session = getSession(args.session_id);
      if (!session) throw new Error(`no negotiation session ${args.session_id}`);
      const option = session.counter_offers?.[args.option_id];
      if (!option) throw new Error(`invalid option_id "${args.option_id}"`);

      const qty = option.new_qty || session.primary_item.qty;
      const lines = [
        {
          sku: session.primary_item.sku,
          name: session.primary_item.name ?? session.primary_item.sku,
          qty,
          unitPaise: option.unit_price_paise,
          linePaise: option.unit_price_paise * qty,
        },
      ];
      for (const bundle of option.bundled_items ?? []) {
        lines.push({
          sku: bundle.addon_sku,
          name: bundle.addon_name,
          qty: bundle.addon_qty,
          unitPaise: bundle.discounted_price_paise,
          linePaise: bundle.discounted_price_paise * bundle.addon_qty,
        });
      }

      const cartId = persistQuote(lines, option.total_amount_paise);
      const checkout = await createOrder({
        cartId,
        missionId: args.missionId,
        actor: { type: "agent", id: "negotiator" },
      });
      return text({ settled: true, cartId, checkout });
    }

    case "setup_autopay_mandate":
      return text({ status: "ACTIVE", mandate_id: createMandate(args.buyer_id, args.max_amount_paise) });

    case "get_autopay_status": {
      const mandate = getMandate(args.buyer_id);
      return text(mandate ?? { status: "NOT_FOUND" });
    }

    case "revoke_autopay_mandate":
      revokeMandate(args.mandate_id);
      return text({ status: "REVOKED" });

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/** Build a fresh MCP server instance. Safe to call per request. */
export function createMcpServer() {
  const server = new Server({ name: "agenttill-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callTool(request.params.name, request.params.arguments ?? {});
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  });

  return server;
}

/** Entry point for stdio MCP clients (`bun src/mcp-server.js`). */
export async function startStdio() {
  seedCatalog();
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error("agenttill-mcp ▸ listening on stdio");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startStdio().catch(console.error);
}
