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

import { CHANNELS } from "./types";
import type {
  BlogPost,
  Channel,
  ChannelVariant,
  ImageCropSpec,
  Locale,
  VariantStatus,
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

/**
 * Locale handling.
 *
 * Our domain model uses the logical locales "en" | "es" | "fr" (see `lib/types.ts`),
 * where "en" is the SOURCE/master locale. A real stack, however, may use a different
 * master locale code (e.g. "en-us"). Everything that touches the Management API must
 * therefore translate the logical locale to the stack's actual code:
 *   - logical "en"  → the stack's master locale code (resolved at runtime),
 *   - logical "es"  → "es",
 *   - logical "fr"  → "fr".
 * This keeps the reasoning/prompt layer locale-agnostic while writing to the right
 * Contentstack locale.
 */
let cachedMasterLocale: string | null = null;

interface RawLocale {
  code: string;
  name?: string;
  fallback_locale?: string | null;
}

/**
 * Resolve the stack's master locale code — the locale that has no fallback.
 * Cached for the process lifetime. Defaults to "en-us" if it can't be determined.
 */
export async function getMasterLocale(): Promise<string> {
  if (cachedMasterLocale) return cachedMasterLocale;
  const stack = getStack();
  const res = (await stack.locale().query().find()) as unknown as { items?: RawLocale[] };
  const items = res.items ?? [];
  const master = items.find((l) => !l.fallback_locale) ?? items[0];
  cachedMasterLocale = master?.code ?? "en-us";
  return cachedMasterLocale;
}

/** Translate a logical domain `Locale` into the stack's actual locale code. */
export async function resolveStackLocale(locale: Locale): Promise<string> {
  if (locale === "en") return getMasterLocale();
  return locale;
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
  const stackLocale = await resolveStackLocale(locale);
  // The SDK returns an Entry object with content fields spread on it.
  const entry = (await stack
    .contentType(BLOG_POST_CONTENT_TYPE)
    .entry(uid)
    .fetch({ locale: stackLocale })) as unknown as RawBlogEntry;

  return {
    uid,
    locale,
    title: entry.title,
    body: entry.body ?? "",
    summary: entry.summary,
    keyClaims: entry.key_claims,
    featuredImage: mapFeaturedImage(entry.featured_image),
  };
}

/**
 * Normalize a Contentstack file/asset field into our optional `featuredImage`.
 * A single file field comes back either as the asset `uid` string (default) or as
 * a resolved asset object (when the fetch used `include[]`). Absent → undefined.
 */
function mapFeaturedImage(
  raw: string | { uid?: string; url?: string } | null | undefined,
): { uid: string; url?: string } | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return { uid: raw };
  if (raw.uid) return { uid: raw.uid, url: raw.url };
  return undefined;
}

/**
 * Read the live Channel Variant entries for a given source Blog Post, across the
 * requested logical locales (defaults to en/es/fr). Powers the `/preview` page.
 *
 * For each logical locale we translate to the stack's actual locale code, query the
 * `channel_variant` content type, keep only entries whose `source_blog` reference
 * points at `blogUid`, and map the raw entry onto our domain `ChannelVariant`. The
 * reference match is done client-side so it's robust to how the SDK returns the
 * reference field (array of `{ uid }` objects or bare uid strings).
 *
 * Only runs when creds are present (`getStack` throws otherwise) — callers on the
 * preview page catch any failure and fall back to the static fixture.
 */
