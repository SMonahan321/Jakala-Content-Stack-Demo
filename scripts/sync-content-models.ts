/**
 * Programmatic content-model sync.
 *
 * Creates-or-updates the Contentstack content types from the JSON definitions in
 * `content-models/*.json` using `@contentstack/management`. This is how you
 * "update the Contentstack model programmatically" — run it once to bootstrap a
 * stack, and re-run any time the JSON changes (e.g. after adding `featured_image`).
 *
 * Idempotent: for each content type it checks whether the type already exists,
 * then CREATEs it from the JSON if absent or UPDATEs it (fetch → apply schema →
 * update) if present, so new fields propagate. Adding fields is non-destructive;
 * Contentstack bumps the content-type version on each update.
 *
 * Ordering: `blog_post` is synced before `channel_variant` so the
 * `channel_variant.source_blog` reference to `blog_post` resolves on first create.
 *
 * Usage:  npm run sync:models              (create/update — writes to the stack)
 *         npm run sync:models -- --dry-run (read-only; prints the create/update plan)
 *         npm run sync:models:dry          (convenience alias for the dry run)
 * Flags:  --dry-run | --check  authenticate + list content types, print whether each
 *         of blog_post / channel_variant WOULD be created/updated, then exit without
 *         writing anything.
 * Env:    Loaded automatically from `.env.local` then `.env` at the repo root
 *         (.env.local wins, Next.js-style). tsx does not auto-load these; dotenv does.
 *         CONTENTSTACK_API_KEY, CONTENTSTACK_MANAGEMENT_TOKEN (required)
 *         CONTENTSTACK_REGION (optional; na|eu|au|azure-na|azure-eu|gcp-na|gcp-eu; default na)
 *
 * This script typechecks without creds; it only needs them to actually run.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

// Load env BEFORE any `process.env` reads. `tsx` (unlike Next.js) does not
// auto-load .env files, so `npm run sync:models` would otherwise fail with
// "Missing required env var" even when creds exist. Precedence mirrors Next.js:
// `.env.local` overrides `.env`. dotenv never overwrites an already-set var, so
// the first file loaded wins — load `.env.local` first, then `.env`.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(repoRoot, ".env.local"), quiet: true });
loadEnv({ path: join(repoRoot, ".env"), quiet: true });

import { client as createClient } from "@contentstack/management";
import type { ContentstackConfig } from "@contentstack/management/types/contentstackClient";
import type { ContentTypeData } from "@contentstack/management/types/stack/contentType";

/** Shape of a `content-models/*.json` file (matches the CMA content-type body). */
interface ContentTypeDefinition {
  content_type: {
    uid: string;
    title: string;
    description?: string;
    options?: Record<string, unknown>;
    schema: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

/**
 * Desired create-order. `blog_post` must exist before `channel_variant` so the
 * `source_blog` reference resolves. Any other definitions found are synced after,
 * in filename order.
 */
const ORDER = ["blog_post", "channel_variant"];

/**
 * SDK region aliases accepted by `@contentstack/management` (lowercase-hyphen form).
 * The env value is passed through to the SDK's `region` option, which maps it to
 * the correct API host. `host` (if ever needed) takes priority over `region`.
 */
const REGION_ALIASES = ["na", "eu", "au", "azure-na", "azure-eu", "gcp-na", "gcp-eu"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `\nMissing required env var: ${name}\n` +
        "Set CONTENTSTACK_API_KEY and CONTENTSTACK_MANAGEMENT_TOKEN (see .env.example),\n" +
        "then re-run: npm run sync:models\n",
    );
    process.exit(1);
  }
  return value;
}

function resolveRegion(): string {
  const raw = (process.env.CONTENTSTACK_REGION ?? "na").trim().toLowerCase();
  if (!REGION_ALIASES.includes(raw)) {
    console.error(
      `\nInvalid CONTENTSTACK_REGION: "${raw}".\n` +
        `Valid values: ${REGION_ALIASES.join(", ")} (default: na).\n`,
    );
    process.exit(1);
  }
  return raw;
}

