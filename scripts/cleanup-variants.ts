/**
 * One-time cleanup: delete duplicate Channel Variant entries for a source Blog Post.
 *
 * The write-back used to be CREATE-ONLY, so every pipeline run appended a fresh set of
 * `channel_variant` entries — leaving duplicates in the stack. Now that the write-back is
 * an UPSERT (see `persistChannelAcrossLocales` in `lib/contentstack.ts`), we do a single
 * surgical sweep to remove the accumulated dupes so the next run can recreate a clean
 * canonical set (3 masters × en/es/fr).
 *
 * Surgical by design:
 *   - ONLY touches content type `channel_variant`.
 *   - ONLY targets entries whose `source_blog` reference points at the given blog uid.
 *   - NEVER touches the Blog Post itself or any other content type.
 *
 * It lists + reports the matching entries (and the count) BEFORE deleting anything. If a
 * delete is blocked because the entry is published, it unpublishes then retries the delete.
 *
 * Usage:  npm run cleanup:variants -- <blogUid>
 *         npm run cleanup:variants -- <blogUid> --dry-run   (list only, delete nothing)
 * Env:    Loaded from `.env.local` then `.env` (Next.js precedence). Needs Contentstack creds.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(repoRoot, ".env.local"), quiet: true });
loadEnv({ path: join(repoRoot, ".env"), quiet: true });

import { client as createClient } from "@contentstack/management";
import type { ContentstackConfig } from "@contentstack/management/types/contentstackClient";

const CHANNEL_VARIANT_CONTENT_TYPE = "channel_variant";
const LOCALES = ["en", "es", "fr"] as const;

interface RawVariantEntry {
  uid?: string;
  title?: string;
  channel?: string;
  status?: string;
  locale?: string;
  source_blog?: unknown;
  publish_details?: Array<{ environment?: string; locale?: string }>;
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing required env var: ${name} (see .env.example)\n`);
    process.exit(1);
  }
  return value;
}

function resolveBlogUid(): string {
  const uid = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!uid) {
    console.error(
      "\nMissing Blog Post uid.\n" +
        "Usage: npm run cleanup:variants -- <blogUid> [--dry-run]\n",
    );
    process.exit(1);
  }
  return uid;
}

/** True when a `source_blog` reference value points at `blogUid`. */
function referencesBlog(source: unknown, blogUid: string): boolean {
  const refs = Array.isArray(source) ? source : source == null ? [] : [source];
  return refs.some((ref) => {
    if (typeof ref === "string") return ref === blogUid;
    if (ref && typeof ref === "object" && "uid" in ref) {
      return (ref as { uid?: string }).uid === blogUid;
    }
    return false;
  });
}

type Stack = ReturnType<ReturnType<typeof createClient>["stack"]>;

/** Resolve the stack's master locale code (the locale with no fallback). */
async function getMasterLocale(stack: Stack): Promise<string> {
  const res = (await stack.locale().query().find()) as unknown as {
    items?: Array<{ code: string; fallback_locale?: string | null }>;
  };
  const items = res.items ?? [];
  const master = items.find((l) => !l.fallback_locale) ?? items[0];
  return master?.code ?? "en-us";
}

/** Page through all master-locale channel_variant entries that reference `blogUid`. */
async function findVariantsForBlog(
  stack: Stack,
  masterLocale: string,
  blogUid: string,
): Promise<RawVariantEntry[]> {
  const matches: RawVariantEntry[] = [];
  const pageSize = 100;
  for (let skip = 0; ; skip += pageSize) {
    const res = (await stack
      .contentType(CHANNEL_VARIANT_CONTENT_TYPE)
      .entry()
      .query({ locale: masterLocale, include_count: false, limit: pageSize, skip })
      .find()) as unknown as { items?: RawVariantEntry[] };
    const items = res.items ?? [];
    for (const item of items) {
      if (referencesBlog(item.source_blog, blogUid)) matches.push(item);
    }
    if (items.length < pageSize) break;
  }
  return matches;
}

/** Looks like a "can't delete because it's published" style error. */
function looksPublished(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase();
  return /publish|422|being used|referenced/.test(msg);
}

