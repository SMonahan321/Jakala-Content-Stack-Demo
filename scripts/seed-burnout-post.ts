/**
 * Seed a source Blog Post entry about recognizing burnout and when to seek help
 * (fictional Cascade Regional Health mental-health awareness campaign).
 *
 * Creates a realistic, healthcare-appropriate Blog Post in the stack's MASTER
 * locale with the same fields the flu-vax / Lyme seeds use (see
 * `seed-blog-post.ts` and `seed-lyme-post.ts`): title, summary, body
 * (plain-language public-health copy incl. the required compliance disclaimer),
 * and key_claims (explicit source-of-truth claims the fact-checker can verify) —
 * PLUS a real `featured_image` file field pointing at an uploaded Contentstack
 * asset (an openly-licensed photo of someone looking stressed / holding their
 * head).
 *
 * The featured image is uploaded to the stack as an asset via the Management API
 * from a local file path (see IMAGE_UPLOAD_PATH). Upload is idempotent by asset
 * title: an existing asset with the same title is REUSED rather than re-uploaded.
 *
 * Idempotent by title: if a Blog Post with the same title already exists it is
 * UPDATED in place (so re-running never duplicates); otherwise a new entry is
 * created. Like the Lyme seed, this script deliberately does NOT publish — the
 * entry (and asset) are left UNPUBLISHED so the user can publish the post
 * manually to trigger the webhook + downstream pipeline.
 *
 * Usage:  npm run seed:burnout
 * Env:    Loaded from `.env.local` then `.env` (Next.js precedence).
 */

import { existsSync } from "node:fs";
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

const TITLE = "Recognizing Burnout and When to Seek Help";

const SUMMARY =
  "Burnout can build up slowly and be easy to miss. Learn the common signs, simple self-care steps " +
  "that can help, and when it is time to reach out to a health care provider or a mental-health helpline.";

const BODY = [
  "Life in our community can be busy, and many of us juggle work, caregiving, and everything in " +
    "between. At Cascade Regional Health, we hear from neighbors who feel worn down and stretched " +
    "thin. Sometimes that feeling is more than ordinary tiredness — it may be burnout, and learning " +
    "to recognize it early can help you take care of yourself and the people you love.",
  "Burnout is often described as a state of emotional exhaustion that can build up over time, " +
    "usually in response to prolonged stress. Many people notice three common threads: feeling " +
    "drained and used up, growing cynical or detached from work and the people around them, and a " +
    "reduced sense of accomplishment, as if nothing they do feels like enough.",
  "The signs can show up in different ways for different people. You might feel tired even after " +
    "resting, have trouble sleeping or concentrating, feel more irritable or withdrawn, or lose " +
    "interest in things you usually enjoy. Some people notice physical signs like headaches or an " +
    "upset stomach. Paying attention to these changes — and how long they last — is an important " +
    "first step.",
  "Small, steady self-care steps can make a real difference. Setting gentle boundaries around your " +
    "time and energy, protecting your rest and sleep, moving your body in ways you enjoy, and staying " +
    "connected to friends, family, or community can all help you recharge. It is okay to say no, and " +
    "it is okay to ask for support — leaning on the people around you is a sign of strength, not " +
    "weakness.",
  "Sometimes self-care is not enough on its own, and that is nothing to be ashamed of. Consider " +
    "reaching out to a health care provider or a mental-health professional if your symptoms are " +
    "persistent, if they are getting in the way of your daily life, work, or relationships, or if you " +
    "simply are not sure where to turn. Support is available, and talking with a professional can help " +
    "you find a path forward.",
  "If you ever have thoughts of harming yourself, please treat it as urgent and reach out right " +
    "away — contact a health care provider, go to your nearest emergency room, or call or text a " +
    "mental-health or suicide-prevention helpline in your area. You do not have to face these feelings " +
    "alone, and help is available.",
  requiredDisclaimer("en"),
].join("\n\n");

const KEY_CLAIMS = [
  "Burnout is often described as a state of emotional exhaustion that can build up in response to prolonged stress.",
  "Common features of burnout include emotional exhaustion, cynicism or detachment, and a reduced sense of accomplishment.",
  "Signs of burnout can include ongoing fatigue, trouble sleeping or concentrating, irritability, and loss of interest in usual activities.",
  "Self-care steps such as setting boundaries, protecting rest and sleep, and staying connected to others can help with burnout.",
  "People should consider reaching out to a health care provider or mental-health professional when burnout symptoms are persistent or interfere with daily functioning.",
  "Anyone experiencing thoughts of self-harm should seek help right away from a health care provider, an emergency room, or a mental-health helpline.",
];

