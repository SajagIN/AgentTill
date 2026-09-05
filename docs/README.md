# AgentTill documentation

Start at the [README](../README.md) if you have not already — it covers what the product is and how to run it.

## Reading order

If you are evaluating AgentTill, read **01**, **04** and **05**. Those three explain the trust boundary, the rules that enforce it, and the record that proves it was enforced.

If you are running it, read **02**. If you are integrating against it, read **03** and **06**.

| | |
|---|---|
| **[01 · Architecture](01-architecture.md)** | Components, request lifecycle, the three boundaries, storage |
| **[02 · Setup](02-setup.md)** | Install, environment, running, building, developing, testing |
| **[03 · API reference](03-api.md)** | All 24 `/api` routes with request and response shapes |
| **[04 · Policies & money rules](04-policies.md)** | The rule engine, precedence, thresholds, M1–M4, webhook security |
| **[05 · Audit & receipts](05-audit.md)** | The event schema, Merkle construction, and what it does and does not prove |
| **[06 · MCP integration](06-mcp.md)** | Eight tools, two transports, client configuration |
| **[07 · State machine](07-state-machine.md)** | Mission states, legal transitions, who moves what |
| **[08 · Troubleshooting](08-troubleshooting.md)** | Failure modes, what you will see, what to do |
| **[09 · Decision log](09-decision-log.md)** | Why the design looks like this, and what the audit changed |
| **[10 · Walkthrough](10-walkthrough.md)** | The five-minute tour, in text and audio |
| **[Product requirements](prd.md)** | Original scope, users, non-goals — corrected where reality diverged |

## Conventions used throughout

**Money is integer paise.** ₹1 = `100`. Every amount in every request, response, database column and code variable is an integer count of paise, suffixed `Paise`. Conversion to a rupee string happens only in the UI.

**Rule ids versus config keys.** `ruleEvals` entries use rule ids (`velocity_max_checkouts_per_hour`). The Policies page and `PUT /api/policies/:key` use config keys (`velocity_max_checkouts`). They are not always identical; [`04-policies.md`](04-policies.md) has the mapping.

**Verified claims.** Where this documentation describes behaviour, it was checked against the running code. Where it reports a diagnosis that could not be reproduced on demand — one case, in [`08-troubleshooting.md`](08-troubleshooting.md) — it is labelled as a diagnosis.

## Keeping it accurate

The code is the source of truth. When the two disagree, fix the document.

Three things to check after changing behaviour:

- **Endpoints** — [`03-api.md`](03-api.md) lists every route. `grep -E '^api\.(get|post|put|delete)\(' src/routes.js` should match it.
- **Policy defaults** — [`04-policies.md`](04-policies.md) quotes the values seeded in `src/db.js`.
- **States** — [`07-state-machine.md`](07-state-machine.md) mirrors the `ALLOWED` map in `src/missions.js` and the display metadata in `frontend/src/lib/mission-states.ts`.

The test suite is the cheapest way to keep the first two honest: `src/e2e.test.js` asserts the field names the dashboard reads and the shapes the API returns, so a silent contract change fails a test rather than a reader.
