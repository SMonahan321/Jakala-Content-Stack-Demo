/**
 * Programmatic locale sync (pipeline preflight).
 *
 * The write-back pipeline localizes Channel Variants into es/fr, which fails unless
 * those locales exist in the stack. This script:
 *   1. detects the stack's MASTER locale (the one with no fallback),
 *   2. ensures `es` and `fr` locales exist — CREATING any that are missing, with a
 *      `fallback_locale` of the master locale,
 *   3. reports the final locale set.
 *
 * Non-`en` master: our domain model treats logical "en" as the source/master locale,
 * but a stack may use a different master code (e.g. "en-us"). We DO NOT try to force an
 * `en` locale in — we align to whatever the stack's real master is (see the locale
 * mapping in `lib/contentstack.ts`). This script only adds the target `es`/`fr` locales.
 *
 * Usage:  npm run sync:locales
 * Env:    Loaded from `.env.local` then `.env` at the repo root (Next.js precedence).
 *         CONTENTSTACK_API_KEY, CONTENTSTACK_MANAGEMENT_TOKEN (required)
 *         CONTENTSTACK_REGION (optional; default na)
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(repoRoot, ".env.local"), quiet: true });
loadEnv({ path: join(repoRoot, ".env"), quiet: true });

import { client as createClient } from "@contentstack/management";
import type { ContentstackConfig } from "@contentstack/management/types/contentstackClient";

/** Locales the pipeline localizes into (besides the master). */
const TARGET_LOCALES: Array<{ code: string; name: string }> = [
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
];

interface RawLocale {
  code: string;
  name?: string;
  fallback_locale?: string | null;
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

  console.log(`[locales] region=${region}`);

  // 1. Load current locales and detect the master (no fallback).
  const res = (await stack.locale().query().find()) as unknown as { items?: RawLocale[] };
  const existing = res.items ?? [];
  const existingCodes = new Set(existing.map((l) => l.code));
  const master = existing.find((l) => !l.fallback_locale) ?? existing[0];
  const masterCode = master?.code ?? "en-us";

  console.log(`[locales] master locale detected: ${masterCode} (${master?.name ?? "?"})`);
  if (masterCode !== "en") {
    console.log(
      `[locales] NOTE: master is "${masterCode}", not "en". The pipeline maps logical ` +
        `"en" → "${masterCode}" (see lib/contentstack.ts); no separate "en" locale is added.`,
    );
  }
  console.log(`[locales] existing: ${[...existingCodes].join(", ") || "(none)"}`);

  // 2. Ensure each target locale exists; create missing ones with the master fallback.
  let created = 0;
  for (const target of TARGET_LOCALES) {
    if (existingCodes.has(target.code)) {
      console.log(`[locales] ${target.code}: already exists`);
      continue;
    }
    await stack.locale().create({
      locale: {
        code: target.code,
        name: target.name,
        fallback_locale: masterCode,
      },
    });
    created++;
    console.log(`[locales] ${target.code}: created (fallback=${masterCode})`);
  }

  console.log(`\n[locales] done — ${created} created. master=${masterCode}`);
}

main().catch((err) => {
  console.error("[locales] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