// --- Featured image (openly-licensed) -------------------------------------
// Source page: https://www.pexels.com/photo/an-exhausted-man-working-on-his-laptop-6837640/
// Author:      Nataliya Vaitkevich (via Pexels)
// License:     Pexels License — free for commercial and personal use, no
//              attribution required (attribution recorded here as good practice).
// The binary is NOT committed to the repo; download it to a temp path before
// running this seed, e.g.:
//   curl -sSL -o /tmp/burnout.jpg \
//     "https://images.pexels.com/photos/6837640/pexels-photo-6837640.jpeg?auto=compress&cs=tinysrgb&w=1600"
const IMAGE_UPLOAD_PATH = process.env.BURNOUT_IMAGE_PATH ?? "/tmp/burnout.jpg";
const ASSET_TITLE = "Recognizing Burnout — Featured Image";
const ASSET_DESCRIPTION =
  "Photo of a stressed adult holding their head in their hands. Source: Pexels " +
  "(https://www.pexels.com/photo/an-exhausted-man-working-on-his-laptop-6837640/), " +
  "author Nataliya Vaitkevich, Pexels License (free for commercial reuse).";
const IMAGE_ATTRIBUTION = {
  source: "https://www.pexels.com/photo/an-exhausted-man-working-on-his-laptop-6837640/",
  author: "Nataliya Vaitkevich",
  license: "Pexels License (free for commercial & personal use, no attribution required)",
};

interface RawEntry {
  uid: string;
  title?: string;
  locale?: string;
}

interface RawAsset {
  uid: string;
  url?: string;
  title?: string;
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

/**
 * Upload the featured image as a Contentstack asset (idempotent by title).
 * Returns the asset uid + url. Does NOT publish the asset — the preview reads
 * assets via the Management API, so an unpublished asset is fine.
 */
async function ensureFeaturedAsset(
  stack: ReturnType<ReturnType<typeof createClient>["stack"]>,
): Promise<RawAsset> {
  const existing = (await stack
    .asset()
    .query({ query: { title: ASSET_TITLE } })
    .find()) as unknown as { items?: RawAsset[] };
  const found = existing.items?.[0];
  if (found?.uid) {
    console.log(`[seed] Reusing existing featured-image asset (title matched).`);
    return found;
  }

  if (!existsSync(IMAGE_UPLOAD_PATH)) {
    console.error(
      `\nFeatured image not found at ${IMAGE_UPLOAD_PATH}.\n` +
        `Download it first, e.g.:\n` +
        `  curl -sSL -o ${IMAGE_UPLOAD_PATH} \\\n` +
        `    "https://images.pexels.com/photos/6837640/pexels-photo-6837640.jpeg?auto=compress&cs=tinysrgb&w=1600"\n` +
        `Or point BURNOUT_IMAGE_PATH at a local file.\n`,
    );
    process.exit(1);
  }

  const created = (await stack.asset().create({
    upload: IMAGE_UPLOAD_PATH,
    title: ASSET_TITLE,
    description: ASSET_DESCRIPTION,
  })) as unknown as RawAsset;
  console.log(`[seed] Uploaded featured-image asset (left UNPUBLISHED).`);
  return created;
}

async function main(): Promise<void> {
  const apiKey = requireEnv("CONTENTSTACK_API_KEY");
  const managementToken = requireEnv("CONTENTSTACK_MANAGEMENT_TOKEN");
  const region = (process.env.CONTENTSTACK_REGION ?? "na").trim().toLowerCase();

  const config: ContentstackConfig = { region };
  const stack = createClient(config).stack({ api_key: apiKey, management_token: managementToken });

  // 1) Ensure the featured image exists as an asset (upload if needed).
  const asset = await ensureFeaturedAsset(stack);

  // 2) Build the entry fields. A single `file` field takes the asset uid.
  const entryFields = {
    title: TITLE,
    summary: SUMMARY,
    body: BODY,
    key_claims: KEY_CLAIMS,
    featured_image: asset.uid,
  };

  // Idempotency: find an existing Blog Post with the same title and UPDATE it in
  // place; otherwise CREATE a fresh one. Either way we never publish.
  const found = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry()
    .query({ query: { title: TITLE } })
    .find()) as unknown as { items?: RawEntry[] };
  const existing = found.items?.[0];

  let blogUid: string;
  if (existing?.uid) {
    const entry = (await stack
      .contentType(BLOG_POST_CONTENT_TYPE)
      .entry(existing.uid)
      .fetch()) as unknown as RawEntryHandle;
    Object.assign(entry, entryFields);
    await entry.update();
    blogUid = existing.uid;
    console.log(`[seed] Updated existing Burnout Blog Post in place (title matched); left UNPUBLISHED.`);
  } else {
    const created = (await stack
      .contentType(BLOG_POST_CONTENT_TYPE)
      .entry()
      .create({ entry: entryFields })) as unknown as RawEntry;
    blogUid = created.uid;
    console.log(`[seed] Created Burnout Blog Post in the master locale; left UNPUBLISHED (draft).`);
  }

  console.log(`[seed] title: ${TITLE}`);
  console.log(`[seed] Fields seeded: title, summary, body, key_claims, featured_image`);
  console.log(`BLOG_ENTRY_UID=${blogUid}`);
  console.log(`ASSET_UID=${asset.uid}`);
  console.log(`ASSET_URL=${asset.url ?? "(fetch asset to resolve url)"}`);
  console.log(
    `[seed] Image attribution — source: ${IMAGE_ATTRIBUTION.source} | ` +
      `author: ${IMAGE_ATTRIBUTION.author} | license: ${IMAGE_ATTRIBUTION.license}`,
  );
}

main().catch((err) => {
  console.error("[seed] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
