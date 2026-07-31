/**
 * Programmatic webhook sync.
 *
 * Creates-or-updates the Contentstack outgoing webhook that points at the app's
 * `/api/webhook` endpoint, so publishing content triggers the pipeline. This is
 * how you "wire the webhook programmatically" — run it once the app is deployed
 * and you know its public URL, and re-run any time the target URL, secret, or
 * trigger changes.
 *
 * What it configures on the webhook:
 *   - name            : WEBHOOK_NAME (default "one-post-pipeline"); used as the
 *                       idempotency key — we look it up by name and update in place.
 *   - target_url      : WEBHOOK_TARGET_URL, e.g. https://<app>.vercel.app/api/webhook
 *   - custom_header   : the shared-secret header that `app/api/webhook/route.ts`
 *                       verifies. route.ts checks `x-contentstack-webhook-secret`
 *                       (see SECRET_HEADER_NAME below) against CONTENTSTACK_WEBHOOK_SECRET,
 *                       so we set that exact header to that exact value.
 *   - channels        : WEBHOOK_TRIGGER (default entry-publish-success of blog_post):
 *                       "content_types.blog_post.entries.publish.success".
 *
 * Idempotent: lists existing webhooks, matches on name, then UPDATEs (fetch →
 * assign → update) if present or CREATEs if absent. Prints the resulting webhook.
 *
 * Usage:  npm run sync:webhook                 (create/update — writes to the stack)
 *         npm run sync:webhook -- --dry-run    (read-only; prints the webhook body it WOULD send)
 * Env:    Loaded automatically from `.env.local` then `.env` at the repo root
 *         (.env.local wins, Next.js-style). tsx does not auto-load these; dotenv does.
 *         CONTENTSTACK_API_KEY, CONTENTSTACK_MANAGEMENT_TOKEN (required)
 *         CONTENTSTACK_WEBHOOK_SECRET (required — value of the custom secret header)
 *         WEBHOOK_TARGET_URL          (required — the deployed <url>/api/webhook)
 *         CONTENTSTACK_REGION (optional; na|eu|au|azure-na|azure-eu|gcp-na|gcp-eu; default na)
 *         WEBHOOK_NAME     (optional; default "one-post-pipeline")
 *         WEBHOOK_TRIGGER  (optional; default "content_types.blog_post.entries.publish.success")
 *
 * This script typechecks without creds; it only needs them to actually run.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

// Load env BEFORE any `process.env` reads. `tsx` (unlike Next.js) does not
// auto-load .env files. Precedence mirrors Next.js: `.env.local` overrides `.env`.
// dotenv never overwrites an already-set var, so the first file loaded wins —
// load `.env.local` first, then `.env`.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(repoRoot, ".env.local"), quiet: true });
loadEnv({ path: join(repoRoot, ".env"), quiet: true });

import { client as createClient } from "@contentstack/management";
import type { ContentstackConfig } from "@contentstack/management/types/contentstackClient";
import type { WebhookData } from "@contentstack/management/types/stack/webhook";

/**
 * The custom HTTP header that `app/api/webhook/route.ts` verifies the inbound
 * request with (it compares this header's value to CONTENTSTACK_WEBHOOK_SECRET).
 * route.ts also accepts `cs-webhook-secret` as a fallback, but this is the
 * primary/preferred name — keep the two in sync if route.ts ever changes.
 */
const SECRET_HEADER_NAME = "x-contentstack-webhook-secret";

/** Default webhook name; used as the idempotency key (looked up on each run). */
const DEFAULT_WEBHOOK_NAME = "one-post-pipeline";

/**
 * Default trigger channel: a `blog_post` entry is *successfully published*.
 * Format per Contentstack's Webhook Events reference — the specific-content-type
 * prefix `content_types.{contenttype_uid}.entries.` combined with the
 * `publish.success` event. See docs/webhook-setup.md for the source + how to
 * switch this to a workflow-stage transition once a workflow exists.
 */
const DEFAULT_WEBHOOK_TRIGGER = "content_types.blog_post.entries.publish.success";

/** SDK region aliases accepted by `@contentstack/management` (lowercase-hyphen form). */
const REGION_ALIASES = ["na", "eu", "au", "azure-na", "azure-eu", "gcp-na", "gcp-eu"];

