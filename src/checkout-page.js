/**
 * Standalone Razorpay Standard Checkout page.
 *
 * Razorpay test mode caps accounts at 30 live payment links per hour. When that
 * limit is hit, money-actions still creates a real order and points the buyer at
 * this page instead, so a checkout can always be completed.
 *
 * Only values that already exist in the orders table are interpolated, and every
 * one of them is a Razorpay-issued id or an integer amount, so the document
 * cannot be used to inject script.
 */
export function renderCheckoutPage({ order, razorpayKeyId }) {
  const amountRupees = (order.amountPaise / 100).toFixed(2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Complete payment · AgentTill</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #18181b; }
    .card { width: 100%; max-width: 420px; background: #fff; border: 1px solid #e4e4e7;
            border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #71717a; font-size: 14px; margin: 0 0 24px; }
    .row { display: flex; justify-content: space-between; font-size: 14px; padding: 8px 0;
           border-top: 1px solid #f4f4f5; }
    .row span:last-child { font-family: ui-monospace, monospace; }
    .amount { font-size: 28px; font-weight: 600; margin: 16px 0 24px; }
    button { width: 100%; background: #18181b; color: #fff; border: 0; border-radius: 8px;
             padding: 12px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { background: #3f3f46; }
    .done { text-align: center; }
    .done h1 { color: #16a34a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Complete payment</h1>
    <p class="sub">AgentTill · authorised programmatic purchase</p>
    <div class="amount">&#8377;${amountRupees}</div>
    <div class="row"><span>Order</span><span>${order.orderId}</span></div>
    <div class="row"><span>Mission</span><span>${order.missionId}</span></div>
    <div class="row"><span>Cart</span><span>${order.cartId}</span></div>
    <div style="margin-top:24px">
      <button id="pay-button">Pay now</button>
    </div>
  </div>

  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    const checkout = new Razorpay({
      key: ${JSON.stringify(razorpayKeyId)},
      amount: ${JSON.stringify(order.amountPaise)},
      currency: "INR",
      name: "AgentTill",
      description: "Programmatic purchase",
      order_id: ${JSON.stringify(order.orderId)},
      theme: { color: "#18181b" },
      handler(response) {
        document.body.innerHTML =
          '<div class="card done"><h1>Payment successful</h1>' +
          '<p class="sub">You can close this tab and return to the AgentTill dashboard.</p>' +
          '<div class="row"><span>Payment</span><span>' + response.razorpay_payment_id + '</span></div></div>';
      }
    });
    checkout.on("payment.failed", (response) => alert(response.error.description));
    document.getElementById("pay-button").onclick = (event) => {
      event.preventDefault();
      checkout.open();
    };
  </script>
</body>
</html>`;
}
