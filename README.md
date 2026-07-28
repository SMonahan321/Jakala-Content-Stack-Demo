# One post, shared everywhere

> Contentstack Hackathon 2026 · Team JAKALA · Track: *Composable Agents for Experience Orchestration*

## Elevator pitch

Author a blog post once in Contentstack, and an external AI agent automatically
**transcreates** it (tone-aware, not literal translation) and **reformats** it into
per-channel social variants across multiple locales — enforcing brand voice and
**healthcare-compliance** guardrails, gating on human review, then pushing the
approved result to Slack. Contentstack is the system of record; a Vercel app is the
**orchestrator**, and the **deep reasoning** (transcreation + fact-check) is owned by
**[Vercel eve](https://eve.dev)** — Vercel's durable backend-agent framework — showing
how Contentstack governance can extend *beyond* Contentstack.

## The business problem

Content teams must reshape a single message for many channels and languages, each
with its own format, tone, and rules. In **healthcare**, this is acute: copy must
meet regulatory and brand requirements (required disclaimers, no unsupported medical
claims), and mistakes carry real risk. Doing this by hand per channel × per locale
is slow, expensive, and error-prone.

**Demo scenario (fictional):** *Cascade Regional Health*, a regional health system,
runs a seasonal **flu-vaccination awareness campaign**. One source blog post fans out
to LinkedIn, X, and Instagram in English, Spanish, and French — compliant and on-brand.

## Locked design decisions

| Area | Decision |
| --- | --- |
| **Orchestration** | A Vercel-hosted Next.js app is the **orchestrator** (webhook, Contentstack read/write, workflow-stage gating, Slack push, preview). The **deep reasoning** (transcreation + fact-check) is owned by **Vercel eve**, invoked by the orchestrator, with results written back to Contentstack. The raw Vercel AI SDK path remains an in-process fallback behind the same seam. Hybrid-with-Agent-OS-via-MCP is a **future** option, not built now. |
| **Trigger** | Contentstack workflow-stage transition to **"Ready for Distribution"** fires a webhook to the Vercel app. |
| **Fan-out** | 3 channel variants — **LinkedIn, X/Twitter, Instagram** — stored as Contentstack entries and rendered as channel-accurate preview cards. |
| **Real external push** | Exactly **one**: Slack (bot token). No real LinkedIn/X/IG posting — mock preview cards only. |
| **Languages** | English source → **Spanish (es)** + **French (fr)** targets, stored as native Contentstack locales. |
| **Translation** | Locales for storage; the agent performs tone-aware **transcreation** per channel *and* per locale (adapt tone, not literal). |
| **Content model** | `Blog Post` source type; outputs are separate `Channel Variant` entries referenced back to the Blog Post, localized across en/es/fr. |
| **Brand + compliance** | Brand voice + healthcare rules stored conceptually in a Contentstack **Brand Kit**, fed to the agent as grounding. A **Fact-Checker** validates that medical claims are supported by the source and that the required disclaimer is present. |
| **Governance** | Generated variants land in a **"Needs Review"** stage; only human approval fires the real Slack push. Fact-check failure auto-flags. |
| **Personalization** | **Out of scope** (roadmap only). |
| **Stack** | Next.js (App Router, TypeScript) on Vercel (orchestrator) + **Vercel eve** for deep reasoning (with a Vercel AI SDK `ai` in-process fallback, provider-agnostic, OpenAI by default) + `@contentstack/management` for write-back + Slack via `@slack/web-api`. Reasoning provider is chosen by `REASONING_PROVIDER`. |
| **Demo surface** | Contentstack UI + real Slack post + a minimal internal `/preview` page (3 channels × 3 locales). No customer-facing site. |
| **Build reality** | Solo core builder, ~7 days, deadline **2026-07-31**. Lean, runnable scaffold. |

## Architecture flow

```
                          Contentstack (system of record)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  Author edits Blog Post (en)                                           │
  │        │                                                               │
  │        ▼                                                               │
  │  Workflow stage → "Ready for Distribution"  ── webhook ──┐             │
  └──────────────────────────────────────────────────────────┼───────────┘
                                                              │
                                                              ▼
                                   Vercel app  (the ORCHESTRATOR)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  POST /api/webhook                                                      │
  │    1. verify secret header                                             │
  │    2. load Blog Post entry + Brand Kit rules (grounding)               │
  │    3. for {linkedin, x, instagram} × {en, es, fr}  (9)  ─── delegate ──┐│
  │    4. gate each variant on the fact-check result  ◄── results ────────┐││
  │       (deterministic disclaimer backstop + pass/flag stays here)      │││
  └───────────────────────────────────────────────────────────────────────┘
        │ write-back (Management API)          reasoning seam (lib/eve.ts) │││
        │                                                    ▼             │││
        │                        Vercel eve  (DEEP REASONING) ◄────────────┘││
        │              ┌──────────────────────────────────────────────┐    ││
        │              │  • transcreate: channel/locale tone adaptation │───┘│
        │              │  • factCheck:   claim-support + prohibited-claim│────┘
        │              │  durable runs · AI Gateway model routing        │
        │              └──────────────────────────────────────────────┘
        │                          (fallback: in-process Vercel AI SDK)
        ▼                                                     │ fail → flag
  ┌──────────────────────────────┐              ┌──────────────────────────┐
  │ Channel Variant entries      │              │ variant.status = flagged │
  │ (master en + es/fr locales)  │              └──────────────────────────┘
  │ Blog Post → "Needs Review"   │
  └──────────────────────────────┘
        │  human approves in Contentstack (the gate)
        ▼
  ┌──────────────────────────────┐        ┌───────────────────────────────┐
  │  Real Slack push (bot token) │        │  /preview renders 3×3 cards    │
  └──────────────────────────────┘        └───────────────────────────────┘
```

### Who owns what

| Owner | Responsibilities |
| --- | --- |
| **Contentstack** | System of record: Blog Post source, Channel Variant entries, locales, workflow stages, Brand Kit, webhook trigger. |
| **Vercel app (orchestrator)** | Webhook receipt + secret verification, reading the Blog Post, fanning out the channel × locale matrix, invoking the reasoning seam, the deterministic disclaimer backstop + pass/flag gating, write-back via the Management API, moving the Blog Post to "Needs Review", the approval-gated Slack push, and the `/preview` page. |
| **Vercel eve (deep reasoning)** | The two reasoning tasks only: **transcreation** (tone-aware channel/locale adaptation) and **fact-check** claim analysis (unsupported/prohibited claims). eve provides durable runs, sandboxing, and AI-Gateway model routing. Selected via `REASONING_PROVIDER=eve`; the raw Vercel AI SDK is the in-process fallback (`REASONING_PROVIDER=aisdk`, the default).

## Deep reasoning: Vercel eve

The channel/locale **transcreation** and the **fact-check** claim analysis are the two
"deep reasoning" tasks. They are isolated behind a single seam — `ReasoningService` in
[`lib/eve.ts`](./lib/eve.ts) — so the implementation is swappable via `REASONING_PROVIDER`.

### What Vercel eve is (from research)

[eve](https://eve.dev) ([`vercel/eve`](https://github.com/vercel/eve), npm `eve`, Apache-2.0,
released June 2026, **beta**) is a *filesystem-first framework for durable backend AI
agents*. You author an agent as a directory of files (`agent/agent.ts` for the model,
`agent/instructions.md` for the system prompt, `agent/tools/*.ts`, `agent/channels/*.ts`,
`agent/schedules/*.ts`); eve compiles it into an app that runs on **Vercel Functions**. It
ships durable execution (Vercel Workflows), sandboxed compute (Vercel Sandbox), model
routing (**AI Gateway** — authenticate with OIDC on Vercel, no provider key per project),
human-in-the-loop approvals, and observability. Scaffold with `npx eve@latest init`,
deploy with `npx eve deploy` / `vercel deploy`.

**Integration model.** An eve agent is a *separately deployed* app, not an npm library you
`import` into a route handler. It is triggered over a **channel** (HTTP/Slack/Discord). The
reference docs-agent ([`sanity-labs/sanity-eve-docs-agent`](https://github.com/sanity-labs/sanity-eve-docs-agent),
[guide](https://vercel.com/kb/guide/sanity-eve-agent)) is triggered by an HTTP POST whose
channel verifier accepts `Authorization: Bearer ${EVE_TRIGGER_SECRET}` and lives at an
`EVE_AGENT_URL` (locally `http://127.0.0.1:2000`, in prod `https://your-agent.vercel.app`).

### Assumption + the seam (why eve is a documented TODO here)

eve sessions are **durable/async** and the reference agent performs its whole loop from its
own tools (read → draft → Slack). A synchronous *"send a reasoning task, get structured
JSON back"* endpoint is **not a documented drop-in**. So in this scaffold:

- The **default** is `REASONING_PROVIDER=aisdk` — `AiSdkReasoningService` runs the reasoning
  in-process with the Vercel AI SDK. This builds and runs today and is the fallback.
- `REASONING_PROVIDER=eve` selects `EveReasoningService`, a thin HTTP client that POSTs
  `{ task, input }` to `EVE_AGENT_URL` with a bearer `EVE_TRIGGER_SECRET` and expects
  `{ result }` back. **The request/response envelope is a clearly-marked `TODO`** — to wire
  it concretely you author an eve agent whose HTTP channel accepts that payload and returns
  structured output, deploy it (`npx eve deploy`), then adapt the parsing in `lib/eve.ts` to
  eve's real session/turn response shape.

Because everything is behind `ReasoningService`, swapping to eve requires **no change** to
`agent.ts`, `factcheck.ts`, or the webhook pipeline.

## Contentstack content models

### `Blog Post` (`blog_post`) — source
| Field | uid | Type |
| --- | --- | --- |
| Title | `title` | text (required) |
| Summary | `summary` | text |
| Body | `body` | multiline text (required) |
| Key Claims | `key_claims` | text (multiple) — source-of-truth claims for the fact-checker |

### `Channel Variant` (`channel_variant`) — generated output
| Field | uid | Type |
| --- | --- | --- |
| Title | `title` | text (internal label) |
| Channel | `channel` | enum: `linkedin \| x \| instagram` |
| Formatted Text | `formatted_text` | multiline text |
| Hashtags | `hashtags` | text (multiple) |
| Character Count | `char_count` | number |
| Image Crop Spec | `image_crop_spec` | text (JSON string) |
| Status | `status` | enum: `generated \| needs_review \| flagged \| approved \| published` |
| Source Blog | `source_blog` | reference → `blog_post` |

**Locales:** `en` (master/source) · `es` · `fr`. Channel Variants are created in `en`
then localized into `es`/`fr`.

**Workflow (on Blog Post):** `Draft → Ready for Distribution → Needs Review → Approved → Published`.
Full JSON definitions and creation steps live in [`content-models/`](./content-models).

## Contentstack capabilities exercised

- **Content Cloud — modeling:** two related content types (`blog_post`, `channel_variant`) with a reference field.
- **Content Cloud — localization:** native `en`/`es`/`fr` locales; variants localized, not duplicated.
- **Content Cloud — workflows:** staged governance with a human review gate.
- **Content Cloud — webhooks:** stage transition triggers the external agent.
- **Brand Kit:** brand voice + healthcare compliance rules as agent grounding (see `lib/brandkit.ts`).
- **Fact-Checker:** claim-support + required-disclaimer validation per variant (deterministic disclaimer backstop + gating in `lib/factcheck.ts`; claim analysis via the reasoning seam).
- **Beyond Contentstack:** **Vercel eve** durable agent performing the deep reasoning (transcreation + fact-check) behind a swappable seam (`lib/eve.ts`); **Slack** as the one real external activation.

## MVP vs. stretch

**MVP (must ship for the demo)**
- Webhook trigger → agent → transcreation for 3 channels × 3 locales.
- Write-back of `Channel Variant` entries (master + es/fr) via the Management API.
- Brand Kit grounding + Fact-Checker (claims + disclaimer) with auto-flagging.
- "Needs Review" gate; human approval fires **one real Slack push**.
- `/preview` page rendering channel-accurate 3×3 cards from the fixture.

**Stretch (nice-to-have)**
- Fact-check citations linking flagged claims to source spans.
- Regenerate-single-variant action from the preview page.
- Approve/flag actions written back to Contentstack from the app.
- Hybrid orchestration with **Agent OS via MCP**.
- **Personalization** / real-time decisioning (currently out of scope).
- Real channel publishing adapters (LinkedIn/X/IG) behind the same interface.

## 7-day build sequence (solo builder)

| Day | Goal |
| --- | --- |
| **1** | Contentstack setup: create `blog_post` + `channel_variant`, add `es`/`fr` locales, build the Blog Post workflow, configure the webhook to the Vercel `/api/webhook` **stub**. Verify the payload arrives. |
| **2** | Agent end-to-end for **1 channel / 1 locale**: transcreate → **real Slack push**. Prove the AI SDK + Slack path works. |
| **3** | **Write-back + fan-out to 3 channels**: create `channel_variant` entries via the Management API; wire the reference field. |
| **4** | **Locales + preview page**: localize variants into `es`/`fr`; build `/preview` (3×3 cards). |
| **5** | **Brand Kit + Fact-Checker + review gate**: grounding, claim/disclaimer validation, auto-flag, move Blog Post to "Needs Review", approval-gated Slack push. |
| **6** | **Polish + record**: styling, error handling, script + record the demo. |
| **7** | **Buffer**: fixes, submission form, dry run. Deadline **2026-07-31**. |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in when you have creds (not needed to build)
npm run dev                  # http://localhost:3000  →  /preview renders from the fixture
npm run build                # production build
npm run typecheck            # tsc --noEmit
```

The `/preview` page and `npm run build` work **without any credentials** (they use the
fixture in `lib/sample-data.ts`). Live keys are only needed to run the real pipeline.

## Environment variables

Documented in [`.env.example`](./.env.example). Required to run the live pipeline:

| Var | Purpose |
| --- | --- |
| `CONTENTSTACK_API_KEY` | Stack API key. |
| `CONTENTSTACK_MANAGEMENT_TOKEN` | Management token (read/write content types + entries). |
| `CONTENTSTACK_ENVIRONMENT` | Delivery environment name (e.g. `development`). |
| `CONTENTSTACK_WEBHOOK_SECRET` | Shared secret to verify the inbound webhook. |
| `REASONING_PROVIDER` | `aisdk` (default, in-process AI SDK) or `eve` (delegate to a deployed Vercel eve agent). Selects the implementation behind `lib/eve.ts`. |
| `OPENAI_API_KEY` | AI provider key for the `aisdk` path (provider is swappable in `lib/eve.ts`). |
| `AI_MODEL` | Optional model id override for the `aisdk` path (defaults to `gpt-4o`). |
| `EVE_AGENT_URL` | Base URL of the deployed eve agent's HTTP channel. Required when `REASONING_PROVIDER=eve`. |
| `EVE_TRIGGER_SECRET` | Shared secret sent as `Authorization: Bearer …` to the eve agent's channel. |
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-…`). |
| `SLACK_CHANNEL_ID` | Target Slack channel id. |

## Project layout

```
app/
  page.tsx               Landing page (flow summary, link to preview)
  preview/page.tsx       3 channels × 3 locales preview cards (fixture-backed)
  api/webhook/route.ts   Contentstack webhook receiver + pipeline orchestrator
  layout.tsx, globals.css
lib/
  eve.ts                 Deep-reasoning seam: ReasoningService interface + eve/AI-SDK impls + factory
  agent.ts               Transcreation orchestration (fan-out matrix + variant shaping) via the seam
  factcheck.ts           Disclaimer backstop + pass/flag gating; claim analysis via the seam
  contentstack.ts        Management API wrapper (read blog, write variants, workflow)
  slack.ts               Slack Web API push (the one real external activation)
  brandkit.ts            Fictional brand voice + healthcare compliance rules
  types.ts               Shared domain types (Channel, Locale, BlogPost, ChannelVariant…)
  sample-data.ts         Filled flu-campaign fixture for the preview page
content-models/          Blog Post + Channel Variant JSON + setup notes
```
