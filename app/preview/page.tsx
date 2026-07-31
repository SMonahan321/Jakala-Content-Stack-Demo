import Link from "next/link";

import {
  getBlogPost,
  getChannelVariantsForBlog,
  getLatestBlogWithVariants,
} from "@/lib/contentstack";
import { SAMPLE_BLOG, sampleVariantsByChannel } from "@/lib/sample-data";
import { CHANNELS } from "@/lib/types";
import type {
  BlogPost,
  Channel,
  ChannelVariant,
  FactCheckResult,
  Locale,
} from "@/lib/types";

/**
 * Never statically prerender: the page reads live Contentstack data at request time
 * (and must fall back to the fixture at runtime when creds/entries are absent).
 */
export const dynamic = "force-dynamic";

/**
 * Explicit override for the source Blog Post whose channel variants we render.
 * When UNSET (the default), the page auto-follows whichever blog most recently had
 * `channel_variant` entries created — so a freshly published post's variants show up
 * without redeploying. Set `BLOG_ENTRY_UID` to pin the preview to a specific blog.
 */
const BLOG_ENTRY_UID_OVERRIDE = process.env.BLOG_ENTRY_UID;

type PreviewData = {
  source: "live" | "sample";
  blogTitle: string;
  /** Resolved source-blog hero image (live or sample fallback). */
  featuredImage?: BlogPost["featuredImage"];
  byChannel: Record<Channel, ChannelVariant[]>;
};

const LOCALE_ORDER: Locale[] = ["en", "es", "fr"];

/** Group variants by channel, ordered en/es/fr, matching the fixture shape. */
function groupByChannel(variants: ChannelVariant[]): Record<Channel, ChannelVariant[]> {
  const byChannel = {
    linkedin: [] as ChannelVariant[],
    x: [] as ChannelVariant[],
    instagram: [] as ChannelVariant[],
  } satisfies Record<Channel, ChannelVariant[]>;
  for (const variant of variants) byChannel[variant.channel].push(variant);
  for (const channel of CHANNELS) {
    byChannel[channel].sort(
      (a, b) => LOCALE_ORDER.indexOf(a.locale) - LOCALE_ORDER.indexOf(b.locale),
    );
  }
  return byChannel;
}

/**
 * Try to load the real Channel Variant entries for the source blog. On ANY failure
 * (missing creds, network error, or simply no entries yet) fall back to the static
 * fixture so the page always renders.
 */
async function loadPreviewData(): Promise<PreviewData> {
  try {
    // Honor an explicit override; otherwise auto-follow the blog whose channel
    // variants were most recently created/updated (null when none exist yet).
    const blogUid = BLOG_ENTRY_UID_OVERRIDE ?? (await getLatestBlogWithVariants());
    if (blogUid) {
      const variants = await getChannelVariantsForBlog(blogUid);
      if (variants.length > 0) {
        // Fetch the source blog to resolve its title + featured image (hero).
        // Non-fatal: a failure here still renders the variants without a hero.
        let blog: BlogPost | null = null;
        try {
          blog = await getBlogPost(blogUid);
        } catch {
          blog = null;
        }
        return {
          source: "live",
          blogTitle: blog?.title ?? `Live entry ${blogUid}`,
          featuredImage: blog?.featuredImage,
          byChannel: groupByChannel(variants),
        };
      }
    }
  } catch {
    // Swallow and fall back to the fixture below.
  }
  return {
    source: "sample",
    blogTitle: SAMPLE_BLOG.title,
    featuredImage: SAMPLE_BLOG.featuredImage,
    byChannel: sampleVariantsByChannel(),
  };
}

const CHANNEL_META: Record<
  Channel,
  { label: string; accent: string; badge: string }
> = {
  linkedin: { label: "LinkedIn", accent: "#0a66c2", badge: "in" },
  x: { label: "X", accent: "#000000", badge: "𝕏" },
  instagram: {
    label: "Instagram",
    accent: "linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)",
    badge: "◎",
  },
};

const LOCALE_LABEL: Record<Locale, string> = {
  en: "English (en)",
  es: "Español (es)",
  fr: "Français (fr)",
};

const CHANNEL_ORDER: Channel[] = ["linkedin", "x", "instagram"];