export async function getChannelVariantsForBlog(
  blogUid: string,
  locales: Locale[] = ["en", "es", "fr"],
): Promise<ChannelVariant[]> {
  const stack = getStack();
  const variants: ChannelVariant[] = [];

  for (const locale of locales) {
    const stackLocale = await resolveStackLocale(locale);
    const res = (await stack
      .contentType(CHANNEL_VARIANT_CONTENT_TYPE)
      .entry()
      .query({ locale: stackLocale, include_count: false, limit: 100 })
      .find()) as unknown as { items?: RawVariantEntry[] };

    for (const item of res.items ?? []) {
      if (!referencesBlog(item.source_blog, blogUid)) continue;
      const mapped = mapVariantEntry(item, locale, blogUid);
      if (mapped) variants.push(mapped);
    }
  }

  return variants;
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

/** Default crop spec used when an entry has no (or unparseable) `image_crop_spec`. */
const DEFAULT_CROP: Record<Channel, ImageCropSpec> = {
  linkedin: { aspectRatio: "1200x627", width: 1200, height: 627 },
  x: { aspectRatio: "1200x675", width: 1200, height: 675 },
  instagram: { aspectRatio: "1080x1350", width: 1080, height: 1350 },
};

/** Map a raw Channel Variant entry onto our domain type. Returns null if unusable. */
function mapVariantEntry(
  item: RawVariantEntry,
  locale: Locale,
  blogUid: string,
): ChannelVariant | null {
  const channel = item.channel;
  if (!channel || !(CHANNELS as readonly string[]).includes(channel)) return null;
  const typedChannel = channel as Channel;

  const formattedText = item.formatted_text ?? "";
  return {
    uid: item.uid,
    channel: typedChannel,
    locale,
    formattedText,
    hashtags: Array.isArray(item.hashtags) ? item.hashtags.filter(Boolean) : [],
    charCount:
      typeof item.char_count === "number" ? item.char_count : formattedText.length,
    imageCropSpec: parseCropSpec(item.image_crop_spec, typedChannel),
    status: (item.status as VariantStatus) ?? "needs_review",
    sourceBlogUid: blogUid,
  };
}

/** Parse the JSON `image_crop_spec` string, tolerating absent / malformed values. */
function parseCropSpec(raw: unknown, channel: Channel): ImageCropSpec {
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as Partial<ImageCropSpec>;
      if (parsed && parsed.aspectRatio && parsed.width && parsed.height) {
        return {
          aspectRatio: parsed.aspectRatio,
          width: parsed.width,
          height: parsed.height,
          note: parsed.note,
        };
      }
    } catch {
      // Fall through to the per-channel default.
    }
  }
  return DEFAULT_CROP[channel];
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
  const stackLocale = await resolveStackLocale(variant.locale);
  const entry = (await stack
    .contentType(CHANNEL_VARIANT_CONTENT_TYPE)
    .entry(entryUid)
    .fetch({ locale: stackLocale })) as unknown as RawEntryHandle;

  Object.assign(entry, toEntryData(variant));
  await entry.update({ locale: stackLocale });
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

interface RawWorkflow {
  uid: string;
  name?: string;
  content_types?: string[];
  workflow_stages?: Array<{ uid: string; name?: string }>;
}

/**
 * Resolve the real workflow-stage uid for a stage NAME on the stack.
 *
 * Workflow stage uids are stack-specific and NOT knowable ahead of time, so we look
 * them up by the human-readable stage name. Returns `null` when no workflow (or no
 * matching stage) is configured — callers should treat that as a soft skip rather
 * than a hard failure, since the stack may simply have no workflow attached yet.
 */
export async function resolveWorkflowStageUid(stageName: string): Promise<string | null> {
  const stack = getStack();
  try {
    const res = (await (stack as unknown as {
      workflow(): { fetchAll(): Promise<{ items?: RawWorkflow[] }> };
    })
      .workflow()
      .fetchAll()) as { items?: RawWorkflow[] };
    for (const wf of res.items ?? []) {
      const applies = !wf.content_types?.length || wf.content_types.includes(BLOG_POST_CONTENT_TYPE);
      if (!applies) continue;
      const stage = (wf.workflow_stages ?? []).find((s) => s.name === stageName);
      if (stage?.uid) return stage.uid;
    }
  } catch {
    // No workflow configured / not accessible — treated as a soft skip by callers.
  }
  return null;
}

/**
 * Move a Blog Post entry to a workflow stage (e.g. "Needs Review").
 *
 * Resolves the stack-specific stage uid by name. If the stack has no matching
 * workflow stage, this is a graceful no-op (reported via the return value) — the
 * review state is still captured on each Channel Variant's `status` field.
 */
export async function setBlogWorkflowStage(
  entryUid: string,
  stageName: WorkflowStage,
  locale: Locale = "en",
): Promise<{ moved: boolean; reason?: string }> {
  const stack = getStack();
  const stageUid = await resolveWorkflowStageUid(stageName);
  if (!stageUid) {
    return {
      moved: false,
      reason: `No workflow stage "${stageName}" is configured on the stack; skipping workflow move.`,
    };
  }
  const stackLocale = await resolveStackLocale(locale);
  const entry = stack.contentType(BLOG_POST_CONTENT_TYPE).entry(entryUid);
  await entry.setWorkflowStage({
    workflow_stage: { uid: stageUid, comment: `Moved to "${stageName}" by distribution agent.` },
    locale: stackLocale,
  });
  return { moved: true };
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

/** Minimal shape we read off a queried Channel Variant entry. */
interface RawVariantEntry {
  uid?: string;
  channel?: string;
  formatted_text?: string;
  hashtags?: string[] | null;
  char_count?: number;
  image_crop_spec?: string | null;
  status?: string;
  source_blog?: unknown;
  [key: string]: unknown;
}

/** Minimal shape we read off a fetched Blog Post entry. */
interface RawBlogEntry {
  title: string;
  body?: string;
  summary?: string;
  key_claims?: string[];
  /** File field: asset uid string by default, or a resolved asset object with `include[]`. */
  featured_image?: string | { uid?: string; url?: string } | null;
}

/** An entry handle we can mutate + update (subset of the SDK Entry). */
interface RawEntryHandle {
  update(param?: { locale?: string }): Promise<unknown>;
  [key: string]: unknown;
}
