/**
 * Transcreation orchestration.
 *
 * Given a source blog post + a (channel, locale) target, this produces a tone-aware
 * TRANSCREATION (not a literal translation) shaped to the channel.
 *
 * The DEEP REASONING (channel/locale tone adaptation) is delegated to the reasoning
 * seam in `lib/eve.ts` — owned by Vercel eve when `REASONING_PROVIDER=eve`, or run
 * in-process via the Vercel AI SDK otherwise. This file keeps the orchestrator-owned
 * concerns: the channel × locale fan-out matrix, crop specs, and `ChannelVariant`
 * shaping.
 */

import { getReasoningService, type TranscreateResult } from "./eve";
import {
  CHANNELS,
  LOCALES,
  type BlogPost,
  type Channel,
  type ChannelVariant,
  type ImageCropSpec,
  type Target,
} from "./types";

/** Default channel-accurate crop specs (mock — describes intent, no pixels pushed). */
const CROP_SPECS: Record<Channel, ImageCropSpec> = {
  linkedin: { aspectRatio: "1200x627", width: 1200, height: 627, note: "Link/share landscape card" },
  x: { aspectRatio: "1200x675", width: 1200, height: 675, note: "16:9 in-feed image" },
  instagram: { aspectRatio: "1080x1350", width: 1080, height: 1350, note: "4:5 portrait feed post" },
};

/** The full fan-out matrix: every channel × every locale. */
export function buildTargetMatrix(): Target[] {
  const targets: Target[] = [];
  for (const channel of CHANNELS) {
    for (const locale of LOCALES) {
      targets.push({ channel, locale });
    }
  }
  return targets;
}

/**
 * Transcreate the source blog into a single (channel, locale) variant.
 *
 * NOTE: the deep reasoning requires a configured provider at runtime (AI provider key
 * for `aisdk`, or a reachable eve agent for `eve`). It is only invoked from the webhook
 * pipeline, so the project still builds/typechecks without any credentials.
 */
export async function transcreateVariant(
  source: BlogPost,
  target: Target,
): Promise<ChannelVariant> {
  const reasoning = getReasoningService();
  const draft = await reasoning.transcreate({ source, target });
  return draftToVariant(source, target, draft);
}

/** Optional spacing between provider calls to stay under free-tier rate limits. */
const THROTTLE_MS = Number(process.env.AI_THROTTLE_MS ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transcreate the full channel × locale matrix. */
export async function transcreateAll(source: BlogPost): Promise<ChannelVariant[]> {
  const targets = buildTargetMatrix();
  // Sequential keeps demo logs readable and avoids provider rate limits; swap to
  // Promise.all for speed once quotas are confirmed.
  const variants: ChannelVariant[] = [];
  for (const target of targets) {
    variants.push(await transcreateVariant(source, target));
    if (THROTTLE_MS > 0) await sleep(THROTTLE_MS);
  }
  return variants;
}

function draftToVariant(
  source: BlogPost,
  target: Target,
  draft: TranscreateResult,
): ChannelVariant {
  return {
    channel: target.channel,
    locale: target.locale,
    formattedText: draft.formattedText,
    hashtags: draft.hashtags.map((h) => h.replace(/^#/, "")),
    charCount: draft.formattedText.length,
    imageCropSpec: CROP_SPECS[target.channel],
    status: "generated",
    sourceBlogUid: source.uid,
  };
}
