/**
 * Every error that can reach a client extends AppError, so the Express error
 * middleware can map it to a status code and a stable `code` without inspecting
 * message strings. Anything that is NOT an AppError is treated as a bug: it is
 * logged server-side and reported as an opaque 500.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, issues) {
    super(400, "VALIDATION_ERROR", message);
    if (issues) this.issues = issues;
  }
}

export class WebhookVerificationError extends AppError {
  constructor(message = "webhook signature verification failed") {
    super(401, "WEBHOOK_SIGNATURE_INVALID", message);
  }
}

export class PolicyDeniedError extends AppError {
  constructor(message, ruleEvals) {
    super(403, "POLICY_DENIED", message);
    this.ruleEvals = ruleEvals;
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(404, "NOT_FOUND", message);
  }
}

export class TransitionError extends AppError {
  constructor(message) {
    super(409, "INVALID_TRANSITION", message);
  }
}

/** Raised by the money layer; status is chosen per failure, so it stays generic. */
export class MoneyActionError extends AppError {}

export class RazorpayApiError extends AppError {
  /**
   * `hint` carries caller-side knowledge the SDK could not supply — see
   * razorpay-client.js, which detects the SDK's lossy error path.
   */
  constructor(op, context, cause, hint) {
    const detail = `Razorpay ${op} failed${context ? ` [${context}]` : ""}: ${describeCause(cause)}`;
    super(502, "RAZORPAY_API_ERROR", hint ? `${detail} — ${hint}` : detail);
    this.op = op;
    this.context = context;
    this.cause = cause;
  }
}

export class WebhookMisconfiguredError extends AppError {
  constructor() {
    super(503, "WEBHOOK_SECRET_MISSING", "RAZORPAY_WEBHOOK_SECRET is not configured — refusing to process webhooks");
  }
}

export class WebhookPayloadError extends AppError {
  constructor(message) {
    super(400, "WEBHOOK_PAYLOAD_INVALID", message);
  }
}

function describeCause(cause) {
  if (!cause) return "unknown error";
  if (typeof cause === "string") return cause;
  if (cause.message) return String(cause.message);
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}