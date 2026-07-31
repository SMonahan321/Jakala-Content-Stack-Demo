/**
 * Seed a source Blog Post entry (fictional Cascade Regional Health flu campaign).
 *
 * Creates a realistic, FICTIONAL flu-vaccination Blog Post in the stack's MASTER locale,
 * with the fields the pipeline + fact-checker rely on: title, summary, body (a few
 * paragraphs of plain-language public-health copy incl. the required disclaimer), and
 * key_claims (explicit source-of-truth claims the fact-checker can verify).
 *
 * Idempotent-ish: if a Blog Post with the same title already exists it is REUSED (its
 * uid printed) rather than duplicated. Pass `--force` to create a fresh entry anyway.
 * The created/reused uid is printed as `BLOG_ENTRY_UID=<uid>` for the runner to consume.
 *
 * Usage:  npm run seed:blog            (create or reuse)
 *         npm run seed:blog -- --force (always create a new entry)
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

const TITLE = "Protect Your Family This Flu Season with Cascade Regional Health";

const SUMMARY =
  "Flu season is here. Cascade Regional Health offers free and low-cost flu vaccines at every " +
  "community clinic — walk-ins welcome, most insurance accepted.";

const BODY = [
  "Fall has arrived across the valley, and with it comes flu season. At Cascade Regional Health, " +
    "we believe protecting our community should be simple, welcoming, and close to home. That is why " +
    "flu vaccines are available at every one of our neighborhood clinics this season.",
  "The seasonal flu vaccine helps lower your chance of getting sick, and if you do catch the flu, " +
    "it can make your symptoms milder and your recovery quicker. Public health authorities recommend " +
    "the flu vaccine for everyone 6 months and older, including pregnant patients and older adults, " +
    "who face higher risks during flu season.",
  "Getting vaccinated is easier than ever. Walk-ins are welcome at all Cascade Regional Health " +
    "community clinics this fall, appointments are quick, and most insurance plans cover the cost at " +
    "no charge to you. Our care teams are happy to answer questions in English and Spanish.",
  "Every flu shot you get helps protect the people around you, too — newborns, grandparents, and " +
    "neighbors who cannot be vaccinated. When our community rolls up its sleeves together, we keep " +
    "each other healthier all season long.",
  requiredDisclaimer("en"),
].join("\n\n");

const KEY_CLAIMS = [
  "The seasonal flu vaccine helps lower your chance of getting sick.",
  "If you do catch the flu, the vaccine can make symptoms milder and recovery quicker.",
  "Public health authorities recommend the flu vaccine for everyone 6 months and older.",
  "Walk-ins are welcome at all Cascade Regional Health community clinics this fall.",
  "Most insurance plans cover the flu vaccine at no cost to the patient.",
];

interface RawEntry {
  uid: string;
  title?: string;
  locale?: string;
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
  const force = process.argv.slice(2).includes("--force");
  const apiKey = requireEnv("CONTENTSTACK_API_KEY");
  const managementToken = requireEnv("CONTENTSTACK_MANAGEMENT_TOKEN");
  const region = (process.env.CONTENTSTACK_REGION ?? "na").trim().toLowerCase();

  const config: ContentstackConfig = { region };
  const stack = createClient(config).stack({ api_key: apiKey, management_token: managementToken });

  // Idempotency: look for an existing Blog Post with the same title.
  if (!force) {
    const found = (await stack
      .contentType(BLOG_POST_CONTENT_TYPE)
      .entry()
      .query({ query: { title: TITLE } })
      .find()) as unknown as { items?: RawEntry[] };
    const existing = found.items?.[0];
    if (existing?.uid) {
      console.log(`[seed] Reusing existing Blog Post (title matched).`);
      console.log(`[seed] title: ${TITLE}`);
      console.log(`BLOG_ENTRY_UID=${existing.uid}`);
      return;
    }
  }

  const created = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry()
    .create({
      entry: {
        title: TITLE,
        summary: SUMMARY,
        body: BODY,
        key_claims: KEY_CLAIMS,
      },
    })) as unknown as RawEntry;

  console.log(`[seed] Created Blog Post in the master locale.`);
  console.log(`[seed] title: ${TITLE}`);
  console.log(`BLOG_ENTRY_UID=${created.uid}`);
}

main().catch((err) => {
  console.error("[seed] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
