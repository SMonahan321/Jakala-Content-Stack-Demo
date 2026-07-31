import Link from "next/link";

const FLOW: { step: string; detail: string }[] = [
  { step: "Author", detail: "Edits the Blog Post entry (en) in Contentstack." },
  { step: "Trigger", detail: 'Moves workflow stage to "Ready for Distribution".' },
  { step: "Webhook", detail: "Contentstack calls the Vercel /api/webhook route." },
  { step: "Agent", detail: "Loads entry + Brand Kit; transcreates × 3 channels × 3 locales." },
  { step: "Fact-Check", detail: "Claims supported by source? Required disclaimer present?" },
  { step: "Write-back", detail: "Creates Channel Variant entries + es/fr locales via Management API." },
  { step: "Review gate", detail: 'Blog Post moves to "Needs Review"; a human approves.' },
  { step: "Distribute", detail: "Approval fires the real Slack push; preview cards render." },
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
        transcreates + reformats it into per-channel social variants across multiple locales, enforces
        brand and healthcare-compliance guardrails, gates on human review, then pushes to Slack.
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
        <li>Vercel app — the orchestrator; Vercel eve owns the deep reasoning (transcreation + fact-check).</li>
        <li>Brand Kit + Fact-Checker — grounding and compliance guardrails.</li>
        <li>Slack — the one real external push, gated behind human approval.</li>
      </ul>
    </main>
  );
}
