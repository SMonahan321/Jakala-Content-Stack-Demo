/**
 * Deep-reasoning seam.
 *
 * This module is the single boundary between our orchestrator (webhook, Contentstack
 * read/write, workflow gating, Slack push, preview) and the "deep reasoning" work:
 *   - TRANSCREATION  — channel/locale tone adaptation of a source blog post.
 *   - FACT-CHECK      — claim-support + prohibited-claim analysis of a variant.
 *
 * Per the design directive, that reasoning is owned by **Vercel eve** (Vercel's
 * durable backend-agent framework, https://eve.dev). Because eve agents are a
 * *separately deployed* app (a directory of files compiled to Vercel Functions and
 * invoked over an HTTP/Slack channel), they are not an in-process library you can
 * `import` and call synchronously. We therefore model eve as an external reasoning
 * service reachable over HTTP, behind the `ReasoningService` interface below.
 *
 * Two implementations are provided and selected via `REASONING_PROVIDER`:
 *   - `aisdk` (DEFAULT) — runs the reasoning in-process with the Vercel AI SDK
 *     using AI Gateway model strings (e.g. "openai/gpt-4o"). Safe to build and run; this is the working fallback.
 *   - `eve`             — a thin HTTP client that triggers a deployed eve agent. The
 *     exact request/response envelope is a TODO because it depends on how the eve
 *     agent's HTTP channel is authored (see notes on `EveReasoningService`).
 *
 * Keeping both behind one interface means Eve can back the reasoning without any
 * change to `agent.ts`, `factcheck.ts`, or the webhook pipeline.
 */

import { generateObject } from "ai";
import { z } from "zod";

import { BRAND_KIT, requiredDisclaimer } from "./brandkit";
import type { BlogPost, Locale, ChannelVariant, Target } from "./types";

/* ── Reasoning contracts ─────────────────────────────────────────────────── */

/** Input for a single (channel, locale) transcreation task. */
export interface TranscreateInput {
  source: BlogPost;
  target: Target;
}

/** Structured transcreation output (before it is shaped into a `ChannelVariant`). */
export interface TranscreateResult {
  /** Channel- and locale-appropriate copy, including the required disclaimer. */
  formattedText: string;
  /** Hashtags WITHOUT the leading `#`. */
  hashtags: string[];
}

/** Input for a single variant fact-check task. */
export interface FactCheckInput {
  source: BlogPost;
  variant: ChannelVariant;
}

/**
 * Raw reasoning output of the fact-check. The deterministic disclaimer backstop and
 * pass/flag gating live in `factcheck.ts` (our app owns governance, not the model).
 */
export interface FactCheckReasoning {
  /** Medical/statistical claims in the variant NOT supported by the source blog. */
  unsupportedClaims: string[];
  /** Prohibited claims (from the brand rules) that appear in the variant. */
  prohibitedClaimsFound: string[];
  /** Short explanation of the assessment. */
  reasoning: string;
}

/** The deep-reasoning service contract that Eve (or the AI SDK) implements. */
export interface ReasoningService {
  /** Identifier for logs/observability, e.g. "eve" or "aisdk". */
  readonly name: string;
  transcreate(input: TranscreateInput): Promise<TranscreateResult>;
  factCheck(input: FactCheckInput): Promise<FactCheckReasoning>;
}

/* ── Shared reasoning schemas + prompt construction (used by the AI SDK path) ─ */

const variantSchema = z.object({
  formattedText: z
    .string()
    .describe("The channel- and locale-appropriate post copy, including the required disclaimer."),
  hashtags: z.array(z.string()).describe("Relevant hashtags WITHOUT the leading # symbol."),
});

const factCheckSchema = z.object({
  unsupportedClaims: z
    .array(z.string())
    .describe("Medical/statistical claims in the variant NOT supported by the source blog."),
  prohibitedClaimsFound: z
    .array(z.string())
    .describe("Any prohibited claims (from the brand rules) that appear in the variant."),
  reasoning: z.string().describe("Short explanation of the assessment."),
});

const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Spanish (es)",
  fr: "French (fr)",
};

