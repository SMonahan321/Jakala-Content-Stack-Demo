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
 *     (`ai`), routing the model through **Vercel AI Gateway** via the `provider/model`
 *     string form. Safe to build and run; this is the working fallback.
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
import type { BlogPost, Channel, Locale, ChannelVariant } from "./types";

/* ── Reasoning contracts ─────────────────────────────────────────────────── */

/**
 * Structured transcreation output for a SINGLE locale (before it is shaped into a
 * `ChannelVariant`). The batched calls below return one of these per locale.
 */
export interface TranscreateResult {
  /** Channel- and locale-appropriate copy, including the required disclaimer. */
  formattedText: string;
  /** Hashtags WITHOUT the leading `#`. */
  hashtags: string[];
}

/**
 * Raw reasoning output of the fact-check for a SINGLE locale. The deterministic
 * disclaimer backstop and pass/flag gating live in `factcheck.ts` (our app owns
 * governance, not the model).
 */
export interface FactCheckReasoning {
  /** Medical/statistical claims in the variant NOT supported by the source blog. */
  unsupportedClaims: string[];
  /** Prohibited claims (from the brand rules) that appear in the variant. */
  prohibitedClaimsFound: string[];
  /** Short explanation of the assessment. */
  reasoning: string;
}

/**
 * Input for a BATCHED transcreation task: one channel, all requested locales, in a
 * single reasoning call. Batching collapses the per-locale fan-out (3 calls → 1) so
 * the pipeline fits under the webhook's `maxDuration` even on rate-limited free tiers.
 */
export interface TranscreateChannelInput {
  source: BlogPost;
  channel: Channel;
  locales: readonly Locale[];
}

/** Batched transcreation output: one `TranscreateResult` per locale, keyed by code. */
export interface TranscreateChannelResult {
  byLocale: Partial<Record<Locale, TranscreateResult>>;
}

/**
 * Input for a BATCHED fact-check task: all locale variants of ONE channel checked in a
 * single reasoning call. `variants` share a channel and differ only by locale.
 */
export interface FactCheckChannelInput {
  source: BlogPost;
  variants: ChannelVariant[];
}

/** Batched fact-check output: one `FactCheckReasoning` per locale, keyed by code. */
export interface FactCheckChannelResult {
  byLocale: Partial<Record<Locale, FactCheckReasoning>>;
}

/**
 * Input for a WHOLE-MATRIX transcreation task: every channel × every locale produced in
 * a SINGLE reasoning call. This is the most aggressive batching (9 → 1 call) and is what
 * the pipeline uses so it fits comfortably under the webhook timeout even when the
 * free-tier Gateway rate-limits the first request hard.
 */
export interface TranscreateMatrixInput {
  source: BlogPost;
  channels: readonly Channel[];
  locales: readonly Locale[];
}

/** Whole-matrix transcreation output: channel → locale → per-locale result. */
export interface TranscreateMatrixResult {
  byChannel: Partial<Record<Channel, Partial<Record<Locale, TranscreateResult>>>>;
}

/** Input for a WHOLE-MATRIX fact-check: all variants (any channel/locale) in one call. */
export interface FactCheckMatrixInput {
  source: BlogPost;
  variants: ChannelVariant[];
}

/** Whole-matrix fact-check output: channel → locale → per-locale reasoning. */
export interface FactCheckMatrixResult {
  byChannel: Partial<Record<Channel, Partial<Record<Locale, FactCheckReasoning>>>>;
}

/**
 * The deep-reasoning service contract that Eve (or the AI SDK) implements.
 *
 * All methods are BATCHED to minimize Vercel AI Gateway calls (the free tier
 * rate-limits hard, and each extra call risks blowing the webhook's `maxDuration`):
 *   - `transcreateChannel` / `factCheckChannel` — one call per channel (all locales),
 *     i.e. the full matrix in ~6 calls. Useful for finer-grained callers.
 *   - `transcreateMatrix` / `factCheckMatrix` — the ENTIRE channel × locale matrix in a
 *     SINGLE call each (~2 calls total). This is what the pipeline uses to stay well
 *     under 300s. Both paths share the same per-locale schemas/quality.
 */