/**
 * Unpublish an entry from every environment/locale it is published to, so it can be
 * deleted. Best-effort: reads `publish_details`, falling back to the configured
 * environment across all known locales.
 */
async function unpublishEverywhere(
  stack: Stack,
  entry: RawVariantEntry,
  masterLocale: string,
): Promise<void> {
  const uid = entry.uid;
  if (!uid) return;
  const envFromCfg = process.env.CONTENTSTACK_ENVIRONMENT;
  const details = entry.publish_details ?? [];
  const environments = [
    ...new Set(
      [...details.map((d) => d.environment), envFromCfg].filter(
        (e): e is string => Boolean(e),
      ),
    ),
  ];
  const locales = [
    ...new Set(
      [...details.map((d) => d.locale), masterLocale, ...LOCALES].filter(
        (l): l is string => Boolean(l),
      ),
    ),
  ];
  if (environments.length === 0) return;

  const handle = stack.contentType(CHANNEL_VARIANT_CONTENT_TYPE).entry(uid) as unknown as {
    unpublish(param: {
      publishDetails: { locales: string[]; environments: string[] };
    }): Promise<unknown>;
  };
  await handle.unpublish({ publishDetails: { locales, environments } });
}

/** Delete one entry, unpublishing first if the delete is blocked by a publish. */
async function deleteVariant(
  stack: Stack,
  entry: RawVariantEntry,
  masterLocale: string,
): Promise<void> {
  const uid = entry.uid;
  if (!uid) return;
  const handle = stack.contentType(CHANNEL_VARIANT_CONTENT_TYPE).entry(uid);
  try {
    await handle.delete();
    return;
  } catch (err) {
    if (!looksPublished(err)) throw err;
  }
  // Blocked by a publish — unpublish everywhere, then retry the delete with backoff.
  console.log(`  [cleanup] ${uid} appears published; unpublishing then retrying delete…`);
  await unpublishEverywhere(stack, entry, masterLocale);
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(2000 * attempt);
    try {
      await stack.contentType(CHANNEL_VARIANT_CONTENT_TYPE).entry(uid).delete();
      return;
    } catch (err) {
      if (attempt === 5) throw err;
    }
  }
}

async function main(): Promise<void> {
  const blogUid = resolveBlogUid();
  const dryRun = process.argv.slice(2).includes("--dry-run");

  const apiKey = requireEnv("CONTENTSTACK_API_KEY");
  const managementToken = requireEnv("CONTENTSTACK_MANAGEMENT_TOKEN");
  const region = (process.env.CONTENTSTACK_REGION ?? "na").trim().toLowerCase();
  const config: ContentstackConfig = { region };
  const stack = createClient(config).stack({ api_key: apiKey, management_token: managementToken });

  const masterLocale = await getMasterLocale(stack);
  console.log(`[cleanup] blog uid: ${blogUid}`);
  console.log(`[cleanup] master locale: ${masterLocale}`);
  console.log(`[cleanup] querying channel_variant entries that reference the blog…\n`);

  const matches = await findVariantsForBlog(stack, masterLocale, blogUid);
  console.log(`[cleanup] found ${matches.length} channel_variant master entr${matches.length === 1 ? "y" : "ies"} referencing this blog:`);
  for (const m of matches) {
    console.log(
      `  - ${m.uid}  channel=${m.channel ?? "?"}  status=${m.status ?? "?"}  title="${m.title ?? ""}"`,
    );
  }

  if (matches.length === 0) {
    console.log(`\n[cleanup] nothing to delete.`);
    return;
  }

  if (dryRun) {
    console.log(`\n[cleanup] --dry-run: no entries deleted.`);
    return;
  }

  console.log(`\n[cleanup] deleting ${matches.length} entr${matches.length === 1 ? "y" : "ies"}…`);
  let deleted = 0;
  for (const entry of matches) {
    await deleteVariant(stack, entry, masterLocale);
    deleted++;
    console.log(`  [cleanup] deleted ${entry.uid} (${deleted}/${matches.length})`);
  }

  console.log(`\n[cleanup] done. Deleted ${deleted} channel_variant entr${deleted === 1 ? "y" : "ies"}.`);
}

main().catch((err) => {
  console.error("[cleanup] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
