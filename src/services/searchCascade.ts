import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { spendCreditsForSearch, InsufficientCreditsError } from "./creditLedger";
import { searchTmdbByTitle, fetchShowImages, fetchTvEpisodes, TmdbSearchResult } from "./providers/tmdb";
import { searchWithGemini, GeminiSearchInput, ImageFile } from "./providers/gemini";
import { scrapeUrlText, LinkScrapeError } from "./linkScraper";
import { getShowInLocale } from "./translations";
import { SEARCH_CASCADE } from "../config/providers";
import { Locale } from "../middleware/locale";
import { t } from "../i18n/messages";

export type SearchQuery =
  | { mode: "title"; value: string }
  | { mode: "description" | "link"; value: string }
  | { mode: "images"; files: ImageFile[] }
  | { mode: "video"; base64: string; mimeType: string };

/**
 * Ce que le front affiche pour que l'utilisateur puisse CONFIRMER visuellement
 * que c'est la bonne œuvre, avant d'aller plus loin — essentiel quand la recherche
 * est partie d'une description vague plutôt que d'un titre exact.
 * title/synopsis sont déjà dans la langue demandée (voir buildPreview → translations.ts).
 */
export interface ShowPreview {
  showId: string;
  title: string;
  originalYear: number | null;
  synopsis: string | null;
  posterUrl: string | null;
  images: string[]; // galerie de confirmation : captures/affiches, en plus du poster principal
}

export interface SearchOutcome {
  matchedShowId: string | null;
  providerUsed: string; // "tmdb" | "community" | "gemini" | "none"
  creditsSpent: number;
  message: string;
  preview: ShowPreview | null;
}

/**
 * Point d'entrée unique de la recherche. Respecte l'ordre défini dans
 * SEARCH_CASCADE : ne descend à l'étape suivante (donc au coût suivant)
 * que si l'étape précédente n'a rien donné.
 *
 * locale contrôle deux choses distinctes : la langue dans laquelle TMDB est interrogé
 * (une fiche jamais vue est créée directement dans cette langue), et la langue
 * d'affichage d'une fiche déjà existante mais stockée dans l'autre langue
 * (traduction à la volée, voir buildPreview).
 */