export interface ReasoningService {
  /** Identifier for logs/observability, e.g. "eve" or "aisdk". */
  readonly name: string;
  /** Transcreate ONE channel into ALL requested locales in a single call. */
  transcreateChannel(input: TranscreateChannelInput): Promise<TranscreateChannelResult>;
  /** Fact-check ALL locale variants of ONE channel in a single call. */
  factCheckChannel(input: FactCheckChannelInput): Promise<FactCheckChannelResult>;
  /** Transcreate the ENTIRE channel × locale matrix in a SINGLE call. */
  transcreateMatrix(input: TranscreateMatrixInput): Promise<TranscreateMatrixResult>;
  /** Fact-check the ENTIRE set of variants (all channels/locales) in a SINGLE call. */
  factCheckMatrix(input: FactCheckMatrixInput): Promise<FactCheckMatrixResult>;
}

/* ── Shared reasoning schemas + prompt construction (used by the AI SDK path) ─ */

const variantSchema = z.object({
  formattedText: z
    .string()
    .describe(
      "The channel- and locale-appropriate post copy. MUST include the required disclaimer AND " +
        "must preserve the source's key audience and material benefits — in particular, if the " +
        "source says the content helps older/elderly community members (seniors, older adults, " +
        "grandparents), the copy must clearly convey that benefit, adapted in tone and within the " +
        "character limit. Do not drop who it helps.",
    ),
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

/**
 * Build a batched schema whose top-level keys are locale codes, each mapping to the
 * per-locale schema (`variantSchema` or `factCheckSchema`). This lets ONE structured
 * response carry all locales for a channel while keeping each locale's fields intact.
 */
function byLocaleSchema<T extends z.ZodTypeAny>(
  element: T,
  locales: readonly Locale[],
  description: (locale: Locale) => string,
): z.ZodObject<Record<Locale, T>> {
  const shape = Object.fromEntries(
    locales.map((l) => [l, element.describe(description(l))]),
  ) as Record<Locale, T>;
  return z.object(shape);
}

/**
 * Build a nested batched schema: channel code → locale code → per-locale schema. Lets a
 * SINGLE structured response carry the whole channel × locale matrix while keeping each
 * cell's fields intact.
 */
function byChannelLocaleSchema<T extends z.ZodTypeAny>(
  element: T,
  channels: readonly Channel[],
  locales: readonly Locale[],
  description: (channel: Channel, locale: Locale) => string,
): z.ZodObject<Record<Channel, z.ZodObject<Record<Locale, T>>>> {
  const shape = Object.fromEntries(
    channels.map((c) => {
      const localeShape = Object.fromEntries(
        locales.map((l) => [l, element.describe(description(c, l))]),
      ) as Record<Locale, T>;
      return [c, z.object(localeShape).describe(`All locales for the "${c}" channel.`)];
    }),
  ) as Record<Channel, z.ZodObject<Record<Locale, T>>>;
  return z.object(shape);
}

const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Spanish (es)",
  fr: "French (fr)",
};

/** Shared brand/compliance grounding for the transcreation system prompt. */
function transcreateSystemPrompt(): string {
  return [
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
    `PRESERVE THE SOURCE'S MEANING (hard rules — transcreation is non-literal, NOT lossy):`,
    `- Keep the source's KEY AUDIENCE and MATERIAL BENEFITS. Never drop WHO the content helps or`,
    `  the concrete benefit they get. Adapting tone/idioms/CTA is encouraged; dropping substance is not.`,
    `- In particular, if the source says the content helps older or elderly members of the community`,
    `  (older adults, seniors, grandparents, higher-risk elders), EVERY variant MUST clearly convey`,
    `  that it helps older/elderly community members — phrased naturally for the channel and locale`,
    `  and kept within the character limit. Do not paraphrase this benefit away.`,
    ``,
    `You TRANSCREATE: adapt the message, tone, idioms and CTA to each target language and`,
    `culture. Do NOT translate literally. Never introduce medical facts absent from the source.`,
  ].join("\n");
}

/**
 * Prompt for a BATCHED transcreation: one channel, all requested locales in a single
 * response. Each locale is transcreated independently (tone/culture-adapted, disclaimer
 * included) — quality-equivalent to the old per-locale calls, but in one Gateway round-trip.
 */
function buildChannelTranscreatePrompt(
  source: BlogPost,
  channel: Channel,
  locales: readonly Locale[],
): { system: string; prompt: string } {
  const style = BRAND_KIT.channelStyle[channel];

  const localeBlocks = locales
    .map((locale) =>
      [
        `- "${locale}" (${LOCALE_NAMES[locale]}): write ALL copy in ${LOCALE_NAMES[locale]}, tone- and`,
        `  culture-adapted for this locale (NOT a literal translation of another locale). You MUST`,
        `  include this exact required disclaimer (or a faithful equivalent): "${requiredDisclaimer(locale)}"`,
      ].join("\n"),
    )
    .join("\n");

  const prompt = [
    `SOURCE BLOG POST (authored in English):`,
    `Title: ${source.title}`,
    source.summary ? `Summary: ${source.summary}` : ``,
    `Body:\n${source.body}`,
    ``,
    `TARGET CHANNEL: ${channel}`,
    `Channel style: ${style.notes}`,
    `Max characters: ${style.maxChars}. Hashtags: between ${style.hashtagCount[0]} and ${style.hashtagCount[1]}.`,
    ``,
    `PRESERVE the source's key audience and material benefits — most importantly, if the source`,
    `says the content helps older/elderly community members, EVERY locale's post must convey that`,
    `benefit naturally and within the character limit (transcreate it; do not drop it).`,
    ``,
    `Produce a SEPARATE, independently transcreated post for EACH of these locales:`,
    localeBlocks,
    ``,
    `Return an object with one key per locale code (${locales.join(", ")}). Each value has the`,
    `post copy and hashtags (hashtags without the leading #).`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system: transcreateSystemPrompt(), prompt };
}

/**
 * Prompt for a BATCHED fact-check: all locale variants of ONE channel assessed in a
 * single response. Each locale is assessed independently against the source blog.
 */
function buildChannelFactCheckPrompt(
  source: BlogPost,
  variants: ChannelVariant[],
): { system: string; prompt: string } {
  const channel = variants[0]?.channel;

  const system = [
    `You are a healthcare compliance fact-checker for ${BRAND_KIT.brandName}.`,
    `You compare generated social posts against their SOURCE blog post.`,
    `Flag any medical or statistical claim in a post that is not explicitly supported by the source.`,
    `Also flag any of these prohibited claims if present: ${BRAND_KIT.compliance.prohibitedClaims.join(" | ")}`,
    `Be strict: invented efficacy numbers, study citations, or guarantees are unsupported.`,
    `Assess EACH locale's post independently.`,
  ].join("\n");

  const variantBlocks = variants
    .map((v) => `--- LOCALE "${v.locale}" (${LOCALE_NAMES[v.locale]}) ---\n${v.formattedText}`)
    .join("\n\n");

  const prompt = [
    `SOURCE BLOG POST:`,
    `Title: ${source.title}`,
    `Body:\n${source.body}`,
    source.keyClaims?.length ? `Author-declared supported claims: ${source.keyClaims.join("; ")}` : ``,
    ``,
    `GENERATED POSTS for channel "${channel}", one per locale (assess each independently):`,
    ``,
    variantBlocks,
    ``,
    `Return an object with one key per locale code (${variants.map((v) => v.locale).join(", ")}).`,
    `Each value has unsupportedClaims, prohibitedClaimsFound, and reasoning for THAT locale's post.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

/**
 * Prompt for a WHOLE-MATRIX transcreation: EVERY channel × EVERY locale in one response.
 * Each cell is independently tone/culture-adapted with its locale's required disclaimer —
 * same per-cell quality as the granular calls, but in a single Gateway round-trip.
 */
function buildMatrixTranscreatePrompt(
  source: BlogPost,
  channels: readonly Channel[],
  locales: readonly Locale[],
): { system: string; prompt: string } {
  const channelBlocks = channels
    .map((channel) => {
      const style = BRAND_KIT.channelStyle[channel];
      return `- "${channel}": ${style.notes} Max characters: ${style.maxChars}. Hashtags: between ${style.hashtagCount[0]} and ${style.hashtagCount[1]}.`;
    })
    .join("\n");

  const localeBlocks = locales
    .map(
      (locale) =>
        `- "${locale}" (${LOCALE_NAMES[locale]}): write ALL copy natively in ${LOCALE_NAMES[locale]}, tone- and culture-adapted (NOT a literal translation). Include this exact required disclaimer (or a faithful equivalent): "${requiredDisclaimer(locale)}"`,
    )
    .join("\n");

  const prompt = [
    `SOURCE BLOG POST (authored in English):`,
    `Title: ${source.title}`,
    source.summary ? `Summary: ${source.summary}` : ``,
    `Body:\n${source.body}`,
    ``,
    `Produce a SEPARATE, independently transcreated post for EVERY combination of the`,
    `following channels and locales.`,
    ``,
    `PRESERVE the source's key audience and material benefits in EVERY cell — most importantly,`,
    `if the source says the content helps older/elderly community members, every channel × locale`,
    `post must convey that benefit naturally and within the character limit (transcreate it; do not`,
    `drop it).`,
    ``,
    `CHANNELS (apply each channel's style):`,
    channelBlocks,
    ``,
    `LOCALES:`,
    localeBlocks,
    ``,
    `Return an object keyed by channel code (${channels.join(", ")}). Each channel's value`,
    `is an object keyed by locale code (${locales.join(", ")}); each of those has the post`,
    `copy and hashtags (hashtags without the leading #).`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system: transcreateSystemPrompt(), prompt };
}

/**
 * Prompt for a WHOLE-MATRIX fact-check: all generated posts (every channel/locale) checked
 * in one response, each assessed independently against the source blog.
 */
function buildMatrixFactCheckPrompt(
  source: BlogPost,
  variants: ChannelVariant[],
): { system: string; prompt: string } {
  const system = [
    `You are a healthcare compliance fact-checker for ${BRAND_KIT.brandName}.`,
    `You compare generated social posts against their SOURCE blog post.`,
    `Flag any medical or statistical claim in a post that is not explicitly supported by the source.`,
    `Also flag any of these prohibited claims if present: ${BRAND_KIT.compliance.prohibitedClaims.join(" | ")}`,
    `Be strict: invented efficacy numbers, study citations, or guarantees are unsupported.`,
    `Assess EACH channel/locale post independently.`,
  ].join("\n");

  // Group posts by channel for a readable prompt.
  const channels = [...new Set(variants.map((v) => v.channel))];
  const postBlocks = channels
    .map((channel) => {
      const localeBlocks = variants
        .filter((v) => v.channel === channel)
        .map((v) => `--- LOCALE "${v.locale}" (${LOCALE_NAMES[v.locale]}) ---\n${v.formattedText}`)
        .join("\n\n");
      return `### CHANNEL "${channel}"\n${localeBlocks}`;
    })
    .join("\n\n");

  const prompt = [
    `SOURCE BLOG POST:`,
    `Title: ${source.title}`,
    `Body:\n${source.body}`,
    source.keyClaims?.length ? `Author-declared supported claims: ${source.keyClaims.join("; ")}` : ``,
    ``,
    `GENERATED POSTS (assess each channel/locale independently):`,
    ``,
    postBlocks,
    ``,
    `Return an object keyed by channel code (${channels.join(", ")}). Each channel's value is`,
    `an object keyed by locale code; each of those has unsupportedClaims,`,
    `prohibitedClaimsFound, and reasoning for THAT post.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when an error looks like a provider/gateway rate-limit (free-tier throttling). */
function isRateLimitError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return /rate.?limit|429|too many requests/i.test(msg);
}

/**
 * Run a reasoning call with rate-limit-aware retry. The AI SDK already retries a few
 * times quickly; free-tier gateway limits need LONGER, spaced-out waits, so we back off
 * up to a handful of times before giving up. Tunable via `AI_RATELIMIT_MAX_RETRIES`.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = Number(process.env.AI_RATELIMIT_MAX_RETRIES ?? 6);
  const baseDelayMs = Number(process.env.AI_RATELIMIT_BASE_MS ?? 12000);
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
      const waitMs = baseDelayMs * (attempt + 1);
      console.warn(
        `[reasoning] rate-limited; backing off ${Math.round(waitMs / 1000)}s (retry ${attempt + 1}/${maxRetries})`,
      );
      await sleep(waitMs);
      attempt++;
    }
  }
}

function resolveModel(): string {
  // Route through Vercel AI Gateway. Passing a `provider/model` string to the AI SDK
  // makes it use the built-in global gateway provider automatically (no extra package):
  // it authenticates with `AI_GATEWAY_API_KEY` locally, or Vercel OIDC when deployed.
  // Swap providers by changing the string, e.g. `anthropic/claude-sonnet-4.6`.
  return process.env.AI_MODEL || "openai/gpt-4o";
}

/* ── AI SDK implementation (the in-process fallback + default) ────────────── */

/**
 * Runs the deep reasoning in-process via the Vercel AI SDK, routing the model through
 * **Vercel AI Gateway** (the `provider/model` string form). Requires credentials at
 * RUNTIME only — `AI_GATEWAY_API_KEY` for local/non-Vercel runs, or automatic OIDC when
 * deployed on Vercel (no key needed there). The Gateway also gives provider failover.
 * The project still builds/typechecks without any key because reasoning is only invoked
 * from the webhook pipeline.
 */
export class AiSdkReasoningService implements ReasoningService {
  readonly name = "aisdk";

  async transcreateChannel({
    source,
    channel,
    locales,
  }: TranscreateChannelInput): Promise<TranscreateChannelResult> {
    const { system, prompt } = buildChannelTranscreatePrompt(source, channel, locales);
    const schema = byLocaleSchema(
      variantSchema,
      locales,
      (l) => `Transcreated post copy + hashtags for the "${l}" locale.`,
    );
    const { object } = await withRateLimitRetry(() =>
      generateObject({
        model: resolveModel(),
        schema,
        schemaName: "ChannelVariantsByLocale",
        schemaDescription:
          "Social posts for one channel, transcreated into each locale (one entry per locale code).",
        system,
        prompt,
      }),
    );
    const byLocale: Partial<Record<Locale, TranscreateResult>> = {};
    for (const locale of locales) {
      const draft = object[locale];
      if (!draft) continue;
      byLocale[locale] = {
        formattedText: draft.formattedText,
        hashtags: draft.hashtags.map((h) => h.replace(/^#/, "")),
      };
    }
    return { byLocale };
  }

  async factCheckChannel({
    source,
    variants,
  }: FactCheckChannelInput): Promise<FactCheckChannelResult> {
    const locales = variants.map((v) => v.locale);
    const { system, prompt } = buildChannelFactCheckPrompt(source, variants);
    const schema = byLocaleSchema(
      factCheckSchema,
      locales,
      (l) => `Fact-check assessment for the "${l}" locale's post.`,
    );
    const { object } = await withRateLimitRetry(() =>
      generateObject({
        model: resolveModel(),
        schema,
        schemaName: "FactCheckByLocale",
        schemaDescription:
          "Support assessment for one channel's posts, one entry per locale code.",
        system,
        prompt,
      }),
    );
    const byLocale: Partial<Record<Locale, FactCheckReasoning>> = {};
    for (const locale of locales) {
      const assessment = object[locale];
      if (!assessment) continue;
      byLocale[locale] = {
        unsupportedClaims: assessment.unsupportedClaims,
        prohibitedClaimsFound: assessment.prohibitedClaimsFound,
        reasoning: assessment.reasoning,
      };
    }
    return { byLocale };
  }

  async transcreateMatrix({
    source,
    channels,
    locales,
  }: TranscreateMatrixInput): Promise<TranscreateMatrixResult> {
    const { system, prompt } = buildMatrixTranscreatePrompt(source, channels, locales);
    const schema = byChannelLocaleSchema(
      variantSchema,
      channels,
      locales,
      (c, l) => `Transcreated post copy + hashtags for channel "${c}", locale "${l}".`,
    );
    const { object } = await withRateLimitRetry(() =>
      generateObject({
        model: resolveModel(),
        schema,
        schemaName: "ChannelVariantsMatrix",
        schemaDescription:
          "Social posts for every channel × locale (channel code → locale code → post).",
        system,
        prompt,
      }),
    );
    const byChannel: TranscreateMatrixResult["byChannel"] = {};
    for (const channel of channels) {
      const localeMap = object[channel];
      if (!localeMap) continue;
      const byLocale: Partial<Record<Locale, TranscreateResult>> = {};
      for (const locale of locales) {
        const draft = localeMap[locale];
        if (!draft) continue;
        byLocale[locale] = {
          formattedText: draft.formattedText,
          hashtags: draft.hashtags.map((h) => h.replace(/^#/, "")),
        };
      }
      byChannel[channel] = byLocale;
    }
    return { byChannel };
  }

  async factCheckMatrix({
    source,
    variants,
  }: FactCheckMatrixInput): Promise<FactCheckMatrixResult> {
    const channels = [...new Set(variants.map((v) => v.channel))];
    const locales = [...new Set(variants.map((v) => v.locale))];
    const { system, prompt } = buildMatrixFactCheckPrompt(source, variants);
    const schema = byChannelLocaleSchema(
      factCheckSchema,
      channels,
      locales,
      (c, l) => `Fact-check assessment for channel "${c}", locale "${l}".`,
    );
    const { object } = await withRateLimitRetry(() =>
      generateObject({
        model: resolveModel(),
        schema,
        schemaName: "FactCheckMatrix",
        schemaDescription:
          "Support assessment for every channel × locale (channel code → locale code → assessment).",
        system,
        prompt,
      }),
    );
    const byChannel: FactCheckMatrixResult["byChannel"] = {};
    for (const channel of channels) {
      const localeMap = object[channel];
      if (!localeMap) continue;
      const byLocale: Partial<Record<Locale, FactCheckReasoning>> = {};
      for (const locale of locales) {
        const assessment = localeMap[locale];
        if (!assessment) continue;
        byLocale[locale] = {
          unsupportedClaims: assessment.unsupportedClaims,
          prohibitedClaimsFound: assessment.prohibitedClaimsFound,
          reasoning: assessment.reasoning,
        };
      }
      byChannel[channel] = byLocale;
    }
    return { byChannel };
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

  // NOTE: mirrors the BATCHED `ReasoningService` contract — one call per channel covers
  // all locales. The eve agent's HTTP channel would run the same batched reasoning and
  // return a `{ byLocale }` envelope. Payload/response shapes remain a TODO (see above).
  transcreateChannel(input: TranscreateChannelInput): Promise<TranscreateChannelResult> {
    return this.invoke<TranscreateChannelResult>("transcreateChannel", input);
  }

  factCheckChannel(input: FactCheckChannelInput): Promise<FactCheckChannelResult> {
    return this.invoke<FactCheckChannelResult>("factCheckChannel", input);
  }

  transcreateMatrix(input: TranscreateMatrixInput): Promise<TranscreateMatrixResult> {
    return this.invoke<TranscreateMatrixResult>("transcreateMatrix", input);
  }

  factCheckMatrix(input: FactCheckMatrixInput): Promise<FactCheckMatrixResult> {
    return this.invoke<FactCheckMatrixResult>("factCheckMatrix", input);
  }

  private async invoke<T>(
    task:
      | "transcreateChannel"
      | "factCheckChannel"
      | "transcreateMatrix"
      | "factCheckMatrix",
    input: unknown,
  ): Promise<T> {
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
