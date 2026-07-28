/**
 * Shared domain types for "One post, shared everywhere".
 *
 * Contentstack is the system of record; these types mirror the content models
 * defined in `content-models/` and the payloads the Vercel agent produces.
 */

/** Social channels we fan out to. Only preview cards are rendered — no real posting. */
export const CHANNELS = ["linkedin", "x", "instagram"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Locales stored as native Contentstack locales. English is the source. */
export const LOCALES = ["en", "es", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

/** Contentstack workflow stages that gate the pipeline. */
export type WorkflowStage =
  | "Draft"
  | "Ready for Distribution"
  | "Needs Review"
  | "Approved"
  | "Published";

/** Source content type authored by a human in Contentstack. */
export interface BlogPost {
  uid: string;
  /** Locale the entry was authored in (source is always "en" for the demo). */
  locale: Locale;
  title: string;
  body: string;
  /** Optional summary/dek the author can provide. */
  summary?: string;
  /** Author-declared, source-of-truth medical claims (used by the fact-checker). */
  keyClaims?: string[];
}

/** Spec for how a channel wants its hero image cropped (mock — no real image ops). */
export interface ImageCropSpec {
  /** e.g. "1200x627", "1080x1080", "1080x1350" */
  aspectRatio: string;
  width: number;
  height: number;
  note?: string;
}

/**
 * Generated output. Each (channel × locale) combination is one Channel Variant
 * entry in Contentstack, referenced back to its source Blog Post.
 */
export interface ChannelVariant {
  /** Present once written back to Contentstack. */
  uid?: string;
  channel: Channel;
  locale: Locale;
  formattedText: string;
  hashtags: string[];
  charCount: number;
  imageCropSpec: ImageCropSpec;
  status: VariantStatus;
  /** uid of the source Blog Post entry. */
  sourceBlogUid: string;
  /** Attached by the fact-checker before the review gate. */
  factCheck?: FactCheckResult;
}

export type VariantStatus =
  | "generated"
  | "needs_review"
  | "flagged"
  | "approved"
  | "published";

/** Result of the fact-check step for a single variant. */
export interface FactCheckResult {
  pass: boolean;
  disclaimerPresent: boolean;
  /** Claims in the variant not supported by the source blog. */
  unsupportedClaims: string[];
  /** Human-readable reasons (why it passed or was flagged). */
  reasons: string[];
}

/** The (channel, locale) matrix the agent fans out across. */
export interface Target {
  channel: Channel;
  locale: Locale;
}