/** Load every `content-models/*.json` definition, keyed by content-type uid. */
function loadDefinitions(): Map<string, ContentTypeDefinition> {
  const here = dirname(fileURLToPath(import.meta.url));
  const modelsDir = join(here, "..", "content-models");
  const files = readdirSync(modelsDir).filter((f) => f.endsWith(".json"));

  const byUid = new Map<string, ContentTypeDefinition>();
  for (const file of files) {
    const raw = readFileSync(join(modelsDir, file), "utf8");
    const def = JSON.parse(raw) as ContentTypeDefinition;
    if (!def.content_type?.uid) {
      console.warn(`[sync] Skipping ${file}: no content_type.uid found.`);
      continue;
    }
    byUid.set(def.content_type.uid, def);
  }
  return byUid;
}

/** Order uids so referenced types are created before the types that reference them. */
function orderedUids(byUid: Map<string, ContentTypeDefinition>): string[] {
  const known = ORDER.filter((uid) => byUid.has(uid));
  const rest = [...byUid.keys()].filter((uid) => !ORDER.includes(uid)).sort();
  return [...known, ...rest];
}

/** True if invoked with `--dry-run` or `--check` (read-only, no writes). */
function isDryRun(): boolean {
  return process.argv.slice(2).some((arg) => arg === "--dry-run" || arg === "--check");
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const apiKey = requireEnv("CONTENTSTACK_API_KEY");
  const managementToken = requireEnv("CONTENTSTACK_MANAGEMENT_TOKEN");
  const region = resolveRegion();

  const config: ContentstackConfig = { region };
  const stack = createClient(config).stack({
    api_key: apiKey,
    management_token: managementToken,
  });

  const byUid = loadDefinitions();
  if (byUid.size === 0) {
    console.error("[sync] No content-model JSON files found in content-models/.");
    process.exit(1);
  }

  // One round-trip to learn which content types already exist (drives create vs update).
  const existing = new Set<string>();
  try {
    const collection = await stack.contentType().query().find();
    for (const item of collection.items ?? []) {
      if (item?.uid) existing.add(item.uid);
    }
  } catch (err) {
    console.error(
      "[sync] Failed to list existing content types. Check your API key, management " +
        "token, and region.\n",
      err,
    );
    process.exit(1);
  }

  console.log(`[sync] region=${region}`);

  // DRY RUN: report the create-vs-update plan from the read-only listing above,
  // then exit WITHOUT any create/update calls.
  if (dryRun) {
    console.log("[sync] DRY RUN — no changes written");
    let toCreate = 0;
    let toUpdate = 0;
    for (const uid of orderedUids(byUid)) {
      const action = existing.has(uid) ? "updated" : "created";
      if (action === "created") toCreate++;
      else toUpdate++;
      console.log(`[sync] ${uid}: would be ${action}`);
    }
    console.log(
      `\n[sync] dry run complete — ${toCreate} would be created, ${toUpdate} would be updated.`,
    );
    return;
  }

  const results: Array<{ uid: string; action: "created" | "updated" }> = [];

  for (const uid of orderedUids(byUid)) {
    const def = byUid.get(uid);
    if (!def) continue;

    if (existing.has(uid)) {
      // UPDATE: fetch the live content type, apply the JSON schema, persist.
      const handle = await stack.contentType(uid).fetch();
      handle.title = def.content_type.title;
      handle.schema = def.content_type.schema;
      if (def.content_type.options) handle.options = def.content_type.options;
      if (def.content_type.description !== undefined) {
        handle.description = def.content_type.description;
      }
      await handle.update();
      results.push({ uid, action: "updated" });
      console.log(`[sync] ${uid}: updated`);
    } else {
      // CREATE from the JSON definition. The JSON is validated at runtime; the cast
      // just satisfies the SDK's stricter compile-time `Schema[]` shape.
      await stack
        .contentType()
        .create({ content_type: def.content_type as unknown as ContentTypeData });
      existing.add(uid);
      results.push({ uid, action: "created" });
      console.log(`[sync] ${uid}: created`);
    }
  }

  const created = results.filter((r) => r.action === "created").length;
  const updated = results.filter((r) => r.action === "updated").length;
  console.log(`\n[sync] done — ${created} created, ${updated} updated.`);
}

main().catch((err) => {
  console.error("[sync] Unexpected error:", err);
  process.exit(1);
});
