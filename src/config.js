/**
 * Environment & configuration — single source of truth for settings.
 *
 * Bun auto-loads .env from the project root; never import a dotenv library (R1).
 * Fails fast at import time, naming WHICH variables are wrong — never their
 * values, so secrets can't leak into logs (R3).
 */
import { z } from "zod";

const EnvSchema = z.object({
  // Razorpay — TEST MODE ONLY. Live keys are a project-level ban (PRD non-goal).
  RAZORPAY_KEY_ID: z
    .string({
      required_error:
        "RAZORPAY_KEY_ID is missing (Razorpay Dashboard → Settings → API Keys, Test mode)",
    })
    .regex(
      /^rzp_test_/,
      "RAZORPAY_KEY_ID must start with 'rzp_test_' — live keys are banned in AgentTill",
    ),
  RAZORPAY_KEY_SECRET: z
    .string({ required_error: "RAZORPAY_KEY_SECRET is missing" })
    .min(1, "RAZORPAY_KEY_SECRET must not be empty"),

  // Not needed until Phase 3 / Phase 6 — validated at point of use until then.
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

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

/** Frozen, validated app configuration (camelCase view of the env). */
export const config = Object.freeze({
  port: parsed.data.PORT,
  baseUrl: parsed.data.BASE_URL,
  razorpayKeyId: parsed.data.RAZORPAY_KEY_ID,
  razorpayKeySecret: parsed.data.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: parsed.data.RAZORPAY_WEBHOOK_SECRET,
  openaiApiKey: parsed.data.OPENAI_API_KEY,
  openaiModel: parsed.data.OPENAI_MODEL,
});