export async function runSearchCascade(
  userId: string,
  query: SearchQuery,
  locale: Locale = "fr"
): Promise<SearchOutcome> {
  // Étape 1 — TMDB, uniquement pertinent pour une recherche par titre, gratuite.
  if (query.mode === "title") {
    const tmdbResults = await searchTmdbByTitle(query.value, locale);
    if (tmdbResults.length > 0) {
      const show = await upsertShowFromTmdb(tmdbResults[0], locale);
      return {
        matchedShowId: show.id,
        providerUsed: "tmdb",
        creditsSpent: 0,
        message: t("foundViaTmdb", locale),
        preview: await buildPreview(show.id, locale),
      };
    }
  }

  // Étape 2 — recherche texte simple dans les fiches déjà créées par la communauté.
  // Ne s'applique qu'aux recherches par titre ou description : pour une image/vidéo,
  // il n'y a pas de texte à comparer (voir plus haut), et pour un lien, `query.value`
  // est une URL brute qui ne matchera jamais un titre de série — inutile d'interroger
  // la base pour ça, autant passer directement à Gemini qui traitera le contenu scrapé.
  //
  // NB : on cherche toujours dans Show.title tel que stocké (sa langue d'origine),
  // pas dans les traductions en cache — accepté comme limite pour l'instant : une
  // fiche communautaire ouverte en anglais ne remontera pas sur une recherche en
  // français tapée mot pour mot, seulement sur le titre original.
  if (query.mode === "title" || query.mode === "description") {
    const communityMatch = await prisma.show.findFirst({
      where: { title: { contains: query.value, mode: "insensitive" } },
    });
    if (communityMatch) {
      return {
        matchedShowId: communityMatch.id,
        providerUsed: "community",
        creditsSpent: 0,
        message: t("foundViaCommunity", locale),
        preview: await buildPreview(communityMatch.id, locale),
      };
    }
  }

  // Étape 3 — Gemini, uniquement pour description/image/vidéo/lien (pas pour un titre exact,
  // qui aurait déjà été traité à l'étape 1). Consomme des crédits : on débite AVANT l'appel
  // pour éviter qu'un utilisateur lance dix recherches en parallèle avec le même solde.
  if (query.mode !== "title") {
    // Cas particulier du lien : on scrape AVANT de débiter, pas après — un lien mort ou
    // invalide ne doit jamais coûter de crédit à l'utilisateur, ce serait injuste et
    // laisserait penser que le débit a "consommé" une vraie tentative de recherche.
    let scrapedLinkText: string | undefined;
    if (query.mode === "link") {
      try {
        scrapedLinkText = await scrapeUrlText(query.value, locale);
      } catch (err) {
        if (err instanceof LinkScrapeError) {
          return {
            matchedShowId: null,
            providerUsed: "none",
            creditsSpent: 0,
            message: err.message, // déjà en français seulement pour l'instant — voir docs/06-i18n.md
            preview: null,
          };
        }
        throw err;
      }
    }

    const geminiCost = SEARCH_CASCADE.find((p) => p.key === "gemini")!.costInCredits;
    const searchRequestId = crypto.randomUUID();

    try {
      await spendCreditsForSearch(userId, geminiCost, searchRequestId);
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        // On garde le TYPE InsufficientCreditsError, pas juste le message traduit —
        // sinon platform.routes.ts ne pourrait plus la détecter de façon fiable
        // pour renvoyer un 402 (voir le commentaire dans creditLedger.ts).
        throw new InsufficientCreditsError(t("insufficientCredits", locale));
      }
      throw err;
    }

    const geminiInput = toGeminiInput(query, scrapedLinkText);
    const result = await searchWithGemini(geminiInput);

    if (result.bestGuessTitle && result.confidence !== "low") {
      // On relance une recherche TMDB avec le titre deviné par Gemini pour récupérer
      // une fiche propre (poster, synopsis officiel, galerie) plutôt que de tout stocker
      // à la main — et surtout pour donner à l'utilisateur de quoi CONFIRMER visuellement
      // que l'IA a deviné juste, puisqu'une simple confiance "medium/high" ne suffit pas
      // à garantir que c'est la bonne œuvre.
      const tmdbFromGuess = await searchTmdbByTitle(result.bestGuessTitle, locale);
      if (tmdbFromGuess.length > 0) {
        const show = await upsertShowFromTmdb(tmdbFromGuess[0], locale);
        return {
          matchedShowId: show.id,
          providerUsed: "gemini",
          creditsSpent: geminiCost,
          message: `${locale === "en" ? "Identified by AI" : "Identifié par IA"} (${result.confidence}) : ${result.reasoning}`,
          preview: await buildPreview(show.id, locale),
        };
      }
    }

    return {
      matchedShowId: null,
      providerUsed: "gemini",
      creditsSpent: geminiCost,
      message: t("notFoundEvenWithAi", locale),
      preview: null,
    };
  }

  // Étape 1 avait échoué et ce n'était pas un mode Gemini-compatible : rien à faire de plus.
  return {
    matchedShowId: null,
    providerUsed: "none",
    creditsSpent: 0,
    message: t("notFoundFree", locale),
    preview: null,
  };
}

