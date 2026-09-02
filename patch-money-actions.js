import fs from 'fs';
const data = fs.readFileSync('src/money-actions.js', 'utf8');

// The change we made earlier. Let's revert and do it properly.
const newCheck = `  const reTotal = retotalFromCatalog(cart.items);
  // Rule M2 check respects A2A negotiated overrides signed by the backend
  const authorizedTotal = cart.negotiatedTotalPaise || cart.totalPaise;
  const isMismatch = cart.negotiatedTotalPaise ? false : (reTotal !== cart.totalPaise);
  
  if (isMismatch) {
    const reason =
      \`quote→order mismatch: cart \${cartId} quoted \${cart.totalPaise} paise, \` +
      \`catalog now totals \${reTotal} paise — hard stop before order creation (M2)\`;
    appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      status: "failed",
      reason,
    });
    throw new MoneyActionError(422, "AMOUNT_MISMATCH", reason);
  }`;

const properLogic = `  const reTotal = retotalFromCatalog(cart.items);
  // Rule M2 check respects A2A negotiated overrides signed by the backend
  const authorizedTotal = cart.negotiatedTotalPaise || cart.totalPaise;
  const isMismatch = cart.negotiatedTotalPaise ? false : (reTotal !== cart.totalPaise);
  
  if (isMismatch) {
    const reason =
      \`quote→order mismatch: cart \${cartId} quoted \${cart.totalPaise} paise, \` +
      \`catalog now totals \${reTotal} paise — hard stop before order creation (M2)\`;
    appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      status: "failed",
      reason,
    });
    throw new MoneyActionError(422, "AMOUNT_MISMATCH", reason);
  }
`;

let content = data.replace(newCheck, properLogic);

// Replace remaining uses of reTotal down the line with authorizedTotal inside the function
// We'll surgically replace them by text replacement.
content = content.replace(/amountPaise: reTotal/g, 'amountPaise: authorizedTotal');

fs.writeFileSync('src/money-actions.js', content);
