/**
 * Fact-Checker step.
 *
 * For each generated variant it verifies two things before the human review gate:
 *   1. Medical claims in the variant are SUPPORTED by the source blog (flag hallucinations).
 *   2. The required (localized) disclaimer is present.
 *
 * The claim analysis (deep reasoning) is delegated to the reasoning seam in
 * `lib/eve.ts` — owned by Vercel eve when `REASONING_PROVIDER=eve`, or run in-process
 * via the Vercel AI SDK otherwise. The deterministic disclaimer check and the
 * pass/flag gating stay HERE: governance is owned by our orchestrator, not the model.
 */

import { requiredDisclaimer } from "./brandkit";
import { getReasoningService, type FactCheckReasoning } from "./eve";
import type { BlogPost, ChannelVariant, FactCheckResult } from "./types";

/** Loose, accent-insensitive containment check for the disclaimer backstop. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heuristic disclaimer presence check: looks for a distinctive fragment of the
 * required disclaimer rather than an exact string (the agent may reword slightly).
 */
export function hasRequiredDisclaimer(variant: ChannelVariant): boolean {
  const disclaimer = requiredDisclaimer(variant.locale);
  const haystack = normalize(variant.formattedText);
  // Distinctive phrases per locale that signal the disclaimer intent.
  const signals: Record<string, string[]> = {
    en: ["not medical advice", "health care provider", "talk to your"],
    es: ["no un consejo medico", "proveedor de salud", "consulte"],
    fr: ["non un avis medical", "professionnel de sante", "consultez"],
  };
  const localeSignals = signals[variant.locale] ?? [];
  const signalHit = localeSignals.some((sig) => haystack.includes(normalize(sig)));
  const exactish = haystack.includes(normalize(disclaimer).slice(0, 25));
  return signalHit || exactish;
}

/**
 * Empty assessment used as a safe backstop when the batched model response omits a
 * locale. The deterministic disclaimer check + gating below still run, so a missing
 * model assessment can never silently "pass" a variant with no disclaimer.
 */
const EMPTY_ASSESSMENT: FactCheckReasoning = {
  unsupportedClaims: [],
  prohibitedClaimsFound: [],
  reasoning: "",
};

/**
 * Combine the model's claim analysis for one variant with our DETERMINISTIC governance:
 * the required-disclaimer backstop and the pass/flag gating. Governance is owned by the
 * orchestrator, not the model — so this runs regardless of what the model returned.
 */
function gateAssessment(
  variant: ChannelVariant,
  assessment: FactCheckReasoning,
): FactCheckResult {
  const disclaimerPresent = hasRequiredDisclaimer(variant);

  const unsupportedClaims = [...assessment.unsupportedClaims, ...assessment.prohibitedClaimsFound];
  const pass = unsupportedClaims.length === 0 && disclaimerPresent;

  const reasons: string[] = [];
  if (assessment.reasoning) reasons.push(assessment.reasoning);
  if (!disclaimerPresent) reasons.push("Required disclaimer is missing.");
  if (assessment.unsupportedClaims.length) {
    reasons.push(`Unsupported claim(s): ${assessment.unsupportedClaims.join("; ")}`);
  }
  if (assessment.prohibitedClaimsFound.length) {
    reasons.push(`Prohibited claim(s): ${assessment.prohibitedClaimsFound.join("; ")}`);
  }
  if (pass) reasons.push("All claims supported by source and disclaimer present.");

  return { pass, disclaimerPresent, unsupportedClaims, reasons };
}

/**
 * Fact-check ALL locale variants of ONE channel in a single reasoning call, then apply
 * the deterministic disclaimer backstop + pass/flag gating to each. Batching collapses
 * the per-variant fan-out (3 → 1 Gateway call per channel).
 *
 * The claim analysis runs through the reasoning seam (needs a configured provider at
 * runtime); the deterministic checks run regardless. Only invoked from the webhook
 * pipeline, so the project builds/typechecks without any credentials. Returns one
 * `FactCheckResult` per input variant, in the same order.
 */
export async function factCheckChannel(
  source: BlogPost,
  variants: ChannelVariant[],
): Promise<FactCheckResult[]> {
  if (variants.length === 0) return [];

  const reasoning = getReasoningService();
  const { byLocale } = await reasoning.factCheckChannel({ source, variants });

  return variants.map((variant) => gateAssessment(variant, byLocale[variant.locale] ?? EMPTY_ASSESSMENT));
}

/**
 * Fact-check the ENTIRE set of variants (all channels/locales) in a SINGLE reasoning
 * call, then apply the deterministic disclaimer backstop + pass/flag gating to each.
 * This is the maximal batching (9 → 1 Gateway call) the pipeline uses to stay well under
 * the webhook timeout on rate-limited tiers.
 *
 * Governance still runs per variant regardless of the model output. Returns one
 * `FactCheckResult` per input variant, in the same order.
 */
export async function factCheckAll(
  source: BlogPost,
  variants: ChannelVariant[],
): Promise<FactCheckResult[]> {
  if (variants.length === 0) return [];

  const reasoning = getReasoningService();
  const { byChannel } = await reasoning.factCheckMatrix({ source, variants });

  return variants.map((variant) =>
    gateAssessment(variant, byChannel[variant.channel]?.[variant.locale] ?? EMPTY_ASSESSMENT),
  );
}

/** Apply a fact-check result to a variant, setting status to flagged/needs_review. */
export function applyFactCheck(
  variant: ChannelVariant,
  result: FactCheckResult,
): ChannelVariant {
  return {
    ...variant,
    factCheck: result,
    status: result.pass ? "needs_review" : "flagged",
  };
}
