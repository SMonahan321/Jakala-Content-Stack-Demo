/**
 * Transcreation orchestration.
 *
 * Given a source blog post + a (channel, locale) target, this produces a tone-aware
 * TRANSCREATION (not a literal translation) shaped to the channel. Transcreation is
 * non-literal but NOT lossy: every variant must preserve the source's key audience and
 * material benefits (e.g. that the content helps older/elderly community members). The
 * grounding for that preservation lives in the reasoning-seam prompts/schema (`lib/eve.ts`).
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
  type Locale,
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

/** Optional spacing between provider calls to stay under free-tier rate limits. */
const THROTTLE_MS = Number(process.env.AI_THROTTLE_MS ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Transcreate ONE channel into ALL locales in a single reasoning call, then shape each
 * locale into a `ChannelVariant`. Batching collapses the per-locale fan-out (3 → 1
 * Gateway call per channel), which is what keeps the pipeline under the webhook timeout.
 *
 * NOTE: the deep reasoning requires a configured provider at runtime (AI provider key
 * for `aisdk`, or a reachable eve agent for `eve`). It is only invoked from the webhook
 * pipeline, so the project still builds/typechecks without any credentials.
 */
export async function transcreateChannelVariants(
  source: BlogPost,
  channel: Channel,
  locales: readonly Locale[] = LOCALES,
): Promise<ChannelVariant[]> {
  const reasoning = getReasoningService();
  const { byLocale } = await reasoning.transcreateChannel({ source, channel, locales });
  const variants: ChannelVariant[] = [];
  for (const locale of locales) {
    const draft = byLocale[locale];
    if (!draft) {
      throw new Error(
        `Transcreation for channel "${channel}" is missing locale "${locale}" in the batched response.`,
      );
    }
    variants.push(draftToVariant(source, { channel, locale }, draft));
  }
  return variants;
}

/**
 * Transcreate the full channel × locale matrix in a SINGLE batched Gateway call
 * (1 call instead of 9). Collapsing the whole matrix into one request is what keeps the
 * webhook comfortably under `maxDuration = 300`s on the rate-limited free tier: the fewer
 * requests we make, the less the free-tier limiter can stall the run with backoff.
 *
 * NOTE: the deep reasoning requires a configured provider at runtime; it is only invoked
 * from the pipeline, so the project still builds/typechecks without any credentials.
 */
export async function transcreateAll(source: BlogPost): Promise<ChannelVariant[]> {
  const reasoning = getReasoningService();
  const channels = CHANNELS as readonly Channel[];
  const { byChannel } = await reasoning.transcreateMatrix({ source, channels, locales: LOCALES });

  const variants: ChannelVariant[] = [];
  for (const channel of channels) {
    const byLocale = byChannel[channel] ?? {};
    for (const locale of LOCALES) {
      const draft = byLocale[locale];
      if (!draft) {
        throw new Error(
          `Transcreation matrix is missing channel "${channel}" locale "${locale}" in the batched response.`,
        );
      }
      variants.push(draftToVariant(source, { channel, locale }, draft));
    }
  }
  if (THROTTLE_MS > 0) await sleep(THROTTLE_MS);
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
