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

import { after, NextResponse } from "next/server";

import { buildTargetMatrix } from "@/lib/agent";
import { isContentstackConfigured } from "@/lib/contentstack";
import { runPipeline } from "@/lib/pipeline";

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

  // Acknowledge with 200 (not 400) so Contentstack marks the delivery successful
  // and does NOT retry — a missing uid is unrecoverable, retrying won't help.
  if (!entryUid) {
    console.warn("[webhook] missing entry uid; acknowledging without scheduling.");
    return NextResponse.json({ accepted: true, scheduled: false, reason: "missing entry uid" });
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

  // Contentstack's webhook client times out long before the ~75s pipeline finishes,
  // which previously caused failed deliveries, retry storms (duplicate variants), and
  // eventual auto-disabling of the webhook. Respond immediately and run the pipeline
  // AFTER the response is sent (post-response work is bounded by maxDuration=300s).
  after(async () => {
    try {
      await runPipeline(entryUid);
    } catch (err) {
      console.error("[webhook] background pipeline error", err);
    }
  });

  return NextResponse.json({ accepted: true, scheduled: true, entryUid });
}
