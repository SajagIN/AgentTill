# Design — AgentTill dashboard

**Concept: "mission control for agent money."** A dark, calm, high-contrast control room — it should feel like watching a bounded system, not a shopping site. It must read perfectly in a screen-recorded 5-minute video: big cards, unambiguous color language, no tiny text. Implemented as ONE stylesheet (`public/styles.css`, CSS variables, no framework, no webfonts required) + vanilla JS rendering.

## 1. Design tokens

```css
:root {
  /* surfaces */
  --bg: #0B0F1A;          /* app background */
  --surface: #111827;     /* cards */
  --surface-2: #0E1524;   /* nested/detail areas */
  --border: #1F2937;
  /* text */
  --text: #E5E7EB;  --text-muted: #9CA3AF;  --text-faint: #6B7280;
  /* semantics — the whole safety story lives in these 4 colors */
  --brand: #0B72E7;       /* Razorpay-blue: structure, links, agent identity */
  --allow: #22C55E;       /* allowed / confirmed */
  --deny:  #EF4444;       /* denied / failed-final / forgery */
  --gate:  #F59E0B;       /* needs approval / awaiting / retrying */
  /* type */
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --radius: 10px;  --radius-sm: 6px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --sp-8: 32px;
}
```

Contrast rule: text on any chip/badge always `#0B0F1A` (dark) on the color, or the color used for borders/8%-tint backgrounds with light text. Never gray-on-gray below WCAG AA.

## 2. Typography

| Role | Spec |
|---|---|
| Page title | 20px/600 sans |
| Card title | 15px/600 sans |
| Body | 14px/400, line-height 1.5 |
| **Money** | **mono, 14–18px, 500** — always `formatINR(paise)` → `₹1,234.00` (`Intl.NumberFormat('en-IN')`) |
| **Ids** (`order_…`, `pay_…`, `evt_…`, sku) | mono 12px, `--text-muted`, click-to-copy on hover outline |
| Timestamps | mono 12px, IST (`Asia/Kolkata`), format `23:41:12 · 30 Aug` |
| Rule-eval detail | 12.5px, `--text-faint`, inside collapsible `<details>` |

Hierarchy trick for video: money amounts and decision chips are the only saturated things on screen. Everything else is gray — the eye lands on the rupees.

## 3. Core components

**Decision chip** (the atom of the whole UI):
`● ALLOWED` (green outline, green dot) · `● DENIED` (red, filled tint) · `● NEEDS APPROVAL` (amber) · `● RETRYING` (amber, pulsing) · `● AWAITING SIGNATURE FAIL`/info (slate). Caps, 11px, letter-spacing 0.5px.

**Audit event card** — one per money action, on a vertical timeline (2px `--border` line, 10px node dots colored by outcome):
```
[● ALLOWED]  create_order                    ₹1,234.00
             policy: 5/5 passed · max_basket ₹2,500 ✓ …   (collapsed <details>)
             order_OxDx9… · pay link ↗ · 23:41:07 IST
```
Retry chain: child events indent 24px with a left connector from the parent node — the "failure recovered" story must be visible in one glance.

**Approval card** (top of dashboard, can't miss it):
```
┌──────────────────────────────────────────────────────┐
│ ⚠ APPROVAL NEEDED            ₹1,899.00               │
│ Buyer agent · mission_7f3 · office restock           │
│ reason: amount ₹1,899.00 > threshold ₹1,000.00       │
│ cart: 3× notebooks · 1× markers · 2× coffee   ▤view  │
│                              [ DENY ]   [ APPROVE ]  │
└──────────────────────────────────────────────────────┘
```
Buttons: APPROVE = `--allow` filled, dark text; DENY = ghost with `--deny` border. On click → optimistic state "resolved", row fades.

**Mission row** (list): state badge + intent snippet + budget vs spent (mono) + event count + rel time. State badges reuse decision chips (`CONFIRMED` green, `ESCALATED` red, `AWAITING_APPROVAL` amber, `PAYING/RETRYING` amber pulse, `REJECTED` gray-red).

**Mission detail** = header (intent, budget, state, actor) + the timeline. Empty state: "No money has moved yet — that's the point." (on-brand copy, muted).

## 4. Layout (single page, hash routing — keep it one page)

```
┌─────────────────────────────────────────────────────────────┐
│ AgentTill ▮ mission control for agent money     [ ● LIVE ]   │ 56px header, border-bottom
├──────────────────┬──────────────────────────────────────────┤
│ MISSIONS (list)  │  MISSION DETAIL / TIMELINE                │
│ mission_7f3 ●    │  (approval cards dock here when pending)  │
│ mission_9c1 ✓    │                                          │
│ …                │                                          │
└──────────────────┴──────────────────────────────────────────┘
   320px sidebar       fluid, max-width 880px, centered content
```
No login, no navigation depth. `/` = dashboard. Poll `GET /missions` + open mission every 2.5s (the demo "comes alive" when webhooks land).

## 5. Microdetails that sell it on video

- Header `[● LIVE]` dot pulses green on any new audit event (websocket-free: poll result diff).
- When a `DENIED` event lands, the timeline card flashes red once (CSS keyframe 600ms).
- Approval resolution → timeline grows an `APPROVED by human` info-event card — the human's fingerprints visible next to the agent's.
- Copy on traces of LLM judgment: agent-authored reason lines render in quotes with an `agent says` label, visually distinct (italic, brand-tint border-left) from machine rule evals — **the AI-vs-deterministic boundary should be visible in the UI itself.**
- Print-friendly fallback: light background on `@media print` (for the README still, if needed).

## 6. Non-goals (UI)

No storefront, no cart page for humans, no animations beyond the two above, no charts, no dark/light toggle (dark only), no mobile-specific work beyond "doesn't break at 1024px".
