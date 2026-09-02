import { processRfq, getSession } from "./src/negotiation.js";

function run() {
  const req = {
    items: [
      { sku: "IT-HUBB-4PT", qty: 2, target_unit_price_paise: 150000 } // catalog is 189900. cost is 132930. Target 150000 gives ok margin.
    ]
  };
  
  const res = processRfq(req);
  console.log("RFQ Result:", JSON.stringify(res, null, 2));
  
  const session = getSession(res.session_id);
  console.log("\nSession stored:", JSON.stringify(session, null, 2));
}

run();
