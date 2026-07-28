/**
 * Sample fixture: a filled flu-vaccination campaign for the FICTIONAL
 * "Cascade Regional Health" system. Lets `/preview` render 3 channels × 3 locales
 * WITHOUT any live Contentstack / AI credentials.
 */

import type { BlogPost, Channel, ChannelVariant, ImageCropSpec, Locale } from "./types";

export const SAMPLE_BLOG: BlogPost = {
  uid: "blt_sample_flu_2026",
  locale: "en",
  title: "Get Your Flu Shot This Fall at Cascade Regional Health",
  summary:
    "Flu season is coming. Free and low-cost flu vaccines are available at all Cascade Regional Health clinics.",
  body: [
    "Fall is here, and so is flu season. At Cascade Regional Health, we make it easy for our neighbors to stay healthy.",
    "The seasonal flu vaccine helps reduce your chance of getting sick and can make symptoms milder if you do catch the flu.",
    "Vaccines are recommended for everyone 6 months and older by public health authorities. Walk-ins are welcome at all our community clinics this fall, and most insurance plans cover the cost.",
    "Talk with your care team about what is right for you and your family.",
  ].join("\n\n"),
  keyClaims: [
    "The flu vaccine helps reduce your chance of getting sick.",
    "The flu vaccine can make symptoms milder if you do catch the flu.",
    "Vaccines are recommended for everyone 6 months and older.",
    "Walk-ins are welcome and most insurance plans cover the cost.",
  ],
};

const CROP: Record<Channel, ImageCropSpec> = {
  linkedin: { aspectRatio: "1200x627", width: 1200, height: 627, note: "Link/share landscape card" },
  x: { aspectRatio: "1200x675", width: 1200, height: 675, note: "16:9 in-feed image" },
  instagram: { aspectRatio: "1080x1350", width: 1080, height: 1350, note: "4:5 portrait feed post" },
};

function v(
  channel: Channel,
  locale: Locale,
  formattedText: string,
  hashtags: string[],
): ChannelVariant {
  return {
    uid: `var_${channel}_${locale}`,
    channel,
    locale,
    formattedText,
    hashtags,
    charCount: formattedText.length,
    imageCropSpec: CROP[channel],
    status: "needs_review",
    sourceBlogUid: SAMPLE_BLOG.uid,
    factCheck: {
      pass: true,
      disclaimerPresent: true,
      unsupportedClaims: [],
      reasons: ["All claims supported by source and disclaimer present."],
    },
  };
}

