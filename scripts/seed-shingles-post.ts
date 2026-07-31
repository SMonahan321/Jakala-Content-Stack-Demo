/**
 * Seed a NUANCED fact-check demo Blog Post (fictional Cascade Regional Health).
 *
 * Unlike the "bad" demos (detox / apple), this post does NOT contain an egregious,
 * reflexively-killed "100% cure" claim. Instead it carries ONE specific, plausible,
 * real-world efficacy statistic — "the shingles vaccine reduced the risk of shingles
 * by about 90% in adults aged 50 and older" — the kind of claim a real health system
 * genuinely has a source for. It exists to showcase the LEGITIMATE `key_claims`
 * workflow: "we have a verified fact, we declare it as an author-supported claim, and
 * the fact-checker trusts our source of truth."
 *
 * ── The decisive lever (empirically converged; see notes below) ─────────────────────
 * The fact-checker's SOURCE is Title + Body + `key_claims` ONLY — it does NOT see the
 * `summary` (verified by tracing `buildMatrixFactCheckPrompt` in lib/reasoning.ts). The
 * TRANSCREATION step, by contrast, DOES see the `summary`. We exploit that asymmetry:
 *   - The precise "~90% reduction in adults 50+" figure lives in the SUMMARY, so with
 *     `demo_bypass_compliance: true` the transcreator surfaces it verbatim into the
 *     generated variants (the copy a reviewer actually sees).
 *   - The BODY deliberately describes the vaccine only as "highly effective in clinical
 *     trials" — it NEVER states the 90% figure. So the fact-checker's source does NOT
 *     support "90%" unless the author explicitly declares it.
 *   - Therefore `key_claims` membership of the 90% stat is the SOLE deciding factor:
 *       • WITHOUT the stat in key_claims  → the variants' "90%" is an unsupported /
 *         uncited efficacy statistic → FLAGGED.
 *       • WITH the stat in key_claims     → the same "90%" is author-declared and
 *         supported by the source of truth → PASSES.
 * If the 90% figure were placed in the BODY instead, it would count as "present in the
 * source" and pass even without key_claims — defeating the demo. Keeping it out of the
 * body (and out of the title, which the fact-checker also sees) is what makes key_claims
 * the lever. The body also explicitly names the adults-50+ audience so the transcreator
 * has no reason to invent a *different* unsupported audience claim.
 *
 * DEFAULT STATE = "A" (flagging): the 90% stat is NOT in `key_claims`, so a fresh seed
 * flags out of the box and the user can demo ADDING it to key_claims live to watch it
 * flip to PASS. To pre-load the passing state, run with `--with-stat`.
 *
 * Idempotent by exact title (UPDATE in place; never duplicates). Never publishes — the
 * entry is left UNPUBLISHED so it can be run through the pipeline manually
 * (`npm run run:pipeline -- <uid>`).
 *
 * Usage:  npm run seed:shingles              (state A — 90% stat NOT in key_claims)
 *         npm run seed:shingles -- --with-stat   (state B — 90% stat IN key_claims)
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

const TITLE = "Shingles After 50: What the Vaccine Actually Does";

// IMPORTANT: the precise 90% figure lives HERE (summary) — the transcreator sees the
// summary and surfaces the stat into variants, but the fact-checker does NOT see the
// summary, so this figure never counts as "source-supported" on its own.
const SUMMARY =
  "In large clinical trials, the shingles vaccine reduced the risk of shingles by about " +
  "90% in adults aged 50 and older. Here is a plain-language look at what that means and " +
  "why our care teams talk about it with neighbors over 50.";

// IMPORTANT: the BODY must NOT state the 90% figure (nor any specific efficacy number).
// The fact-checker sees Title + Body + key_claims, so any number here would count as
// source-supported and defeat the demo. Describe effectiveness qualitatively only.
const BODY = [
  "Shingles is a painful, blistering rash caused by the same virus that causes chickenpox. " +
    "After you recover from chickenpox the virus stays dormant in the body and can reactivate " +
    "years later as shingles. The risk goes up as we get older, which is why our care teams at " +
    "Cascade Regional Health talk about prevention with neighbors aged 50 and older.",
  // Deliberately QUALITATIVE — "highly effective in clinical trials" with NO number, so the
  // fact-checker's source does not support the specific 90% figure the variants will surface.
  "The good news is that a shingles vaccine is available and was highly effective at preventing " +
    "shingles in clinical trials. Public health authorities recommend it for most adults aged 50 " +
    "and older. It is given as two doses a few months apart, and the most common side effects are " +
    "a sore arm, tiredness, or a short-lived headache.",
  "Protecting older adults matters because shingles can be more severe with age, and some people " +
    "develop lingering nerve pain after the rash clears. Talking with a clinician about the vaccine " +
    "is an easy, concrete step older members of our community can take to lower that risk.",
  "As always, our care teams encourage steady, everyday habits and a conversation with your own " +
    "provider, who can look at your history and tell you whether the shingles vaccine is right for you.",
  requiredDisclaimer("en"),
].join("\n\n");

// STATE A (default): only benign, genuinely body-supportable claims. The 90% efficacy
// stat is intentionally ABSENT so the variants' "90%" reads as an uncited statistic and
// the fact-checker FLAGS it.
const KEY_CLAIMS_BASE = [
  "Shingles is caused by reactivation of the virus that causes chickenpox.",
  "The risk of shingles increases with age.",
  "The shingles vaccine is recommended for most adults aged 50 and older.",
  "In clinical trials the shingles vaccine was highly effective at preventing shingles.",
  "The shingles vaccine is given as two doses a few months apart.",
];

// STATE B (add with --with-stat): the author DECLARES the specific efficacy statistic as
// a verified, source-of-truth supported claim. Now the same "90%" in the variants is
// author-declared and the fact-checker PASSES it.
const STAT_CLAIM =
  "The shingles vaccine reduced the risk of shingles by about 90% in adults aged 50 and older.";

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

  const withStat = process.argv.slice(2).includes("--with-stat");
  const keyClaims = withStat ? [...KEY_CLAIMS_BASE, STAT_CLAIM] : [...KEY_CLAIMS_BASE];

  const config: ContentstackConfig = { region };
  const stack = createClient(config).stack({ api_key: apiKey, management_token: managementToken });

  const entryFields = {
    title: TITLE,
    summary: SUMMARY,
    body: BODY,
    key_claims: keyClaims,
    // DEMO ONLY: bypass claim-compliance in transcreation so the specific 90% efficacy
    // stat (in the summary) carries through into the variants and reaches the still-strict
    // fact-checker. Never enable on real content.
    demo_bypass_compliance: true,
  };

  const stateLabel = withStat
    ? "B (90% stat IN key_claims → expect PASS)"
    : "A (90% stat NOT in key_claims → expect FLAG)";

  // Idempotency: find an existing Blog Post with the same title and UPDATE it in place;
  // otherwise CREATE a fresh one. Either way we never publish.
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
    console.log(`[seed] Updated existing Shingles demo Blog Post in place (title matched); left UNPUBLISHED.`);
    console.log(`[seed] title: ${TITLE}`);
    console.log(`[seed] state: ${stateLabel}`);
    console.log(`[seed] status: UNPUBLISHED (draft)`);
    console.log(`BLOG_ENTRY_UID=${existing.uid}`);
    return;
  }

  const created = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry()
    .create({ entry: entryFields })) as unknown as RawEntry;

  console.log(`[seed] Created Shingles demo Blog Post in the master locale; left UNPUBLISHED (draft).`);
  console.log(`[seed] title: ${TITLE}`);
  console.log(`[seed] state: ${stateLabel}`);
  console.log(`[seed] status: UNPUBLISHED (draft)`);
  console.log(`BLOG_ENTRY_UID=${created.uid}`);
}

main().catch((err) => {
  console.error("[seed] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