export default async function PreviewPage() {
  const { source, blogTitle, featuredImage, byChannel } = await loadPreviewData();
  const heroUrl = featuredImage?.url;
  const allVariants = CHANNEL_ORDER.flatMap((channel) => byChannel[channel]);

  return (
    <main className="container">
      <Link href="/" style={{ fontSize: 14 }}>
        ← Back
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0 2px" }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Channel preview</h1>
        <DataSourceBadge source={source} />
      </div>
      <p style={{ color: "var(--muted)", maxWidth: 760 }}>
        Source blog: <strong style={{ color: "var(--text)" }}>{blogTitle}</strong>. Below,
        each row is a channel and each column is a locale — the 3 × 3 fan-out the agent produces. These
        are mock preview cards (no real posting); only Slack receives a real push after approval.
      </p>

      <FactCheckSummary variants={allVariants} />

      <SourceHero image={featuredImage} title={blogTitle} />

      {CHANNEL_ORDER.map((channel) => (
        <section key={channel} style={{ marginTop: 36 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ChannelDot channel={channel} />
            {CHANNEL_META[channel].label}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 18,
            }}
          >
            {byChannel[channel].map((variant) => (
              <div key={`${channel}-${variant.locale}`}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>
                    {LOCALE_LABEL[variant.locale]}
                  </span>
                  <FactCheckBadge factCheck={variant.factCheck} />
                </div>
                <ChannelCard variant={variant} imageUrl={heroUrl} />
                <FactCheckReasons factCheck={variant.factCheck} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function DataSourceBadge({ source }: { source: "live" | "sample" }) {
  const isLive = source === "live";
  return (
    <span
      title={
        isLive
          ? "Rendering real channel_variant entries from the live Contentstack stack."
          : "No live entries/credentials — showing the static sample fixture."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.3,
        color: isLive ? "#0a7d33" : "var(--muted)",
        background: isLive ? "rgba(16,185,79,0.12)" : "rgba(148,163,184,0.14)",
        border: `1px solid ${isLive ? "rgba(16,185,79,0.35)" : "rgba(148,163,184,0.3)"}`,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: isLive ? "#10b94f" : "#94a3b8",
        }}
      />
      {isLive ? "Live data" : "Sample data"}
    </span>
  );
}

/* ── Fact-check surfacing ────────────────────────────────── */

type FactCheckState = "passed" | "flagged" | "unchecked";

/** Collapse a variant's `factCheck` into one of three render states. */
function factCheckState(factCheck?: FactCheckResult): FactCheckState {
  if (!factCheck) return "unchecked";
  return factCheck.pass ? "passed" : "flagged";
}

const FACT_CHECK_STYLE: Record<
  FactCheckState,
  { label: string; color: string; bg: string; border: string }
> = {
  passed: {
    label: "✓ Passed",
    color: "#0a7d33",
    bg: "rgba(16,185,79,0.12)",
    border: "rgba(16,185,79,0.35)",
  },
  flagged: {
    label: "⚠ Flagged",
    color: "#c02636",
    bg: "rgba(224,36,94,0.12)",
    border: "rgba(224,36,94,0.4)",
  },
  unchecked: {
    label: "— Not checked",
    color: "var(--muted)",
    bg: "rgba(148,163,184,0.14)",
    border: "rgba(148,163,184,0.3)",
  },
};

/** Small per-card fact-check verdict badge (passed / flagged / not-checked). */
function FactCheckBadge({ factCheck }: { factCheck?: FactCheckResult }) {
  const s = FACT_CHECK_STYLE[factCheckState(factCheck)];
  return (
    <span
      title={
        factCheck
          ? factCheck.pass
            ? "All claims supported and disclaimer present."
            : "Fact-check flagged this variant."
          : "This variant has no persisted fact-check result yet."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

/**
 * Compact reasons block shown under a card when the variant was flagged. Lists the
 * fact-check reasons and any unsupported/prohibited claims. Renders nothing when the
 * variant passed or has no fact-check result.
 */
function FactCheckReasons({ factCheck }: { factCheck?: FactCheckResult }) {
  if (!factCheck || factCheck.pass) return null;
  const { reasons, unsupportedClaims } = factCheck;
  if (!reasons.length && !unsupportedClaims.length) return null;
  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.45,
        color: "#8a1a29",
        background: "rgba(224,36,94,0.08)",
        border: "1px solid rgba(224,36,94,0.3)",
      }}
    >
      {reasons.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {unsupportedClaims.length > 0 && (
        <div style={{ marginTop: reasons.length ? 6 : 0 }}>
          <strong>Unsupported / prohibited:</strong> {unsupportedClaims.join("; ")}
        </div>
      )}
    </div>
  );
}

/**
 * Top-of-page fact-check summary across all rendered variants: pass/flag counts and,
 * when present, the list of flagged variants as `channel · locale — reason(s)`. Shows
 * a green all-clear line when everything passed, and notes any unchecked variants.
 */
function FactCheckSummary({ variants }: { variants: ChannelVariant[] }) {
  if (variants.length === 0) return null;

  const flagged = variants.filter((v) => factCheckState(v.factCheck) === "flagged");
  const passed = variants.filter((v) => factCheckState(v.factCheck) === "passed");
  const unchecked = variants.filter((v) => factCheckState(v.factCheck) === "unchecked");
  const hasFlags = flagged.length > 0;

  const counts = [
    `${passed.length} passed`,
    `${flagged.length} flagged`,
    ...(unchecked.length ? [`${unchecked.length} not checked`] : []),
  ].join(" · ");

  return (
    <section
      style={{
        marginTop: 18,
        padding: "14px 16px",
        borderRadius: 12,
        maxWidth: 760,
        background: hasFlags ? "rgba(224,36,94,0.06)" : "rgba(16,185,79,0.08)",
        border: `1px solid ${hasFlags ? "rgba(224,36,94,0.3)" : "rgba(16,185,79,0.3)"}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontWeight: 700,
          fontSize: 15,
          color: hasFlags ? "#c02636" : "#0a7d33",
        }}
      >
        {hasFlags ? "⚠ Fact-check found issues" : "✓ All variants passed fact-check"}
        <span style={{ fontWeight: 500, fontSize: 13, color: "var(--muted)" }}>{counts}</span>
      </div>

      {hasFlags && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
          {flagged.map((v) => (
            <li key={`${v.channel}-${v.locale}`}>
              <strong>
                {CHANNEL_META[v.channel].label} · {v.locale}
              </strong>
              {" — "}
              {factCheckReasonText(v.factCheck)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One-line reason summary for a flagged variant (reasons + unsupported claims). */
function factCheckReasonText(factCheck?: FactCheckResult): string {
  if (!factCheck) return "Flagged.";
  const parts = [...factCheck.reasons];
  if (factCheck.unsupportedClaims.length) {
    parts.push(`Unsupported: ${factCheck.unsupportedClaims.join("; ")}`);
  }
  return parts.length ? parts.join(" ") : "Flagged.";
}

function ChannelDot({ channel }: { channel: Channel }) {
  const meta = CHANNEL_META[channel];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: 7,
        background: meta.accent,
        color: "#fff",
        fontWeight: 700,
        fontSize: 14,
      }}
    >
      {meta.badge}
    </span>
  );
}

function ChannelCard({ variant, imageUrl }: { variant: ChannelVariant; imageUrl?: string }) {
  switch (variant.channel) {
    case "linkedin":
      return <LinkedInCard variant={variant} imageUrl={imageUrl} />;
    case "x":
      return <XCard variant={variant} imageUrl={imageUrl} />;
    case "instagram":
      return <InstagramCard variant={variant} imageUrl={imageUrl} />;
  }
}

/**
 * Shared source-blog hero: renders the resolved featured image once above the
 * channel grid. Falls back to the crop-spec placeholder when no image resolved.
 * Plain <img> (not next/image) so no remote-domain allowlist is required.
 */
function SourceHero({
  image,
  title,
}: {
  image?: BlogPost["featuredImage"];
  title: string;
}) {
  if (!image?.url) return null;
  return (
    <figure
      style={{
        margin: "22px 0 4px",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--border, #e0e0e0)",
        maxWidth: 760,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={image.title ?? title}
        style={{
          display: "block",
          width: "100%",
          maxHeight: 320,
          objectFit: "cover",
        }}
      />
      <figcaption style={{ color: "var(--muted)", fontSize: 12, padding: "8px 12px" }}>
        Source featured image{image.title ? ` · ${image.title}` : ""}
      </figcaption>
    </figure>
  );
}

/* ── Shared bits ─────────────────────────────────────────── */

function Hashtags({ tags, color }: { tags: string[]; color: string }) {
  if (!tags.length) return null;
  return (
    <div style={{ marginTop: 8, color, fontSize: 13, fontWeight: 500 }}>
      {tags.map((t) => `#${t}`).join(" ")}
    </div>
  );
}

function ImagePlaceholder({ label, ratio }: { label: string; ratio: string }) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg,#dfe7f5,#c3d2ef)",
        color: "#42506e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 600,
        aspectRatio: ratio,
        width: "100%",
      }}
    >
      {label}
    </div>
  );
}

/**
 * Card image slot: renders the resolved source featured image (cropped to the
 * channel's aspect ratio via object-fit) when a URL is available, otherwise falls
 * back to the crop-spec placeholder. Plain <img> keeps next.config domain-free.
 */
function ImageSlot({
  imageUrl,
  label,
  ratio,
}: {
  imageUrl?: string;
  label: string;
  ratio: string;
}) {
  if (!imageUrl) return <ImagePlaceholder label={label} ratio={ratio} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={label}
      style={{ display: "block", width: "100%", aspectRatio: ratio, objectFit: "cover" }}
    />
  );
}

function CharCount({ count, limit }: { count: number; limit?: number }) {
  const over = limit ? count > limit : false;
  return (
    <span style={{ color: over ? "#e0245e" : "#8a95a5", fontSize: 12 }}>
      {count}
      {limit ? ` / ${limit}` : ""} chars
    </span>
  );
}

/* ── LinkedIn ────────────────────────────────────────────── */

function LinkedInCard({ variant, imageUrl }: { variant: ChannelVariant; imageUrl?: string }) {
  return (
    <div
      style={{
        background: "#fff",
        color: "#1d2226",
        borderRadius: 10,
        border: "1px solid #e0e0e0",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: 10, padding: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "#0a66c2",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
          }}
        >
          CR
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Cascade Regional Health</div>
          <div style={{ color: "#5e6d7a", fontSize: 12 }}>Community Health System · Promoted</div>
        </div>
      </div>
      <div style={{ padding: "0 12px 12px", fontSize: 14, whiteSpace: "pre-wrap" }}>
        {variant.formattedText}
        <Hashtags tags={variant.hashtags} color="#0a66c2" />
      </div>
      <ImageSlot
        imageUrl={imageUrl}
        label={`Hero · ${variant.imageCropSpec.aspectRatio}`}
        ratio="1200 / 627"
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderTop: "1px solid #eee",
          color: "#5e6d7a",
          fontSize: 12,
        }}
      >
        <span>👍 Like · 💬 Comment · ↪ Share</span>
        <CharCount count={variant.charCount} />
      </div>
    </div>
  );
}

/* ── X / Twitter ─────────────────────────────────────────── */

function XCard({ variant, imageUrl }: { variant: ChannelVariant; imageUrl?: string }) {
  return (
    <div
      style={{
        background: "#000",
        color: "#e7e9ea",
        borderRadius: 14,
        border: "1px solid #2f3336",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "#1d9bf0",
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14 }}>
            <strong>Cascade Regional Health</strong>{" "}
            <span style={{ color: "#71767b" }}>@CascadeHealth · 1h</span>
          </div>
          <div style={{ fontSize: 15, whiteSpace: "pre-wrap", marginTop: 2 }}>
            {variant.formattedText}
            <Hashtags tags={variant.hashtags} color="#1d9bf0" />
          </div>
          <div style={{ marginTop: 10, borderRadius: 14, overflow: "hidden" }}>
            <ImageSlot
              imageUrl={imageUrl}
              label={`Media · ${variant.imageCropSpec.aspectRatio}`}
              ratio="16 / 9"
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 10,
              color: "#71767b",
              fontSize: 13,
            }}
          >
            <span>💬 4 · 🔁 12 · ♥ 88</span>
            <CharCount count={variant.charCount} limit={280} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Instagram ───────────────────────────────────────────── */

function InstagramCard({ variant, imageUrl }: { variant: ChannelVariant; imageUrl?: string }) {
  return (
    <div
      style={{
        background: "#fff",
        color: "#262626",
        borderRadius: 10,
        border: "1px solid #dbdbdb",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: "linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)",
            padding: 2,
          }}
        >
          <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#fff" }} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>cascaderegionalhealth</div>
      </div>
      <ImageSlot
        imageUrl={imageUrl}
        label={`Photo · ${variant.imageCropSpec.aspectRatio}`}
        ratio="4 / 5"
      />
      <div style={{ padding: "8px 10px", display: "flex", gap: 12, fontSize: 18 }}>
        <span>♡</span>
        <span>💬</span>
        <span>➤</span>
      </div>
      <div style={{ padding: "0 10px 12px", fontSize: 13, whiteSpace: "pre-wrap" }}>
        <strong>cascaderegionalhealth</strong> {variant.formattedText}
        <Hashtags tags={variant.hashtags} color="#00376b" />
        <div style={{ marginTop: 8 }}>
          <CharCount count={variant.charCount} />
        </div>
      </div>
    </div>
  );
}
