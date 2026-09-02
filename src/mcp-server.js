import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getCatalog, quoteItems, persistQuote, seedCatalog } from "./catalog.js";
import { createOrder } from "./money-actions.js";
import { processRfq, getSession } from "./negotiation.js";

const server = new Server({
  name: "agenttill-mcp",
  version: "1.0.0",
}, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_catalog",
      description: "Retrieve the official store product catalog or search across all categories.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } }
      }
    },
    {
      name: "request_quote",
      description: "Submit line items to receive a cryptographically sealed quote from the deterministic Commerce Guardian.",
      inputSchema: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "object", properties: { sku: { type: "string" }, qty: { type: "number" } }, required: ["sku", "qty"] } }
        },
        required: ["items"]
      }
    },
    {
      name: "submit_machine_purchase",
      description: "Execute a programmatic purchase through the deterministic Commerce Guardian.",
      inputSchema: {
        type: "object",
        properties: { cartId: { type: "string" }, missionId: { type: "string" } },
        required: ["cartId"]
      }
    },
    {
      name: "submit_commerce_rfq",
      description: "Submit a Request for Quote (RFQ) to negotiate price or volume discounts on behalf of a buyer.",
      inputSchema: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "object", properties: { sku: { type: "string" }, qty: { type: "number" }, target_unit_price_paise: { type: "number" } }, required: ["sku", "qty", "target_unit_price_paise"] } }
        },
        required: ["items"]
      }
    },
    {
      name: "accept_negotiation_offer",
      description: "Accept a negotiated counter-offer and finalize the purchase.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string" }, option_id: { type: "string" }, missionId: { type: "string" } },
        required: ["session_id", "option_id"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments || {};
    switch (request.params.name) {
      case "search_catalog": {
        const query = (args.query || "").toLowerCase();
        let products = getCatalog();
        if (query && query !== "*" && query !== "all") {
          products = products.filter(p => p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query) || p.category.toLowerCase().includes(query));
        }
        return { content: [{ type: "text", text: JSON.stringify(products, null, 2) }] };
      }
      
      case "request_quote": {
        const result = quoteItems(args.items);
        if (!result.ok) throw new Error(`UNKNOWN_SKU: ${result.unknownSkus.join(", ")}`);
        const cartId = persistQuote(result.lines, result.totalPaise);
        return { content: [{ type: "text", text: JSON.stringify({ cartId, items: result.lines, totalPaise: result.totalPaise }, null, 2) }] };
      }
      
      case "submit_machine_purchase": {
        const result = await createOrder({ cartId: args.cartId, missionId: args.missionId, actor: { type: "agent", id: "mcp_client" } });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      
      case "submit_commerce_rfq": {
        const result = processRfq({ items: args.items });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      
      case "accept_negotiation_offer": {
        const session = getSession(args.session_id);
        if (!session) throw new Error("session not found");
        const option = session.counter_offers[args.option_id];
        if (!option) throw new Error("invalid option_id");
        
        const cartLines = [{ sku: session.primary_item.sku, name: session.primary_item.name, qty: session.primary_item.qty, unitPaise: option.unit_price_paise, linePaise: option.unit_price_paise * session.primary_item.qty }];
        if (option.bundled_items) {
          for (const b of option.bundled_items) {
            cartLines.push({ sku: b.addon_sku, name: b.addon_name, qty: b.addon_qty, unitPaise: b.discounted_price_paise, linePaise: b.discounted_price_paise * b.addon_qty });
          }
        }
        
        const cartId = persistQuote(cartLines, option.total_amount_paise);
        const result = await createOrder({ cartId, missionId: args.missionId, actor: { type: "agent", id: "negotiator" } });
        return { content: [{ type: "text", text: JSON.stringify({ settled: true, cartId, checkout: result }, null, 2) }] };
      }
      
      default: throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  seedCatalog();
  console.error("AgentTill MCP Server running on stdio");
}

main().catch(console.error);
