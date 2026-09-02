import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/mcp-server.js', 'utf-8');

// Insert tools
const toolsInsert = `
      {
        name: "submit_commerce_rfq",
        description: "Submit a Request for Quote (RFQ) to negotiate price or volume discounts on behalf of a buyer.",
        inputSchema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: { sku: { type: "string" }, qty: { type: "number" }, target_unit_price_paise: { type: "number" } },
                required: ["sku", "qty", "target_unit_price_paise"]
              }
            }
          },
          required: ["items"]
        }
      },
      {
        name: "accept_negotiation_offer",
        description: "Accept a negotiated counter-offer and finalize the purchase.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            option_id: { type: "string" },
            missionId: { type: "string" }
          },
          required: ["session_id", "option_id"]
        }
      }`;

content = content.replace('] // END_TOOLS (or similar)', toolsInsert);

// Replace manually since it's cleaner to rewrite the handler arrays or just re-write the file entirely.
