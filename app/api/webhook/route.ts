/**
 * Contentstack webhook receiver + pipeline orchestrator.
 *
 * Fires when a Blog Post transitions to the "Ready for Distribution" workflow stage.
 * Flow:
 *   1. verify the shared-secret header,
 *   2. parse the Contentstack entry payload,
 *   3. load the Blog Post + Brand Kit grounding,
 *   4. transcreate × {linkedin,x,instagram} × {en,es,fr},
 *   5. fact-check each variant (claims supported? disclaimer present?),
 *   6. write Channel Variant entries (+ es/fr locales) via the Management API,
 *   7. move the Blog Post to "Needs Review" (human gate → Slack push happens on approval).
 *
 * Designed to typecheck/build without live creds; real work is guarded by config checks.
 */

import { NextResponse } from "next/server";

import { transcreateAll, buildTargetMatrix } from "@/lib/agent";
import { applyFactCheck, factCheckVariant } from "@/lib/factcheck";
import {
  getBlogPost,
  isContentstackConfigured,
  persistChannelAcrossLocales,
  setBlogWorkflowStage,
} from "@/lib/contentstack";
import { CHANNELS, type BlogPost, type Channel, type ChannelVariant } from "@/lib/types";

// The pipeline calls external providers; give it room and keep it on Node.
export const runtime = "nodejs";
export const maxDuration = 300;

/** Minimal shape of the Contentstack webhook payload we rely on. */
interface ContentstackWebhookPayload {
  event?: string;
  data?: {
    entry?: { uid?: string; locale?: string; title?: string };
    content_type?: { uid?: string };
    workflow?: { workflow_stage?: { name?: string } };
  };
}

function verifySecret(req: Request): boolean {
  const expected = process.env.CONTENTSTACK_WEBHOOK_SECRET;
  // If no secret configured (local dev), don't hard-block — but log intent.
  if (!expected) {
    console.warn("[webhook] CONTENTSTACK_WEBHOOK_SECRET not set; skipping verification.");
    return true;
  }
  // Contentstack sends custom headers you configure on the webhook.
  // TODO: match the exact header name you set in the Contentstack webhook UI.
  const provided =
    req.headers.get("x-contentstack-webhook-secret") ??
    req.headers.get("cs-webhook-secret") ??
    "";
  return provided === expected;
}

export async function POST(req: Request) {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: "invalid webhook secret" }, { status: 401 });
  }

  let payload: ContentstackWebhookPayload;
  try {
    payload = (await req.json()) as ContentstackWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const entryUid = payload.data?.entry?.uid;
  const stageName = payload.data?.workflow?.workflow_stage?.name;

  if (!entryUid) {
    return NextResponse.json({ error: "missing entry uid" }, { status: 400 });
  }

  // Only act on the trigger stage; ignore other workflow events.
  if (stageName && stageName !== "Ready for Distribution") {
    return NextResponse.json({ skipped: true, reason: `stage "${stageName}" is not a trigger` });
  }

  // Without live creds we can't read the entry — acknowledge so CS marks it delivered.
  if (!isContentstackConfigured()) {
    console.warn("[webhook] Contentstack not configured; acknowledging without processing.");
    return NextResponse.json({
      accepted: true,
      processed: false,
      reason: "Contentstack credentials not configured (stub mode).",
      plannedTargets: buildTargetMatrix(),
    });
  }

  try {
    const result = await runPipeline(entryUid);
    return NextResponse.json({ accepted: true, processed: true, ...result });
  } catch (err) {
    console.error("[webhook] pipeline error", err);
    return NextResponse.json(
      { accepted: true, processed: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * The orchestration itself, factored out so it can be unit-tested / reused.
 * Slack is intentionally NOT called here — that fires only on human approval.
 */
async function runPipeline(entryUid: string) {
  const source: BlogPost = await getBlogPost(entryUid, "en");

  // 1. Transcreate the full channel × locale matrix.
  const generated: ChannelVariant[] = await transcreateAll(source);

  // 2. Fact-check every variant; failures are auto-flagged.
  const reviewed: ChannelVariant[] = [];
  for (const variant of generated) {
    const result = await factCheckVariant(source, variant);
    reviewed.push(applyFactCheck(variant, result));
  }

  // 3. Write back to Contentstack, one master entry per channel across en/es/fr.
  const writtenEntryUids: Record<string, string> = {};
  for (const channel of CHANNELS as readonly Channel[]) {
    const channelVariants = reviewed.filter((v) => v.channel === channel);
    if (channelVariants.length === 0) continue;
    writtenEntryUids[channel] = await persistChannelAcrossLocales(channelVariants);
  }

  // 4. Move the source Blog Post into the human review gate.
  // TODO: replace "needs_review_stage_uid" with the real workflow-stage uid from your stack.
  await setBlogWorkflowStage(entryUid, "needs_review_stage_uid", "Needs Review", "en");

  const flagged = reviewed.filter((v) => v.status === "flagged");
  return {
    sourceUid: entryUid,
    variantCount: reviewed.length,
    flaggedCount: flagged.length,
    writtenEntryUids,
    flagged: flagged.map((v) => ({
      channel: v.channel,
      locale: v.locale,
      reasons: v.factCheck?.reasons ?? [],
    })),
  };
}
