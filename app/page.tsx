import Link from "next/link";

const FLOW: { step: string; detail: string }[] = [
  { step: "Author", detail: "Edit the Blog Post entry (en) in Contentstack." },
  { step: "Trigger", detail: 'Publish / move it to "Ready for Distribution".' },
  { step: "Webhook", detail: "Contentstack calls the Vercel /api/webhook route." },
  { step: "Agent", detail: "Loads entry + Brand Kit; transcreates × 3 channels × 3 locales via Vercel AI Gateway." },
  { step: "Fact-Check", detail: "Claims supported by source? Required disclaimer present?" },
  { step: "Write-back", detail: "Creates localized Channel Variant entries (en/es/fr) via the Management API." },
  { step: "Review gate", detail: "Variants land in a review state for human approval." },
  { step: "Preview", detail: "Approved variants render as channel-accurate cards. (Slack distribution: roadmap.)" },
];

export default function Home() {
  return (
    <main className="container">
      <p style={{ color: "var(--muted)", letterSpacing: 1, textTransform: "uppercase", fontSize: 13 }}>
        Contentstack Hackathon · Team JAKALA
      </p>
      <h1 style={{ fontSize: 44, margin: "8px 0 4px" }}>One post, shared everywhere</h1>
      <p style={{ fontSize: 18, color: "var(--muted)", maxWidth: 720 }}>
        An AI agent that takes a single source blog post authored in Contentstack and automatically
        transcreates + reformats it into per-channel social variants across multiple locales — enforcing
        brand and healthcare-compliance guardrails, with a human review gate. Contentstack is the system
        of record; a Vercel app orchestrates, and the deep reasoning runs on the Vercel AI SDK via
        Vercel AI Gateway.
      </p>

      <div style={{ margin: "28px 0" }}>
        <Link
          href="/preview"
          style={{
            display: "inline-block",
            background: "var(--accent)",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 10,
            fontWeight: 600,
          }}
        >
          Open the channel preview →
        </Link>
      </div>

      <h2 style={{ marginTop: 40 }}>How it works</h2>
      <ol style={{ paddingLeft: 20, maxWidth: 760 }}>
        {FLOW.map((f) => (
          <li key={f.step} style={{ margin: "10px 0" }}>
            <strong>{f.step}.</strong> <span style={{ color: "var(--muted)" }}>{f.detail}</span>
          </li>
        ))}
      </ol>

      <h2 style={{ marginTop: 40 }}>The pieces</h2>
      <ul style={{ color: "var(--muted)", maxWidth: 760 }}>
        <li>Contentstack — system of record: content modeling, localization, workflows, webhooks.</li>
        <li>Vercel AI SDK + AI Gateway — the external agent brain doing tone-aware transcreation (provider failover, keyless OIDC).</li>
        <li>Brand Kit + Fact-Checker — grounding and compliance guardrails.</li>
        <li>Preview cards — channel-accurate variants across locales. (Slack push: roadmap.)</li>
      </ul>
    </main>
  );
}