function buildTranscreatePrompt(
  source: BlogPost,
  target: Target,
): { system: string; prompt: string } {
  const style = BRAND_KIT.channelStyle[target.channel];
  const disclaimer = requiredDisclaimer(target.locale);

  const system = [
    `You are the content-distribution agent for ${BRAND_KIT.brandName}, a health system.`,
    `Brand tone: ${BRAND_KIT.voice.tone}`,
    `Personality: ${BRAND_KIT.voice.personality.join(", ")}.`,
    `DO: ${BRAND_KIT.voice.dos.join(" ")}`,
    `DON'T: ${BRAND_KIT.voice.donts.join(" ")}`,
    ``,
    `COMPLIANCE (hard rules):`,
    ...BRAND_KIT.compliance.claimGuidance.map((g) => `- ${g}`),
    `- Never make these claims: ${BRAND_KIT.compliance.prohibitedClaims.join(" | ")}`,
    ``,
    `You TRANSCREATE: adapt the message, tone, idioms and CTA to the target language and`,
    `culture. Do NOT translate literally. Never introduce medical facts absent from the source.`,
  ].join("\n");

  const prompt = [
    `SOURCE BLOG POST (authored in English):`,
    `Title: ${source.title}`,
    source.summary ? `Summary: ${source.summary}` : ``,
    `Body:\n${source.body}`,
    ``,
    `TARGET CHANNEL: ${target.channel}`,
    `Channel style: ${style.notes}`,
    `Max characters: ${style.maxChars}. Hashtags: between ${style.hashtagCount[0]} and ${style.hashtagCount[1]}.`,
    ``,
    `TARGET LOCALE: ${LOCALE_NAMES[target.locale]}`,
    `Write ALL copy in ${LOCALE_NAMES[target.locale]}.`,
    `You MUST include this exact required disclaimer (or a faithful equivalent) in the copy:`,
    `"${disclaimer}"`,
    ``,
    `Return the post copy and hashtags (hashtags without the leading #).`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

function buildFactCheckPrompt(
  source: BlogPost,
  variant: ChannelVariant,
): { system: string; prompt: string } {
  const system = [
    `You are a healthcare compliance fact-checker for ${BRAND_KIT.brandName}.`,
    `You compare a generated social post against its SOURCE blog post.`,
    `Flag any medical or statistical claim in the post that is not explicitly supported by the source.`,
    `Also flag any of these prohibited claims if present: ${BRAND_KIT.compliance.prohibitedClaims.join(" | ")}`,
    `Be strict: invented efficacy numbers, study citations, or guarantees are unsupported.`,
  ].join("\n");

  const prompt = [
    `SOURCE BLOG POST:`,
    `Title: ${source.title}`,
    `Body:\n${source.body}`,
    source.keyClaims?.length ? `Author-declared supported claims: ${source.keyClaims.join("; ")}` : ``,
    ``,
    `GENERATED POST (${variant.channel} / ${variant.locale}):`,
    variant.formattedText,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

function resolveModel() {
  // Provider-agnostic by design: swap this line to change providers via AI Gateway.
  // e.g. "anthropic/claude-sonnet-4" or "openai/gpt-4o".
  const modelId = process.env.AI_MODEL || "openai/gpt-4o";
  return modelId;
}

/* ── AI SDK implementation (the in-process fallback + default) ────────────── */

/**
 * Runs the deep reasoning in-process via the Vercel AI SDK with AI Gateway model strings.
 * Requires a provider key (e.g. `OPENAI_API_KEY`) at RUNTIME only — the project still
 * builds/typechecks without it because reasoning is only invoked from the webhook pipeline.
 */
export class AiSdkReasoningService implements ReasoningService {
  readonly name = "aisdk";

  async transcreate({ source, target }: TranscreateInput): Promise<TranscreateResult> {
    const { system, prompt } = buildTranscreatePrompt(source, target);
    const { object } = await generateObject({
      model: resolveModel(),
      schema: variantSchema,
      schemaName: "ChannelVariant",
      schemaDescription: "A single social post transcreated for one channel and locale.",
      system,
      prompt,
    });
    return {
      formattedText: object.formattedText,
      hashtags: object.hashtags.map((h) => h.replace(/^#/, "")),
    };
  }

  async factCheck({ source, variant }: FactCheckInput): Promise<FactCheckReasoning> {
    const { system, prompt } = buildFactCheckPrompt(source, variant);
    const { object } = await generateObject({
      model: resolveModel(),
      schema: factCheckSchema,
      schemaName: "FactCheck",
      schemaDescription: "Assessment of whether a social variant is supported by its source.",
      system,
      prompt,
    });
    return {
      unsupportedClaims: object.unsupportedClaims,
      prohibitedClaimsFound: object.prohibitedClaimsFound,
      reasoning: object.reasoning,
    };
  }
}

/* ── Vercel eve implementation (external durable agent over HTTP) ──────────── */

interface EveConfig {
  /** Base URL of the deployed eve agent's HTTP channel (see `EVE_AGENT_URL`). */
  agentUrl: string;
  /** Shared secret sent as `Authorization: Bearer …` (see `EVE_TRIGGER_SECRET`). */
  triggerSecret?: string;
}

/**
 * Triggers a deployed Vercel eve agent to perform the reasoning and return structured
 * output. eve owns the durable run, model routing (via AI Gateway), and observability;
 * our app just hands it a task and consumes the result.
 *
 * ── TODO (integration seam) ────────────────────────────────────────────────
 * The request/response envelope below is an ASSUMPTION. eve agents are authored as a
 * directory of files and exposed via a channel; a synchronous "reason → structured
 * JSON" endpoint is NOT a documented drop-in (eve sessions are durable/async and the
 * reference agent writes back to the CMS + Slack from its own tools). To wire this up
 * concretely you must:
 *   1. Author an eve agent (`agent/agent.ts`, `agent/instructions.md`, tools) that
 *      accepts a `{ task, input }` payload and returns `{ result }` from an HTTP
 *      channel (see `agent/channels/*.ts`), and deploy it (`npx eve deploy`).
 *   2. Authenticate the trigger — the reference agent's channel accepts
 *      `Authorization: Bearer ${EVE_TRIGGER_SECRET}` (plus localDev/vercelOidc).
 *   3. Adapt the parsing below to eve's actual session/turn response shape.
 * Until then, keep `REASONING_PROVIDER=aisdk` (the default) so everything runs.
 */
export class EveReasoningService implements ReasoningService {
  readonly name = "eve";

  constructor(private readonly config: EveConfig) {}

  transcreate(input: TranscreateInput): Promise<TranscreateResult> {
    return this.invoke<TranscreateResult>("transcreate", input);
  }

  factCheck(input: FactCheckInput): Promise<FactCheckReasoning> {
    return this.invoke<FactCheckReasoning>("factCheck", input);
  }

  private async invoke<T>(task: "transcreate" | "factCheck", input: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.triggerSecret) {
      headers.authorization = `Bearer ${this.config.triggerSecret}`;
    }

    const res = await fetch(this.config.agentUrl, {
      method: "POST",
      headers,
      // TODO: match the payload your eve agent's HTTP channel expects.
      body: JSON.stringify({ task, input }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`eve agent request failed (${res.status} ${res.statusText}): ${detail}`);
    }

    // TODO: adapt to eve's real response envelope (session/turn output).
    const data = (await res.json()) as { result?: T };
    if (data.result === undefined) {
      throw new Error("eve agent response missing `result`; adapt EveReasoningService parsing.");
    }
    return data.result;
  }
}

/* ── Factory ──────────────────────────────────────────────────────────────── */

export type ReasoningProvider = "eve" | "aisdk";

/**
 * Selects the reasoning implementation from `REASONING_PROVIDER`.
 * Defaults to `aisdk` — the in-process path that builds and runs without an eve
 * deployment. Set `REASONING_PROVIDER=eve` (plus `EVE_AGENT_URL`) to route deep
 * reasoning to a deployed Vercel eve agent.
 */
export function getReasoningService(): ReasoningService {
  const provider = (process.env.REASONING_PROVIDER ?? "aisdk").toLowerCase() as ReasoningProvider;

  if (provider === "eve") {
    const agentUrl = process.env.EVE_AGENT_URL;
    if (!agentUrl) {
      throw new Error(
        "REASONING_PROVIDER=eve but EVE_AGENT_URL is not set. Point it at your deployed eve agent.",
      );
    }
    return new EveReasoningService({
      agentUrl,
      triggerSecret: process.env.EVE_TRIGGER_SECRET,
    });
  }

  return new AiSdkReasoningService();
}
