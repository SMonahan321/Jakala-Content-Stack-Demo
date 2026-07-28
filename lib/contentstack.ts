/**
 * Thin wrapper around `@contentstack/management`.
 *
 * Responsibilities:
 *   - read the source Blog Post entry that triggered the webhook,
 *   - create/update Channel Variant entries (master locale + es/fr localizations),
 *   - move a Blog Post through workflow stages.
 *
 * Network calls are isolated behind clearly-typed functions. They only run when a
 * valid management token is present, so the project builds/typechecks without creds.
 */

import { client as createClient } from "@contentstack/management";

import type {
  BlogPost,
  ChannelVariant,
  Locale,
  WorkflowStage,
} from "./types";

export const BLOG_POST_CONTENT_TYPE = "blog_post";
export const CHANNEL_VARIANT_CONTENT_TYPE = "channel_variant";

/** Env-backed config. Kept lazy so import never throws at build time. */
function getConfig() {
  const apiKey = process.env.CONTENTSTACK_API_KEY;
  const managementToken = process.env.CONTENTSTACK_MANAGEMENT_TOKEN;
  return { apiKey, managementToken };
}

export function isContentstackConfigured(): boolean {
  const { apiKey, managementToken } = getConfig();
  return Boolean(apiKey && managementToken);
}

/** Build a Stack handle. Throws a clear error if creds are missing. */
function getStack() {
  const { apiKey, managementToken } = getConfig();
  if (!apiKey || !managementToken) {
    throw new Error(
      "Contentstack is not configured. Set CONTENTSTACK_API_KEY and CONTENTSTACK_MANAGEMENT_TOKEN.",
    );
  }
  const client = createClient();
  return client.stack({ api_key: apiKey, management_token: managementToken });
}

/**
 * Fetch the source Blog Post entry (in a given locale, default English).
 * Maps the raw Contentstack entry onto our domain `BlogPost` type.
 */
export async function getBlogPost(uid: string, locale: Locale = "en"): Promise<BlogPost> {
  const stack = getStack();
  // The SDK returns an Entry object with content fields spread on it.
  const entry = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry(uid)
    .fetch({ locale })) as unknown as RawBlogEntry;

  return {
    uid,
    locale,
    title: entry.title,
    body: entry.body ?? "",
    summary: entry.summary,
    keyClaims: entry.key_claims,
  };
}

/**
 * Create a Channel Variant entry in the master (English) locale.
 * Returns the created entry uid so es/fr localizations can be attached to it.
 *
 * TODO: reference field wiring — `source_blog` must be a reference to the Blog Post
 * entry ({ uid, _content_type_uid }); confirm the exact reference field shape once
 * the content type is created in your stack.
 */
export async function createVariantEntry(variant: ChannelVariant): Promise<string> {
  const stack = getStack();
  const created = (await stack
    .contentType(CHANNEL_VARIANT_CONTENT_TYPE)
    .entry()
    .create({ entry: toEntryData(variant) })) as unknown as { uid: string };
  return created.uid;
}

/**
 * Attach a localized (es/fr) version of an existing Channel Variant entry.
 * Fetches the entry in the target locale, applies localized fields, and updates.
 */
export async function localizeVariantEntry(
  entryUid: string,
  variant: ChannelVariant,
): Promise<void> {
  const stack = getStack();
  const entry = (await stack
    .contentType(CHANNEL_VARIANT_CONTENT_TYPE)
    .entry(entryUid)
    .fetch({ locale: variant.locale })) as unknown as RawEntryHandle;

  Object.assign(entry, toEntryData(variant));
  await entry.update({ locale: variant.locale });
}

/**
 * Convenience: persist a set of variants that share one (channel) master entry
 * across en/es/fr. `variants` should be the same channel in all three locales.
 * The English variant becomes the master entry; es/fr are localized onto it.
 */
export async function persistChannelAcrossLocales(
  variants: ChannelVariant[],
): Promise<string> {
  const master = variants.find((v) => v.locale === "en") ?? variants[0];
  const entryUid = await createVariantEntry(master);
  for (const variant of variants) {
    if (variant.locale === master.locale) continue;
    await localizeVariantEntry(entryUid, variant);
  }
  return entryUid;
}

/** Move a Blog Post entry to a workflow stage (e.g. "Needs Review"). */
export async function setBlogWorkflowStage(
  entryUid: string,
  stageUid: string,
  stageName: WorkflowStage,
  locale: Locale = "en",
): Promise<void> {
  const stack = getStack();
  const entry = stack.contentType(BLOG_POST_CONTENT_TYPE).entry(entryUid);
  await entry.setWorkflowStage({
    workflow_stage: { uid: stageUid, comment: `Moved to "${stageName}" by distribution agent.` },
    locale,
  });
}

/** Map our domain variant onto the Contentstack entry field shape. */
function toEntryData(variant: ChannelVariant): { title: string } & Record<string, unknown> {
  return {
    title: `${variant.channel} · ${variant.locale} · ${variant.sourceBlogUid}`,
    channel: variant.channel,
    formatted_text: variant.formattedText,
    hashtags: variant.hashtags,
    char_count: variant.charCount,
    image_crop_spec: JSON.stringify(variant.imageCropSpec),
    status: variant.status,
    source_blog: [
      { uid: variant.sourceBlogUid, _content_type_uid: BLOG_POST_CONTENT_TYPE },
    ],
  };
}

/** Minimal shape we read off a fetched Blog Post entry. */
interface RawBlogEntry {
  title: string;
  body?: string;
  summary?: string;
  key_claims?: string[];
}

/** An entry handle we can mutate + update (subset of the SDK Entry). */
interface RawEntryHandle {
  update(param?: { locale?: string }): Promise<unknown>;
  [key: string]: unknown;
}
