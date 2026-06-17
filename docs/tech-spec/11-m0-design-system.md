# 11 — M0 Design System (Tailwind + shadcn/ui)

The visual language for the M0 frontend and the styling stack that implements it. This is the design-depth companion to `04-api-and-frontend.md` (component tree, state, a11y) and the source of truth for the `globals.css` tokens and shadcn component choices that land in `apps/web` (phase 6). It evolves the look of `../prototypes/prototype.html` rather than replacing it.

PRD references: `Language and Theme Requirements` (light/dark + a11y baseline), `Answer Contract` (Status × Confidence), `Interaction Model`.

## 1. Principles

1. **The design's job is to make a trusted, evidence-backed Answer *feel* trustworthy** — the #1 M0 product risk. Provenance (Evidence, SQL, policy notes), honest non-answers, and "the app controls, the AI proposes" must be legible, never hidden.
2. **One token system, two densities.** The product has two temperaments and we modulate, not fork:
   - **Querier — Ask Data**: calm, conversational, roomy. A reliable analyst, not a toy chatbot.
   - **Admin — calibration/publishing**: structured, dense, control-oriented. Forms, policy, glossary.
3. **Color carries one meaning at a time.** Loud color is reserved for **Status**; everything else (confidence, chrome) stays neutral so the status read is unambiguous.
4. **Quiet by default.** Flat surfaces, restrained elevation, purposeful motion. Gravitas over flourish.

## 2. Stack

| Concern | Choice |
|---|---|
| Utility CSS | **Tailwind CSS v4** (CSS-first `@theme`, no JS config needed). |
| Components | **shadcn/ui** (Radix primitives, copied into `apps/web/components/ui`). Owned in-repo, themable, accessible by construction. |
| Theme tokens | **CSS custom properties** (§3) consumed by Tailwind's `@theme inline` and by shadcn's semantic vars. Light/dark via `[data-theme]` on `<html>` (matches `04 §5`). |
| Icons | **lucide-react** (outline, one visual weight). |
| Fonts | Inter (Latin) + Noto Sans SC / PingFang fallback (CJK); Geist Mono / JetBrains Mono (SQL). |

shadcn's CSS-variable theming is a direct upgrade of the prototype's token approach, so the migration is continuous: the same semantic names, now driving Radix-backed components.

## 3. Color tokens (`globals.css` draft)

Palette carried over from the prototype (trustworthy blue `#2f6df0`; semantic green/amber/red), expressed as shadcn-style base tokens plus a layered **status** set. Drop-in for phase 6.

```css
:root {
  --radius: 0.625rem;                 /* ~10px, matches the prototype */

  --background: #f7f8fa;  --foreground: #1a1d21;
  --card: #ffffff;        --card-foreground: #1a1d21;
  --popover: #ffffff;     --popover-foreground: #1a1d21;
  --primary: #2f6df0;     --primary-foreground: #ffffff;   /* brand */
  --secondary: #eef1f4;   --secondary-foreground: #1a1d21;
  --muted: #eef1f4;       --muted-foreground: #5b626b;
  --accent: #eef1f4;      --accent-foreground: #1a1d21;     /* neutral hover */
  --destructive: #c0392b; --destructive-foreground: #ffffff;
  --border: #e5e8ec;      --input: #d2d7dd;  --ring: #2f6df0;
  --code-bg: #f3f4f6;

  /* Status (the only "loud" color). bg = soft tint, fg = readable on tint. */
  --status-answered: #1a8f5a;   --status-answered-bg: #e4f5ec;
  --status-clarify: #2f6df0;    --status-clarify-bg: #e9f0fe;
  --status-partial: #b07d0a;    --status-partial-bg: #fbf3df;
  --status-blocked: #c0392b;    --status-blocked-bg: #fbeae8;
  --status-unreliable: #5b626b; --status-unreliable-bg: #eef1f4;  /* neutral, not red */
}

[data-theme='dark'] {
  --background: #0f1114;  --foreground: #e9ecef;
  --card: #181b1f;        --card-foreground: #e9ecef;
  --popover: #181b1f;     --popover-foreground: #e9ecef;
  --primary: #5e93f7;     --primary-foreground: #0f1114;
  --secondary: #20242a;   --secondary-foreground: #e9ecef;
  --muted: #20242a;       --muted-foreground: #aab2bb;
  --accent: #20242a;      --accent-foreground: #e9ecef;
  --destructive: #e57368; --destructive-foreground: #0f1114;
  --border: #282d33;      --input: #39414a;  --ring: #5e93f7;
  --code-bg: #13161a;

  --status-answered: #4cc38a;   --status-answered-bg: #15331f;
  --status-clarify: #5e93f7;    --status-clarify-bg: #1a2a47;
  --status-partial: #e0b04a;    --status-partial-bg: #382d12;
  --status-blocked: #e57368;    --status-blocked-bg: #381d1a;
  --status-unreliable: #aab2bb; --status-unreliable-bg: #20242a;
}
```