export const SAMPLE_VARIANTS: ChannelVariant[] = [
  // ── LinkedIn ─────────────────────────────────────────────
  v(
    "linkedin",
    "en",
    "Fall is here — and so is flu season. 🍂\n\nAt Cascade Regional Health, protecting our community starts with simple steps. The seasonal flu vaccine can lower your chance of getting sick and ease symptoms if you do. Walk-ins are welcome at all our community clinics, and most insurance plans cover the cost.\n\nThis is general information, not medical advice. Talk to your health care provider about the flu vaccine.",
    ["CommunityHealth", "FluSeason", "PublicHealth"],
  ),
  v(
    "linkedin",
    "es",
    "Llegó el otoño… y también la temporada de gripe. 🍂\n\nEn Cascade Regional Health, cuidar a nuestra comunidad empieza con pasos sencillos. La vacuna contra la influenza puede reducir su riesgo de enfermarse y aliviar los síntomas. Le atendemos sin cita en todas nuestras clínicas comunitarias, y la mayoría de los seguros cubren el costo.\n\nEsta es información general, no un consejo médico. Consulte a su proveedor de salud sobre la vacuna contra la influenza.",
    ["SaludComunitaria", "TemporadaDeGripe", "SaludPública"],
  ),
  v(
    "linkedin",
    "fr",
    "L'automne est là… tout comme la saison de la grippe. 🍂\n\nChez Cascade Regional Health, protéger notre communauté commence par des gestes simples. Le vaccin antigrippal peut réduire le risque de tomber malade et atténuer les symptômes. Sans rendez-vous dans toutes nos cliniques de quartier, et la plupart des assurances couvrent les frais.\n\nCeci est une information générale et non un avis médical. Consultez votre professionnel de santé au sujet du vaccin antigrippal.",
    ["SantéCommunautaire", "SaisonGrippale", "SantéPublique"],
  ),

  // ── X / Twitter (≤280 chars) ─────────────────────────────
  v(
    "x",
    "en",
    "🍂 Flu season is here. A flu shot can lower your chance of getting sick — and most plans cover it. Walk-ins welcome at Cascade Regional Health. Not medical advice; ask your provider.",
    ["FluSeason", "GetVaccinated"],
  ),
  v(
    "x",
    "es",
    "🍂 Llegó la temporada de gripe. La vacuna puede reducir el riesgo de enfermarse y la mayoría de seguros la cubren. Sin cita en Cascade Regional Health. No es consejo médico; consulte a su proveedor.",
    ["TemporadaDeGripe", "Vacúnate"],
  ),
  v(
    "x",
    "fr",
    "🍂 La saison de la grippe est là. Le vaccin peut réduire le risque de tomber malade et la plupart des assurances le couvrent. Sans RDV chez Cascade Regional Health. Pas un avis médical; demandez à votre médecin.",
    ["SaisonGrippale", "FaitesVousVacciner"],
  ),

  // ── Instagram ────────────────────────────────────────────
  v(
    "instagram",
    "en",
    "Cozy sweaters, falling leaves… and flu season. 🍂💉\n\nGood news: a flu shot is one of the easiest ways to look out for yourself and the people you love. Milder symptoms, fewer sick days, and most insurance covers it. Swing by any Cascade Regional Health clinic — no appointment needed!\n\nThis is general information, not medical advice. Talk to your health care provider about the flu vaccine.",
    [
      "FluShot",
      "FluSeason",
      "CommunityHealth",
      "CascadeRegionalHealth",
      "StayHealthy",
      "WellnessWednesday",
    ],
  ),
  v(
    "instagram",
    "es",
    "Suéteres calientitos, hojas que caen… y la temporada de gripe. 🍂💉\n\nBuenas noticias: vacunarte es una de las formas más fáciles de cuidarte y cuidar a quienes amas. Síntomas más leves, menos días de enfermedad, y la mayoría de los seguros lo cubren. Visita cualquier clínica de Cascade Regional Health — ¡sin cita!\n\nEsta es información general, no un consejo médico. Consulte a su proveedor de salud sobre la vacuna contra la influenza.",
    [
      "VacunaContraLaGripe",
      "TemporadaDeGripe",
      "SaludComunitaria",
      "CascadeRegionalHealth",
      "CuídateSano",
    ],
  ),
  v(
    "instagram",
    "fr",
    "Pulls douillets, feuilles qui tombent… et la saison de la grippe. 🍂💉\n\nBonne nouvelle : le vaccin antigrippal est l'un des moyens les plus simples de prendre soin de vous et de vos proches. Des symptômes plus légers, moins de jours de maladie, et la plupart des assurances le couvrent. Passez dans n'importe quelle clinique Cascade Regional Health — sans rendez-vous !\n\nCeci est une information générale et non un avis médical. Consultez votre professionnel de santé au sujet du vaccin antigrippal.",
    [
      "VaccinAntigrippal",
      "SaisonGrippale",
      "SantéCommunautaire",
      "CascadeRegionalHealth",
      "RestezEnBonneSanté",
    ],
  ),
];

/** Group sample variants by channel, ordered en/es/fr, for the preview grid. */
export function sampleVariantsByChannel(): Record<Channel, ChannelVariant[]> {
  const order: Locale[] = ["en", "es", "fr"];
  const byChannel = {
    linkedin: [] as ChannelVariant[],
    x: [] as ChannelVariant[],
    instagram: [] as ChannelVariant[],
  } satisfies Record<Channel, ChannelVariant[]>;
  for (const variant of SAMPLE_VARIANTS) byChannel[variant.channel].push(variant);
  for (const channel of Object.keys(byChannel) as Channel[]) {
    byChannel[channel].sort((a, b) => order.indexOf(a.locale) - order.indexOf(b.locale));
  }
  return byChannel;
}
