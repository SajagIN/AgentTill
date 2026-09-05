import { z } from "zod";

const EnvSchema = z.object({
  RAZORPAY_KEY_ID: z
    .string({
      required_error:
        "RAZORPAY_KEY_ID is missing (Razorpay Dashboard → Settings → API Keys, Test mode)",
    })
    .regex(
      /^rzp_test_/,
      "RAZORPAY_KEY_ID must start with 'rzp_test_' — live keys are not supported",
    ),
  RAZORPAY_KEY_SECRET: z
    .string({ required_error: "RAZORPAY_KEY_SECRET is missing" })
    .min(1, "RAZORPAY_KEY_SECRET must not be empty"),

  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BASE_URL: z.string().url().default("http://localhost:3000"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("✖ agenttill: invalid environment — fix .env and retry:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze({
  port: parsed.data.PORT,
  baseUrl: parsed.data.BASE_URL,
  razorpayKeyId: parsed.data.RAZORPAY_KEY_ID,
  razorpayKeySecret: parsed.data.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: parsed.data.RAZORPAY_WEBHOOK_SECRET,
});
