# Contentstack Hackathon — Submission of Intent (Final Answers)

Finalized responses for every field of the "Submission of Intent" form. Answers reflect the current, locked project decisions and supersede any earlier draft/placeholder text.

---

## Email

jon.bauer@jakala.com

## Partner Organization

JAKALA

## Team Name

Team JAKALA

## Region

North America

## Team Members and Roles

- Jon Bauer — Partner Manager (primary contact)
- Sean Monahan — Solutions Architect
- Alexei Gorobet — Director of Engineering
- Rob Pinciuc — Technical Architect
- Victor Urso — Senior Solutions Architect

## Primary Contact + Email

Jon Bauer — jon.bauer@jakala.com

## Challenge Track

Composable Agents for Experience Orchestration.

## Solution Name

One post, shared everywhere

## One-line Summary

Author a blog post once in Contentstack and an AI agent automatically transcreates it (tone-aware, not literal) and reformats it into per-channel social variants across locales — with brand and healthcare-compliance guardrails and a human review gate.

## Business Problem

Content rarely ships in a single shape: every channel and every language needs its own tone, length, and format. This is acute in healthcare, where content must satisfy regulatory and brand rules, carry required disclaimers, and avoid unsupported claims. Reshaping each piece manually — per channel × per locale — is slow, expensive, and error-prone, and the compliance burden makes mistakes costly. Our solution rewrites and reformats source content for each target channel and locale, drops it into the right structure for that channel's delivery, enforces brand and compliance guardrails, and keeps a human in the loop for approval — so teams can scale governed, on-brand content across platforms and languages without linear manual effort.

## Target Vertical / Use Case

Healthcare. The demo simulates a fictional regional health system, **Cascade Regional Health**, running a seasonal flu-vaccination awareness campaign. It shows how a single authored article can be transcreated and reformatted into multiple channel-specific social posts and translated into additional languages, while meeting healthcare guardrails (brand voice, required disclaimers, no unsupported claims).

## Contentstack Capabilities Used

- **Content Cloud**
  - Content modeling — a `blog_post` content type plus a `channel_variant` content type linked by a reference field.
  - Localization — `en-us` as the master locale, with `es` and `fr` locales.
  - Workflows — a governance/review gate so generated variants are held for human approval before publish.
  - Webhooks — used to trigger the agent pipeline.
- **Brand Kit** — brand voice and healthcare compliance rules supplied to the agent as grounding for transcreation.
- **Fact-Checker** — validates that claims are supported by the source content and that the required disclaimer is present.

## Personalization Approach

Out of scope for this build. Personalization / real-time decisioning belongs to the "Agentic Journeys" track; our submission targets the Composable Agents track. We note it as a future roadmap item rather than part of the delivered demo.

## Third-party & Partner Integrations

- **Vercel** — the orchestrator is a Next.js application deployed on Vercel. Deep reasoning (transcreation and fact-checking) runs through the Vercel AI SDK, routed via the Vercel AI Gateway for provider failover and keyless OIDC authentication on Vercel.
- **Vercel eve** (durable backend-agent framework) — documented stretch/roadmap to own the deep-reasoning workload.
- **Slack** (channel distribution) — deferred to roadmap.

## Data Approach

Mock / simulated data — a fictional brand (Cascade Regional Health) and fictional content.

## New-build Confirmation

Yes.

## Demo Plan

A recorded demo (live-capable), backend- and Contentstack-centric with no customer-facing site. Flow: an author submits a blog post; the agent generates three channel variants (LinkedIn, X, Instagram) as Contentstack `channel_variant` entries, localized to `es` and `fr`, fact-checked against the source, and held in a review workflow for human approval. A minimal internal `/preview` page renders channel-accurate cards for judging.

Current status: the pipeline is working end-to-end against a live stack — content models created, the blog post seeded, and three localized `channel_variant` entries generated and verified.

## TSO Support Needed

No.

## Anything Else Needed from Contentstack

Nothing blocking. Optionally, guidance on Agent OS / MCP would help inform the hybrid roadmap (moving deep reasoning to a durable backend-agent framework).

## Consent & Deadline Acknowledgement

Yes. We consent to featuring the solution on a branded solution page and in post-event promotion if selected, and to being contacted about Marketplace publishing and co-marketing after the event. We acknowledge the submission deadline of 31 July 2026.
