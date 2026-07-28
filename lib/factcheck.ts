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
import { getReasoningService } from "./eve";
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
 * Fact-check a single variant against its source blog.
 *
 * The claim analysis runs through the reasoning seam (needs a configured provider at
 * runtime); the deterministic disclaimer check runs regardless. Only invoked from the
 * webhook pipeline, so the project builds/typechecks without any credentials.
 */
export async function factCheckVariant(
  source: BlogPost,
  variant: ChannelVariant,
): Promise<FactCheckResult> {
  const disclaimerPresent = hasRequiredDisclaimer(variant);

  const reasoning = getReasoningService();
  const assessment = await reasoning.factCheck({ source, variant });

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
