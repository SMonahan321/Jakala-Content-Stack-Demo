import Link from "next/link";

import { SAMPLE_BLOG, sampleVariantsByChannel } from "@/lib/sample-data";
import type { Channel, ChannelVariant, Locale } from "@/lib/types";

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

export default function PreviewPage() {
  const byChannel = sampleVariantsByChannel();

  return (
    <main className="container">
      <Link href="/" style={{ fontSize: 14 }}>
        ← Back
      </Link>
      <h1 style={{ fontSize: 34, margin: "10px 0 2px" }}>Channel preview</h1>
      <p style={{ color: "var(--muted)", maxWidth: 760 }}>
        Source blog: <strong style={{ color: "var(--text)" }}>{SAMPLE_BLOG.title}</strong>. Below,
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
