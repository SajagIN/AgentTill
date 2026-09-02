import { api } from "./src/routes.js";
import express from "express";
import { resetDemoData } from "./src/db.js";
import { seedCatalog } from "./src/catalog.js";

const app = express();
app.use(express.json());
app.use(api);

async function run() {
  resetDemoData();
  seedCatalog();
  const server = app.listen(3333, async () => {
    try {
      const rfqRes = await fetch("http://localhost:3333/negotiate/rfq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { sku: "IT-HUBB-4PT", qty: 2, target_unit_price_paise: 150000 }
          ]
        })
      });
      const data = await rfqRes.json();
      console.log("RFQ session:", data.session_id);
      
      const optionId = data.counter_offers[0].option_id;
      
      const acceptRes = await fetch("http://localhost:3333/negotiate/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: data.session_id,
          option_id: optionId
        })
      });
      console.log("\nAccept status:", acceptRes.status);
      console.log(await acceptRes.json());
    } finally {
      server.close();
    }
  });
}

run();
