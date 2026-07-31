/**
 * Seed a source Blog Post entry about tick bites and Lyme disease prevention
 * (fictional Cascade Regional Health seasonal awareness campaign).
 *
 * Creates a realistic, healthcare-appropriate Blog Post in the stack's MASTER
 * locale with the same fields the flu-vax seed uses (see `seed-blog-post.ts`):
 * title, summary, body (plain-language public-health copy incl. the required
 * compliance disclaimer), and key_claims (explicit source-of-truth claims the
 * fact-checker can verify).
 *
 * Idempotent by title: if a Blog Post with the same title already exists it is
 * UPDATED in place (so re-running never duplicates); otherwise a new entry is
 * created. Unlike the flu seed, this script deliberately does NOT publish — the
 * entry is left in draft/unpublished so the user can publish it manually to
 * trigger the webhook + downstream pipeline.
 *
 * Usage:  npm run seed:lyme
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

const TITLE = "Tick Bites and Lyme Disease: What to Know This Season";

const SUMMARY =
  "Tick season is here. Learn how ticks can spread Lyme disease, simple ways to prevent bites, " +
  "the early symptoms to watch for, and when to check in with your Cascade Regional Health care team.";

const BODY = [
  "As the weather warms and more of us spend time outdoors across the valley, it is a good time to " +
    "talk about ticks. At Cascade Regional Health, we want our neighbors to enjoy hiking, gardening, " +
    "and time in tall grass while knowing a few simple steps that help keep the whole family safer.",
  "Lyme disease is spread through the bite of certain infected ticks, most often tiny blacklegged " +
    "(deer) ticks. A tick usually needs to stay attached for many hours before it can pass along the " +
    "bacteria that cause Lyme, which is why finding and removing ticks promptly makes a real difference.",
  "Prevention starts before you head outside. Using an EPA-registered insect repellent, wearing long " +
    "sleeves and pants in wooded or grassy areas, and sticking to the center of trails can all lower " +
    "your chance of a bite. When you come back indoors, do a full-body tick check on yourself, your " +
    "kids, and your pets — paying close attention to the scalp, ears, underarms, waistline, and behind " +
    "the knees — and showering within a couple of hours can help wash away unattached ticks.",
  "If you find a tick, do not panic. Use fine-tipped tweezers to grasp it as close to the skin as " +
    "possible and pull upward with steady, even pressure, then clean the area with soap and water. " +
    "Removing a tick soon after it attaches is one of the best ways to reduce the risk of Lyme disease.",
  "Know the early signs so you can act quickly. In the days to weeks after a bite, some people develop " +
    "an expanding \"bull's-eye\" rash, along with flu-like symptoms such as fever, chills, fatigue, " +
    "headache, and muscle or joint aches. Not everyone gets a rash, so any new symptoms after time " +
    "outdoors are worth paying attention to.",
  "See a health care provider if you develop a rash, a fever, or other symptoms after a tick bite or " +
    "time in tick habitat — especially if you could not remove the tick, if it was attached for a long " +
    "time, or if you are unsure. When Lyme disease is caught early, care teams can help right away.",
  requiredDisclaimer("en"),
].join("\n\n");

const KEY_CLAIMS = [
  "Lyme disease is spread through the bite of certain infected ticks, most often blacklegged (deer) ticks.",
  "A tick usually must stay attached for many hours before it can transmit the bacteria that cause Lyme disease.",
  "Using EPA-registered insect repellent and wearing long sleeves and pants can lower the chance of tick bites.",
  "Checking for ticks after being outdoors and removing them promptly helps reduce the risk of Lyme disease.",
  "Fine-tipped tweezers used to grasp a tick close to the skin and pull upward with steady pressure are the recommended removal method.",
  "Early Lyme disease can cause an expanding bull's-eye rash and flu-like symptoms such as fever, chills, fatigue, and body aches.",
  "People who develop a rash or fever after a tick bite should see a health care provider, because early care helps.",
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
    console.log(`[seed] Updated existing Lyme Blog Post in place (title matched); left UNPUBLISHED.`);
    console.log(`[seed] title: ${TITLE}`);
    console.log(`BLOG_ENTRY_UID=${existing.uid}`);
    return;
  }

  const created = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry()
    .create({ entry: entryFields })) as unknown as RawEntry;

  console.log(`[seed] Created Lyme Blog Post in the master locale; left UNPUBLISHED (draft).`);
  console.log(`[seed] title: ${TITLE}`);
  console.log(`BLOG_ENTRY_UID=${created.uid}`);
}

main().catch((err) => {
  console.error("[seed] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
