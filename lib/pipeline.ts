/**
 * Write-back pipeline (single source of truth).
 *
 * This is the core orchestration that turns ONE source Blog Post into per-channel,
 * per-locale Channel Variant entries in Contentstack. It is deliberately decoupled
 * from any transport so it can be driven by BOTH:
 *   - the Contentstack webhook route (`app/api/webhook/route.ts`), and
 *   - the CLI runner (`scripts/run-pipeline.ts`).
 *
 * Flow:
 *   1. read the source Blog Post (+ its author-declared claims),
 *   2. transcreate × {linkedin,x,instagram} × {en(=master),es,fr} via the reasoning seam,
 *   3. fact-check each variant (claims supported? disclaimer present?),
 *   4. UPSERT one Channel Variant master entry per channel (keyed on the composite
 *      (source_blog reference, channel)) and localize it into es/fr — re-runs update
 *      the existing masters in place instead of creating duplicates,
 *   5. move the Blog Post into the human review gate (soft-skips if no workflow exists).
 *
 * Slack is intentionally NOT called here — that fires only on human approval.
 */

import { createHash } from "node:crypto";

import { transcreateAll } from "./agent";
import { applyFactCheck, factCheckAll } from "./factcheck";
import {
  getBlogPost,
  persistChannelAcrossLocales,
  setBlogWorkflowStage,
} from "./contentstack";
import {
  CHANNELS,
  type BlogPost,
  type Channel,
  type ChannelVariant,
  type FactCheckResult,
} from "./types";

/**
 * Best-effort in-process memo of the reasoning result (transcreation + fact-check), keyed by a
 * hash of the SOURCE content. On repeat publishes of an UNCHANGED post — common when a live demo
 * hits "publish" more than once — this reuses the reasoning and SKIPS BOTH Vercel AI Gateway calls,
 * so we don't re-spend the rate-limit budget. It only lives for the lifetime of a warm serverless
 * instance and self-invalidates whenever the source content (or model) changes (hash miss) or the
 * entry ages past `PIPELINE_CACHE_TTL_MS`. Deterministic governance + the CMS write still run every
 * time, so behavior is identical to a cold run — just without the redundant model calls.
 */
interface ReasoningMemoEntry {
  generated: ChannelVariant[];
  results: FactCheckResult[];
  at: number;
}
const reasoningMemo = new Map<string, ReasoningMemoEntry>();

function sourceContentHash(source: BlogPost): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: source.title,
        summary: source.summary ?? "",
        body: source.body,
        keyClaims: source.keyClaims ?? [],
        bypass: source.demoBypassCompliance ?? false,
        model: process.env.AI_MODEL ?? "openai/gpt-4o",
        channels: CHANNELS,
      }),
    )
    .digest("hex");
}

export interface PipelineResult {
  sourceUid: string;
  variantCount: number;
  flaggedCount: number;
  /** channel → created master Channel Variant entry uid. */
  writtenEntryUids: Record<string, string>;
  workflow: { moved: boolean; reason?: string };
  flagged: Array<{ channel: Channel; locale: string; reasons: string[] }>;
  /** All reviewed variants (for CLI reporting / verification). */
  variants: ChannelVariant[];
}

/**
 * Run the full write-back pipeline for a single Blog Post entry uid.
 * Returns a structured summary (used by both the webhook response and the CLI).
 */
export async function runPipeline(entryUid: string): Promise<PipelineResult> {
  // 1. Read the source Blog Post in the logical master locale ("en" → stack master).
  const source: BlogPost = await getBlogPost(entryUid, "en");

  // 2 + 3. Transcreate the full matrix (ONE batched Gateway call) then fact-check every
  //    variant (ONE batched Gateway call). On a repeat publish of an UNCHANGED source seen
  //    on this warm instance, reuse the memoized reasoning and skip BOTH Gateway calls — the
  //    single biggest no-cost safeguard against re-hitting the free-tier rate limit.
  const cacheTtlMs = Number(process.env.PIPELINE_CACHE_TTL_MS ?? 10 * 60 * 1000);
  const cacheKey = sourceContentHash(source);
  const cached = reasoningMemo.get(cacheKey);

  let generated: ChannelVariant[];
  let results: FactCheckResult[];
  if (cached && Date.now() - cached.at <= cacheTtlMs) {
    console.warn(
      "[pipeline] unchanged source; reusing cached transcreation + fact-check and skipping both Gateway calls.",
    );
    generated = cached.generated;
    results = cached.results;
  } else {
    generated = await transcreateAll(source);
    results = await factCheckAll(source, generated);
    reasoningMemo.set(cacheKey, { generated, results, at: Date.now() });
  }

  // Deterministic disclaimer backstop + pass/flag gating always run per variant.
  const reviewed: ChannelVariant[] = generated.map((variant, i) =>
    applyFactCheck(variant, results[i]),
  );

  // 4. Write back to Contentstack: UPSERT one master entry per channel across en/es/fr.
  //    Keyed on (source_blog reference, channel) so re-runs update in place (no dupes).
  const writtenEntryUids: Record<string, string> = {};
  for (const channel of CHANNELS as readonly Channel[]) {
    const channelVariants = reviewed.filter((v) => v.channel === channel);
    if (channelVariants.length === 0) continue;
    const uid = await persistChannelAcrossLocales(channelVariants);
    writtenEntryUids[channel] = uid;
    for (const v of channelVariants) v.uid = uid;
  }

  // 5. Move the source Blog Post into the human review gate (soft-skip if no workflow).
  const workflow = await setBlogWorkflowStage(entryUid, "Needs Review", "en");

  const flagged = reviewed.filter((v) => v.status === "flagged");
  return {
    sourceUid: entryUid,
    variantCount: reviewed.length,
    flaggedCount: flagged.length,
    writtenEntryUids,
    workflow,
    flagged: flagged.map((v) => ({
      channel: v.channel,
      locale: v.locale,
      reasons: v.factCheck?.reasons ?? [],
    })),
    variants: reviewed,
  };
}