async function upsertShowFromTmdb(result: TmdbSearchResult, locale: Locale) {
  const show = await prisma.show.upsert({
    where: { tmdbId: result.tmdbId },
    create: {
      tmdbId: result.tmdbId,
      mediaType: result.mediaType,
      title: result.title,
      originalLocale: locale, // la fiche est créée dans la langue de CETTE recherche
      originalYear: result.originalYear,
      synopsis: result.synopsis,
      posterUrl: result.posterUrl,
      communityCreated: false,
    },
    update: {}, // déjà en base, rien à changer sur les champs simples
  });

  // On ne va chercher la galerie d'images qu'une seule fois par fiche (pas à chaque
  // recherche qui retombe dessus), pour ne pas multiplier les appels à l'API TMDB.
  const existingImages = await prisma.showImage.count({ where: { showId: show.id } });
  if (existingImages === 0) {
    try {
      const images = await fetchShowImages(result.tmdbId, result.mediaType);
      if (images.length > 0) {
        await prisma.showImage.createMany({
          data: images.map((img) => ({ showId: show.id, url: img.url, type: img.type })),
          skipDuplicates: true,
        });
      }
    } catch {
      // La galerie est un bonus de confort, pas une donnée critique : si l'appel échoue
      // (quota TMDB, réseau...), on continue sans bloquer la recherche elle-même.
    }
  }

  // Même logique pour les épisodes : récupérés une seule fois. C'est ce qui permet
  // à la grille "trouvé/manquant" d'avoir un sens réel au lieu d'être vide.
  const existingEpisodes = await prisma.episode.count({ where: { showId: show.id } });
  if (existingEpisodes === 0) {
    if (result.mediaType === "tv") {
      try {
        const episodes = await fetchTvEpisodes(result.tmdbId, locale);
        if (episodes.length > 0) {
          await prisma.episode.createMany({
            data: episodes.map((ep) => ({
              showId: show.id,
              season: ep.season,
              episode: ep.episode,
              title: ep.title,
              status: "missing", // personne n'a encore proposé de source à ce stade
            })),
            skipDuplicates: true,
          });
        }
      } catch {
        // Idem : ne bloque jamais la recherche elle-même si TMDB échoue ici.
      }
    } else {
      // Un film n'a pas de saisons/épisodes côté TMDB, mais le reste du schéma
      // (Source, statut found/missing, alertes) s'accroche toujours à un Episode —
      // donc on crée une ancre unique S01E01 pour que ces mécanismes s'appliquent pareil.
      try {
        await prisma.episode.create({
          data: { showId: show.id, season: 1, episode: 1, title: result.title, status: "missing" },
        });
      } catch (err) {
        // Même course possible que pour createMany ci-dessus (deux recherches simultanées
        // sur un film jamais vu) : P2002 = contrainte unique déjà satisfaite par l'autre
        // requête, donc rien d'anormal, on l'ignore silencieusement.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
          throw err;
        }
      }
    }
  }

  return show;
}

async function buildPreview(showId: string, locale: Locale): Promise<ShowPreview> {
  const show = await prisma.show.findUniqueOrThrow({
    where: { id: showId },
    include: { images: true },
  });

  // Traduit à la volée si la fiche n'est pas déjà dans la langue demandée
  // (voir translations.ts : TMDB pour les fiches automatiques, Gemini pour les
  // fiches communautaires, résultat mis en cache dans les deux cas).
  const { title, synopsis } = await getShowInLocale(showId, locale);

  return {
    showId: show.id,
    title,
    originalYear: show.originalYear,
    synopsis,
    posterUrl: show.posterUrl,
    images: show.images.map((img) => img.url),
  };
}

function toGeminiInput(query: SearchQuery, scrapedLinkText?: string): GeminiSearchInput {
  switch (query.mode) {
    case "description":
      return { type: "description", text: query.value };
    case "link":
      // scrapedLinkText est garanti défini ici : runSearchCascade scrape AVANT
      // d'appeler cette fonction et retourne plus tôt en cas d'échec du scraping.
      return { type: "link", scrapedText: scrapedLinkText! };
    case "images":
      return { type: "images", files: query.files };
    case "video":
      return { type: "video", base64: query.base64, mimeType: query.mimeType };
    default:
      throw new Error("Mode de recherche non pris en charge par Gemini");
  }
}
