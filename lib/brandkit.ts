/**
 * Brand Kit — fictional health system brand voice + healthcare compliance rules.
 *
 * In production this lives in Contentstack (Brand Kit) and is fetched at runtime.
 * Here it is a structured config used to *ground* the transcreation agent and the
 * fact-checker. The health system below is entirely FICTIONAL.
 */

import type { Channel, Locale } from "./types";

export interface BrandKit {
  brandName: string;
  voice: {
    personality: string[];
    tone: string;
    dos: string[];
    donts: string[];
  };
  compliance: {
    /** Disclaimer text that MUST appear (localized) on every public variant. */
    requiredDisclaimer: Record<Locale, string>;
    /** Claims we must never make (unsupported / prohibited). */
    prohibitedClaims: string[];
    /** Guidance the agent must follow when handling medical claims. */
    claimGuidance: string[];
  };
  /** Per-channel formatting expectations the agent should respect. */
  channelStyle: Record<
    Channel,
    { maxChars: number; hashtagCount: [number, number]; notes: string }
  >;
}

export const BRAND_KIT: BrandKit = {
  brandName: "Cascade Regional Health",
  voice: {
    personality: ["trustworthy", "warm", "clear", "community-first"],
    tone: "Reassuring and plain-language. We inform, we never scare. We speak to neighbors, not patients.",
    dos: [
      "Use plain, 8th-grade-reading-level language.",
      "Lead with the community benefit and an easy next step.",
      "Be inclusive and welcoming to all ages and backgrounds.",
      "Cite that guidance comes from care teams / public health authorities.",
    ],
    donts: [
      "No fear-mongering or alarmist language.",
      "No absolute guarantees about outcomes.",
      "No medical advice that replaces talking to a clinician.",
      "No stigmatizing language about illness.",
    ],
  },
  compliance: {
    requiredDisclaimer: {
      en: "This is general information, not medical advice. Talk to your health care provider about your health.",
      es: "Esta es información general, no un consejo médico. Consulte a su proveedor de salud.",
      fr: "Ceci est une information générale et non un avis médical. Consultez votre professionnel de santé.",
    },
    prohibitedClaims: [
      "Guarantees of 100% effectiveness or that a treatment/vaccine prevents all illness.",
      "Any specific efficacy percentage or statistic not present in the source blog.",
      "Claims that a treatment or vaccine cures or treats a condition beyond what the source states.",
      "Claims that a treatment or vaccine is required by law.",
      "Invented study citations or scientific claims not supported by the source.",
    ],
    claimGuidance: [
      "Only state medical facts that are explicitly supported by the source blog post.",
      "Do not invent statistics, efficacy numbers, or study citations.",
      "Every public-facing variant must include the required disclaimer for its locale.",
      "Encourage readers to consult their care provider for personal decisions.",
    ],
  },
  channelStyle: {
    linkedin: {
      maxChars: 3000,
      hashtagCount: [2, 4],
      notes:
        "Professional, community-health leadership voice. 1–2 short paragraphs, a clear CTA, a few professional hashtags.",
    },
    x: {
      maxChars: 280,
      hashtagCount: [1, 3],
      notes:
        "Punchy single post under 280 chars including hashtags. One clear takeaway + CTA. Disclaimer may be abbreviated but must remain accurate.",
    },
    instagram: {
      maxChars: 2200,
      hashtagCount: [5, 10],
      notes:
        "Warm, visual caption. Friendly hook, short lines/emojis ok, a block of relevant hashtags at the end.",
    },
  },
};

/** Convenience: the disclaimer required for a given locale. */
export function requiredDisclaimer(locale: Locale): string {
  return BRAND_KIT.compliance.requiredDisclaimer[locale];
}

/**
 * Concise, channel-constrained disclaimer per locale. Used when a tight channel
 * (e.g. X, 280 chars) cannot fit the full disclaimer: it is deliberately short but
 * STILL contains the locale's core recognizable phrase (see `DISCLAIMER_CORE_PHRASE`)
 * so the fact-checker recognizes it. Never drop the disclaimer to save space — swap in
 * this form instead. Single source of truth shared by the generation prompts (`lib/reasoning.ts`)
 * and the deterministic char-limit guardrail (`lib/agent.ts`).
 */
export const CONCISE_DISCLAIMER: Record<Locale, string> = {
  en: "This is general info, not medical advice.",
  es: "Información general, no consejo médico.",
  fr: "Information générale, non un avis médical.",
};

/** Convenience: the concise disclaimer for a given locale. */
export function conciseDisclaimer(locale: Locale): string {
  return CONCISE_DISCLAIMER[locale];
}

/**
 * Accent-insensitive CORE phrase that a disclaimer MUST contain to count as present.
 * Both the full and the concise disclaimers above contain it, so an abbreviated,
 * channel-constrained disclaimer is still detectable while genuinely-missing copy fails.
 * Shared by the loose detector (`lib/factcheck.ts`) and the char-limit guardrail.
 */
export const DISCLAIMER_CORE_PHRASE: Record<Locale, string> = {
  en: "medical advice",
  es: "consejo medico",
  fr: "avis medical",
};
