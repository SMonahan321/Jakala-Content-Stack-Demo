/**
 * CLI runner for the write-back pipeline.
 *
 * Takes a Blog Post entry uid (CLI arg or `BLOG_ENTRY_UID` env) and runs the SAME
 * `runPipeline` used by the webhook route (`lib/pipeline.ts`): read the blog →
 * transcreate {linkedin,x,instagram} × {en,es,fr} via the reasoning seam (AI Gateway)
 * → fact-check → create Channel Variant entries in the master locale and localize into
 * es/fr → move the Blog Post into the review state. Slack stays a no-op.
 *
 * Usage:  npm run run:pipeline -- <blogEntryUid>
 *         BLOG_ENTRY_UID=<uid> npm run run:pipeline
 * Env:    Loaded from `.env.local` then `.env` (Next.js precedence). Needs Contentstack
 *         creds + an AI Gateway key (REASONING_PROVIDER=aisdk) to run for real.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(repoRoot, ".env.local"), quiet: true });
loadEnv({ path: join(repoRoot, ".env"), quiet: true });

import { isContentstackConfigured } from "../lib/contentstack";
import { runPipeline } from "../lib/pipeline";

function resolveEntryUid(): string {
  const argUid = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const uid = argUid || process.env.BLOG_ENTRY_UID;
  if (!uid) {
    console.error(
      "\nMissing Blog Post entry uid.\n" +
        "Usage: npm run run:pipeline -- <blogEntryUid>\n" +
        "   or: BLOG_ENTRY_UID=<uid> npm run run:pipeline\n",
    );
    process.exit(1);
  }
  return uid;
}

/** Trim long copy for readable console samples. */
function sample(text: string, max = 220): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

async function main(): Promise<void> {
  if (!isContentstackConfigured()) {
    console.error("\nContentstack is not configured. Set CONTENTSTACK_API_KEY + CONTENTSTACK_MANAGEMENT_TOKEN.\n");
    process.exit(1);
  }

  const entryUid = resolveEntryUid();
  console.log(`[pipeline] source Blog Post uid: ${entryUid}`);
  console.log(`[pipeline] provider: ${process.env.REASONING_PROVIDER ?? "aisdk"} model: ${process.env.AI_MODEL ?? "openai/gpt-4o"}`);
  console.log(`[pipeline] running transcreation × fact-check × write-back …\n`);

  const result = await runPipeline(entryUid);

  console.log(`\n[pipeline] ── result ─────────────────────────────────────────`);
  console.log(`[pipeline] variants generated: ${result.variantCount}`);
  console.log(`[pipeline] flagged by fact-check: ${result.flaggedCount}`);
  console.log(`[pipeline] channel master entries created:`);
  for (const [channel, uid] of Object.entries(result.writtenEntryUids)) {
    console.log(`[pipeline]   ${channel}: ${uid}`);
  }
  console.log(
    `[pipeline] workflow move: ${result.workflow.moved ? "moved to Needs Review" : `skipped (${result.workflow.reason})`}`,
  );

  console.log(`\n[pipeline] ── generated copy sample (per channel × locale) ───`);
  for (const v of result.variants) {
    console.log(
      `\n[${v.channel} / ${v.locale}] status=${v.status} chars=${v.charCount} hashtags=${v.hashtags.join(", ")}`,
    );
    console.log(`  ${sample(v.formattedText)}`);
  }

  if (result.flagged.length) {
    console.log(`\n[pipeline] flagged details:`);
    for (const f of result.flagged) {
      console.log(`  [${f.channel}/${f.locale}] ${f.reasons.join(" | ")}`);
    }
  }

  console.log(`\n[pipeline] done.`);
}

main().catch((err) => {
  console.error("[pipeline] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
