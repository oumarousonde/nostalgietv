import { prisma } from "../lib/prisma";
import { Locale } from "../middleware/locale";
import { fetchShowDetails } from "./providers/tmdb";
import { translateText } from "./providers/geminiTranslate";

/**
 * Retourne le titre/synopsis d'une fiche dans la langue demandée.
 *
 * Deux sources de traduction bien distinctes, selon l'origine de la fiche :
 * - Fiche liée à TMDB (tmdbId non-null) → on redemande à TMDB dans la langue voulue.
 *   C'est une VRAIE traduction éditoriale (faite par des humains chez TMDB), pas une
 *   traduction automatique — à privilégier chaque fois que c'est possible.
 * - Fiche communautaire (tmdbId null, texte tapé par un utilisateur) → aucune source
 *   éditoriale n'existe dans l'autre langue, donc traduction automatique via Gemini.
 *   Moins fiable qu'une traduction humaine, mais c'est la seule option disponible.
 *
 * Résultat mis en cache dans ShowTranslation pour ne pas re-traduire à chaque requête.
 */
export async function getShowInLocale(showId: string, locale: Locale) {
  const show = await prisma.show.findUniqueOrThrow({ where: { id: showId } });

  // Déjà dans la langue d'origine : rien à traduire.
  if (show.originalLocale === locale) {
    return { title: show.title, synopsis: show.synopsis, translated: false };
  }

  const cached = await prisma.showTranslation.findUnique({
    where: { showId_locale: { showId, locale } },
  });
  if (cached) {
    return { title: cached.title, synopsis: cached.synopsis, translated: true };
  }

  let translated: { title: string; synopsis: string | null };

  if (show.tmdbId && show.mediaType) {
    translated = await fetchShowDetails(show.tmdbId, show.mediaType as "tv" | "movie", locale);
  } else {
    // Fiche communautaire : pas de source éditoriale, on traduit via Gemini.
    const translatedTitle = await translateText(show.title, locale);
    const translatedSynopsis = show.synopsis
      ? await translateText(show.synopsis, locale)
      : null;
    translated = { title: translatedTitle, synopsis: translatedSynopsis };
  }

  await prisma.showTranslation.upsert({
    where: { showId_locale: { showId, locale } },
    create: { showId, locale, title: translated.title, synopsis: translated.synopsis },
    update: { title: translated.title, synopsis: translated.synopsis },
  });

  return { ...translated, translated: true };
}
