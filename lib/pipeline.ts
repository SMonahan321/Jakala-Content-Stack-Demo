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

import { transcreateAll } from "./agent";
import { applyFactCheck, factCheckAll } from "./factcheck";
import {
  getBlogPost,
  persistChannelAcrossLocales,
  setBlogWorkflowStage,
} from "./contentstack";
import { CHANNELS, type BlogPost, type Channel, type ChannelVariant } from "./types";

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

  // 2. Transcreate the full channel × locale matrix in ONE batched Gateway call.
  const generated: ChannelVariant[] = await transcreateAll(source);

  // 3. Fact-check every variant in ONE batched Gateway call; the deterministic disclaimer
  //    backstop + pass/flag gating still run per variant. Failures are auto-flagged.
  const results = await factCheckAll(source, generated);
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