Tailwind v4 maps these in `@theme inline` (`--color-background: var(--background)`, etc.) so utilities like `bg-background`, `text-muted-foreground`, `bg-status-answered-bg` exist. Every pairing is verified for WCAG AA in both themes (`04 §6`, `06` render matrix).

## 4. Status × Confidence (the key information-design decision)

The Answer Contract carries an `AnswerStatus` and an independent `Confidence`. The prototype rendered both as colored badges, which blurs them. M0 separates them:

**Status — a colored badge (icon + token + label).** The single place loud color lives.

| `AnswerStatus` | Token | lucide icon | Reading |
|---|---|---|---|
| `Answered` | `status-answered` (green) | `CircleCheck` | resolved |
| `NeedsClarification` | `status-clarify` (blue) | `CircleHelp` | needs input |
| `Partial` | `status-partial` (amber) | `CircleDashed` | partial, caution |
| `BlockedByPolicy` | `status-blocked` (red) | `Lock` | the boundary held |
| `NoReliableAnswer` | `status-unreliable` (**neutral grey**) | `CircleSlash` | honest "can't" — not an error |

Note the deliberate choice: red is reserved for `BlockedByPolicy` (a guardrail acting); a `NoReliableAnswer` is humble, not alarming, so it reads neutral.

**Confidence — a quiet monochrome meter.** A three-segment meter (High = 3, Medium = 2, Low = 1) in `muted-foreground`, with the label beside it and `confidenceReason` on hover (shadcn `Tooltip`). It never uses status color, so "what is this conclusion" and "how sure am I" never compete.

## 5. Typography

```css
--font-sans: 'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
--font-mono: 'Geist Mono', 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
```

- Latin via Inter; CJK falls back to PingFang/Noto Sans SC so bilingual (en / zh-CN) lines stay aligned and legible.
- SQL and identifiers use the mono stack (Evidence SQL, schema names).
- Scale is modest and consistent: body ~14px in the thread, 15px for the Direct Answer lead, 12px for meta/badges. Two weights (400 / 500) — heavier weights read as noise against this neutral palette.

## 6. Radius, elevation, motion

- **Radius**: `--radius` (~10px) for controls/cards; full-round (`999px`) for badges/pills/chips.
- **Elevation**: structure uses flat 1px borders; soft shadow is reserved for *floating* surfaces only — the composer, the data-source `Command` popover, dialogs, dropdowns. Everything in the thread is flat.
- **Motion**: the streamed reasoning block shows a live pulsing indicator on the active step, then collapses into `What I did`. Collapsibles ease open/closed. All motion respects `prefers-reduced-motion` (the spinner degrades to static — `04 §6`).

## 7. shadcn component mapping

| Surface (from `04 §2`) | Component(s) |
|---|---|
| `StatusRow` status badge | `Badge` (variant per status token) |
| Confidence meter + reason | custom 3-segment meter + `Tooltip` |
| `WhatIDid`, Evidence SQL | `Collapsible` (collapsed by default) |
| `EvidenceItem` | `Card` + `Collapsible` |
| Data-source selector (in-composer pill) | `Command` inside `Popover` |
| `view_mutation_draft` (BlockedByPolicy) | `Dialog` (read-only draft + risk notes; never executes) |
| `Followups`, choice chips | `Button` (pill / ghost) |
| `QuickActions` (rerun / copy / handoff) | `Button` + `DropdownMenu` |
| Admin Policy editor | `Form`, `Switch`, `Select`, `Input`, `Slider` |
| Glossary / Mapping `Suggested → Verified` | `Badge` + `Button` |
| Admin calibration flow | stepper (custom) + `Tabs` |
| Notifications | `Sonner` (toast) |
| Streaming placeholders | `Skeleton` |

All are Radix-backed, so keyboard and ARIA semantics come for free and align with `04 §6`.

## 8. Density modes

One token set, two spacing rhythms:

- **`relaxed`** (Ask Data thread): generous padding and line-height; the conversation breathes. Borrows the warmth of the "Quiet Assistant" direction.
- **`compact`** (Admin tables, glossary, policy rows): tighter rows and denser type for scanning many items. Borrows the "Control Room" density.

Implemented as a density scope (a class toggling Tailwind spacing scales), not separate components.

## 9. Accessibility

- WCAG AA contrast across all four combinations (en/zh × light/dark) — a CI render-matrix gate (`06`). Token pairs in §3 are chosen to pass.
- Radix primitives provide focus management, keyboard operation, and ARIA roles; the thread is a `feed`/`log`, streamed reasoning is `aria-live="polite"` (`04 §6`).
- Visible focus ring uses `--ring`; no focus traps; honors `prefers-reduced-motion`.

## 10. Where it lives (phase 6)

```
apps/web/
├─ app/globals.css        # the §3 tokens + Tailwind v4 @theme inline mapping
├─ components/ui/         # shadcn components (owned in-repo)
└─ components/            # AnswerView, StatusBadge, ConfidenceMeter, EvidenceItem, ...
```

Design tokens are UI chrome only. Answer **content** remains resolved `LocalizedText` from the contract (`04 §4`) — the renderer styles it, never translates it.