function requireEnv(name: string, hint?: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `\nMissing required env var: ${name}\n` +
        (hint ? `${hint}\n` : "") +
        "See .env.example, then re-run: npm run sync:webhook\n",
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

/** True if invoked with `--dry-run` or `--check` (read-only, no writes). */
function isDryRun(): boolean {
  return process.argv.slice(2).some((arg) => arg === "--dry-run" || arg === "--check");
}

/** Build the webhook body we want to exist in the stack. */
function buildWebhook(opts: {
  name: string;
  targetUrl: string;
  secret: string;
  trigger: string;
}): WebhookData {
  return {
    name: opts.name,
    destinations: [
      {
        target_url: opts.targetUrl,
        // route.ts reads this exact header and compares it to CONTENTSTACK_WEBHOOK_SECRET.
        custom_header: [{ header_name: SECRET_HEADER_NAME, value: opts.secret }],
      },
    ],
    channels: [opts.trigger],
    retry_policy: "manual",
    disabled: false,
    // Send the full payload so route.ts can read entry uid / workflow stage.
    concise_payload: false,
  };
}

async function main(): Promise<void> {
  const dryRun = isDryRun();

  const apiKey = requireEnv("CONTENTSTACK_API_KEY");
  const managementToken = requireEnv("CONTENTSTACK_MANAGEMENT_TOKEN");
  const secret = requireEnv(
    "CONTENTSTACK_WEBHOOK_SECRET",
    "This is the value of the custom secret header the webhook sends and that " +
      "app/api/webhook/route.ts verifies. It MUST match the value deployed to the app.",
  );
  const targetUrl = requireEnv(
    "WEBHOOK_TARGET_URL",
    "Set it to the deployed endpoint, e.g. https://<app>.vercel.app/api/webhook " +
      "(see docs/webhook-setup.md to deploy and get the URL first).",
  );
  const region = resolveRegion();
  const name = (process.env.WEBHOOK_NAME ?? DEFAULT_WEBHOOK_NAME).trim();
  const trigger = (process.env.WEBHOOK_TRIGGER ?? DEFAULT_WEBHOOK_TRIGGER).trim();

  const webhook = buildWebhook({ name, targetUrl, secret, trigger });

  console.log(`[webhook] region=${region}`);
  console.log(`[webhook] name="${name}"`);
  console.log(`[webhook] target_url=${targetUrl}`);
  console.log(`[webhook] header=${SECRET_HEADER_NAME} (value from CONTENTSTACK_WEBHOOK_SECRET)`);
  console.log(`[webhook] channels=${JSON.stringify(webhook.channels)}`);

  // DRY RUN: print the body we WOULD send (secret redacted), then exit.
  if (dryRun) {
    const redacted = JSON.parse(JSON.stringify(webhook)) as WebhookData;
    for (const dest of redacted.destinations) {
      for (const h of (dest.custom_header ?? []) as Array<{ value?: string }>) {
        if (h.value) h.value = "***redacted***";
      }
    }
    console.log("[webhook] DRY RUN — no changes written. Body that would be sent:");
    console.log(JSON.stringify({ webhook: redacted }, null, 2));
    return;
  }

  const config: ContentstackConfig = { region };
  const stack = createClient(config).stack({
    api_key: apiKey,
    management_token: managementToken,
  });

  // Look up an existing webhook by name (the idempotency key).
  let existingUid: string | undefined;
  try {
    const collection = await stack.webhook().fetchAll();
    for (const item of collection.items ?? []) {
      if (item?.name === name && item?.uid) {
        existingUid = item.uid;
        break;
      }
    }
  } catch (err) {
    console.error(
      "[webhook] Failed to list existing webhooks. Check your API key, management " +
        "token, and region.\n",
      err,
    );
    process.exit(1);
  }

  if (existingUid) {
    // UPDATE: fetch the live webhook, apply desired fields, persist.
    const handle = await stack.webhook(existingUid).fetch();
    handle.name = webhook.name;
    handle.destinations = webhook.destinations;
    handle.channels = webhook.channels;
    handle.retry_policy = webhook.retry_policy;
    handle.disabled = webhook.disabled;
    handle.concise_payload = webhook.concise_payload;
    const updated = await handle.update();
    console.log(`\n[webhook] updated — uid=${updated.uid}`);
  } else {
    // CREATE from the desired body.
    const created = await stack.webhook().create({ webhook });
    console.log(`\n[webhook] created — uid=${created.uid}`);
  }

  console.log(
    "[webhook] done. Publish a blog_post entry to trigger the pipeline (see docs/webhook-setup.md).",
  );
}

main().catch((err) => {
  console.error("[webhook] Unexpected error:", err?.message ?? err);
  process.exit(1);
});
