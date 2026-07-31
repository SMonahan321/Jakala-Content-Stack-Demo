/**
 * Seed a DELIBERATELY NON-COMPLIANT "bad" demo Blog Post (fictional Cascade
 * Regional Health) whose body contains a prominent, egregious, clearly-FALSE
 * medical claim stated as fact — a "detox tea" that supposedly cures diabetes.
 *
 * The point of this seed is to exercise the fact-checker end to end: the false
 * "cure" / "100% guaranteed" claim is intended to survive transcreation into the
 * per-channel variants so the fact-checker FLAGS them (unsupported / prohibited
 * claim). Because of that, the false claim lives ONLY in the `body` — it is
 * intentionally kept OUT of `key_claims`, since `key_claims` is treated by the
 * fact-checker as the author-declared, source-of-truth supported claims and
 * would otherwise suppress the flag. The disclaimer is present (via
 * `requiredDisclaimer("en")`) precisely so the flag is driven by the CLAIM, not
 * by a missing disclaimer.
 *
 * Crucially, this entry also sets `demo_bypass_compliance: true`. Without it the
 * compliance-instructed transcreator SANITIZES the false claim before the
 * fact-checker ever sees it (0 flags). The flag relaxes ONLY the
 * claim-compliance guardrails in transcreation for THIS post, so the bad claim
 * carries through verbatim and the still-strict fact-checker catches it — with
 * zero manual editing. It is isolated to this post; all real content (flag
 * absent/false) keeps full guardrails.
 *
 * Idempotent by exact title: if a Blog Post with the same title already exists it
 * is UPDATED in place (so re-running never duplicates); otherwise a new entry is
 * created. Like the Lyme / Burnout seeds, this script deliberately does NOT
 * publish — the entry is left in draft/unpublished so it can be run through the
 * pipeline manually (`npm run run:pipeline -- <uid>`).
 *
 * Usage:  npm run seed:detox
 * Env:    Loaded from `.env.local` then `.env` (Next.js precedence).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(repoRoot, ".env.local"), quiet: true });
loadEnv({ path: join(repoRoot, ".env"), quiet: true });

import { client as createClient } from "@contentstack/management";
import type { ContentstackConfig } from "@contentstack/management/types/contentstackClient";

import { requiredDisclaimer } from "../lib/brandkit";

const BLOG_POST_CONTENT_TYPE = "blog_post";

const TITLE = "Detox Tea Miracle: Cure Diabetes in 7 Days";

const SUMMARY =
  "A warm cup of herbal tea can be a soothing part of a daily wind-down routine. " +
  "Here is a friendly look at one of the herbal blends neighbors have been asking about this season.";

const BODY = [
  "Herbal teas have been enjoyed for generations, and lately our care teams across the valley have " +
    "been fielding questions about so-called detox blends. At Cascade Regional Health, we love that our " +
    "neighbors are curious about their wellness routines, so let's talk about what a comforting cup can " +
    "and cannot do.",
  // ↓↓↓ The intentional, egregious, clearly-FALSE claim stated as fact. This is the
  // hook the fact-checker is meant to catch downstream. Kept ONLY in the body.
  "This detox tea is clinically proven to completely cure type 2 diabetes in just 7 days, with a 100% " +
    "guaranteed success rate and no doctor visit needed.",
  "Beyond the buzz, a warm herbal tea can be a pleasant, low-calorie way to stay hydrated and unwind " +
    "in the evening. Many people find that swapping a sugary drink for unsweetened tea fits nicely into " +
    "a balanced routine, and the ritual of brewing a cup can feel calming after a long day.",
  "Our care teams encourage steady, sustainable habits over quick fixes: enjoy a variety of foods, " +
    "stay active in ways you like, keep up with regular check-ups, and talk with your provider before " +
    "making changes to how you manage a health condition. A tea can be a nice addition to your day — " +
    "not a replacement for care.",
  requiredDisclaimer("en"),
].join("\n\n");

// IMPORTANT: only benign, genuinely-supportable claims here. The false "cure"
// claim is intentionally NOT listed — `key_claims` is the author-declared list of
// SUPPORTED claims the fact-checker trusts, so including the cure claim would
// suppress the very flag this demo is meant to produce.
const KEY_CLAIMS = [
  "Herbal teas have been enjoyed for generations as part of daily routines.",
  "Unsweetened tea can be a low-calorie way to stay hydrated.",
  "Swapping a sugary drink for unsweetened tea can fit into a balanced routine.",
  "Steady, sustainable habits are generally preferable to quick fixes.",
  "People should talk with their provider before changing how they manage a health condition.",
];

interface RawEntry {
  uid: string;
  title?: string;
  locale?: string;
}

/** An entry handle we can mutate + update (subset of the SDK Entry). */
interface RawEntryHandle {
  uid: string;
  update(param?: { locale?: string }): Promise<unknown>;
  [key: string]: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing required env var: ${name} (see .env.example)\n`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const apiKey = requireEnv("CONTENTSTACK_API_KEY");
  const managementToken = requireEnv("CONTENTSTACK_MANAGEMENT_TOKEN");
  const region = (process.env.CONTENTSTACK_REGION ?? "na").trim().toLowerCase();

  const config: ContentstackConfig = { region };
  const stack = createClient(config).stack({ api_key: apiKey, management_token: managementToken });

  const entryFields = {
    title: TITLE,
    summary: SUMMARY,
    body: BODY,
    key_claims: KEY_CLAIMS,
    // DEMO ONLY: bypass claim-compliance in transcreation so the false "cure"/guarantee
    // claim carries through verbatim and the (still-strict) fact-checker flags it. This
    // is what lets the demo work with ZERO manual editing. Never enable on real content.
    demo_bypass_compliance: true,
  };

  // Idempotency: find an existing Blog Post with the same title and UPDATE it in
  // place; otherwise CREATE a fresh one. Either way we never publish.
  const found = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry()
    .query({ query: { title: TITLE } })
    .find()) as unknown as { items?: RawEntry[] };
  const existing = found.items?.[0];

  if (existing?.uid) {
    const entry = (await stack
      .contentType(BLOG_POST_CONTENT_TYPE)
      .entry(existing.uid)
      .fetch()) as unknown as RawEntryHandle;
    Object.assign(entry, entryFields);
    await entry.update();
    console.log(`[seed] Updated existing Detox demo Blog Post in place (title matched); left UNPUBLISHED.`);
    console.log(`[seed] title: ${TITLE}`);
    console.log(`[seed] status: UNPUBLISHED (draft)`);
    console.log(`BLOG_ENTRY_UID=${existing.uid}`);
    return;
  }

  const created = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry()
    .create({ entry: entryFields })) as unknown as RawEntry;

  console.log(`[seed] Created Detox demo Blog Post in the master locale; left UNPUBLISHED (draft).`);
  console.log(`[seed] title: ${TITLE}`);
  console.log(`[seed] status: UNPUBLISHED (draft)`);
  console.log(`BLOG_ENTRY_UID=${created.uid}`);
}

main().catch((err) => {
  console.error("[seed] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
