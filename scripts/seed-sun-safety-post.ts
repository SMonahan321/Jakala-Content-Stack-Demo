/**
 * Seed a source Blog Post entry about summer sun safety and lowering skin
 * cancer risk (fictional Cascade Regional Health seasonal awareness campaign).
 *
 * Creates a realistic, healthcare-appropriate Blog Post in the stack's MASTER
 * locale with the same fields the Lyme / Burnout seeds use (see
 * `seed-lyme-post.ts` and `seed-burnout-post.ts`): title, summary, body
 * (plain-language public-health copy incl. the required compliance disclaimer),
 * and key_claims (explicit source-of-truth claims the fact-checker can verify).
 *
 * This is a COMPLIANT "good" post: the copy is deliberately supportable and
 * non-absolute (no guarantees, no cures) so it PASSES fact-checking cleanly.
 * `demo_bypass_compliance` is left off (false) so the standard guardrails apply.
 *
 * Idempotent by title: if a Blog Post with the same title already exists it is
 * UPDATED in place (so re-running never duplicates); otherwise a new entry is
 * created. Like the Lyme / Burnout seeds, this script deliberately does NOT
 * publish — the entry is left in draft/unpublished so it can be run through the
 * pipeline manually (`npm run run:pipeline -- <uid>`) or published later.
 *
 * Usage:  npm run seed:sunsafety
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

const TITLE = "Sun Safety: Lower Your Skin Cancer Risk This Summer";

const SUMMARY =
  "Warm, sunny days are here. Learn simple, everyday ways to protect your skin from UV rays, " +
  "the mole changes worth watching for, and when to check in with your Cascade Regional Health care team.";

const BODY = [
  "Summer in the valley means more time outdoors — hiking, gardening, and afternoons by the water. " +
    "At Cascade Regional Health, we want our neighbors to enjoy the season while taking a few easy steps " +
    "that help protect their skin. Most sun damage builds up over years, so small habits now can add up.",
  "Sunscreen is one of the simplest protections. Choose a broad-spectrum sunscreen with an SPF of 30 " +
    "or higher, apply it generously to all exposed skin about 15 minutes before heading out, and reapply " +
    "at least every two hours — and more often after swimming or heavy sweating. Sunscreen works best as " +
    "part of a bigger routine, not on its own.",
  "Shade and timing matter too. The sun's UV rays tend to be strongest in the middle of the day, so " +
    "seeking shade during those hours can lower your exposure. Wearing a wide-brimmed hat, lightweight " +
    "long sleeves, and UV-blocking sunglasses adds an extra layer of protection for your skin and eyes.",
  "Getting to know your skin helps you notice changes early. A helpful guide is the ABCDEs of moles: " +
    "Asymmetry, irregular Borders, uneven Color, a Diameter larger than a pencil eraser, and Evolving " +
    "size, shape, or color over time. Checking your skin periodically makes it easier to spot something " +
    "new or different.",
  "If you notice a mole or spot that is changing, itching, bleeding, or simply does not look right, " +
    "reach out to a health care provider. Bringing questions to your care team early makes it easier to " +
    "get answers and, when needed, follow up promptly.",
  requiredDisclaimer("en"),
].join("\n\n");

// Only supportable, non-absolute prevention claims (no guarantees, no cures) so
// the fact-checker can verify them and the post PASSES cleanly.
const KEY_CLAIMS = [
  "Using a broad-spectrum sunscreen with SPF 30 or higher helps protect skin from UV rays.",
  "Sunscreen should be reapplied at least every two hours, and more often after swimming or sweating.",
  "The sun's UV rays are generally strongest in the middle of the day, so seeking shade then can lower exposure.",
  "Wearing a wide-brimmed hat, protective clothing, and UV-blocking sunglasses adds protection from the sun.",
  "The ABCDEs (Asymmetry, Border, Color, Diameter, Evolving) are a guide for noticing concerning changes in moles.",
  "People who notice a new or changing mole or spot should see a health care provider.",
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
    // Standard guardrails apply — this is a compliant post meant to PASS.
    demo_bypass_compliance: false,
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
    console.log(`[seed] Updated existing Sun Safety Blog Post in place (title matched); left UNPUBLISHED.`);
    console.log(`[seed] title: ${TITLE}`);
    console.log(`[seed] status: UNPUBLISHED (draft)`);
    console.log(`BLOG_ENTRY_UID=${existing.uid}`);
    return;
  }

  const created = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry()
    .create({ entry: entryFields })) as unknown as RawEntry;

  console.log(`[seed] Created Sun Safety Blog Post in the master locale; left UNPUBLISHED (draft).`);
  console.log(`[seed] title: ${TITLE}`);
  console.log(`[seed] status: UNPUBLISHED (draft)`);
  console.log(`BLOG_ENTRY_UID=${created.uid}`);
}

main().catch((err) => {
  console.error("[seed] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
