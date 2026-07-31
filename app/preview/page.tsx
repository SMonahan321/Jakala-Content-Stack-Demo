import Link from "next/link";

import { getChannelVariantsForBlog, getLatestBlogWithVariants } from "@/lib/contentstack";
import { SAMPLE_BLOG, sampleVariantsByChannel } from "@/lib/sample-data";
import { CHANNELS } from "@/lib/types";
import type { Channel, ChannelVariant, Locale } from "@/lib/types";

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
        return {
          source: "live",
          blogTitle: `Live entry ${blogUid}`,
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
  const { source, blogTitle, byChannel } = await loadPreviewData();

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
                <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 8 }}>
                  {LOCALE_LABEL[variant.locale]}
                </div>
                <ChannelCard variant={variant} />
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

function ChannelCard({ variant }: { variant: ChannelVariant }) {
  switch (variant.channel) {
    case "linkedin":
      return <LinkedInCard variant={variant} />;
    case "x":
      return <XCard variant={variant} />;
    case "instagram":
      return <InstagramCard variant={variant} />;
  }
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

function LinkedInCard({ variant }: { variant: ChannelVariant }) {
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
      <ImagePlaceholder label={`Hero · ${variant.imageCropSpec.aspectRatio}`} ratio="1200 / 627" />
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

function XCard({ variant }: { variant: ChannelVariant }) {
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
            <ImagePlaceholder label={`Media · ${variant.imageCropSpec.aspectRatio}`} ratio="16 / 9" />
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

function InstagramCard({ variant }: { variant: ChannelVariant }) {
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
      <ImagePlaceholder label={`Photo · ${variant.imageCropSpec.aspectRatio}`} ratio="4 / 5" />
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
