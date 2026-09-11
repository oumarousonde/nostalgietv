/**
 * Client TMDB (The Movie Database). Étape 1 de la cascade : gratuite, quasi illimitée,
 * ne consomme aucun crédit utilisateur. Nécessite TMDB_API_KEY dans l'environnement.
 *
 * Langue : TMDB accepte un paramètre "language" (ex. fr-FR, en-US) et renvoie le titre/
 * synopsis officiels DANS cette langue quand ils existent — pas une traduction automatique
 * approximative, une vraie traduction éditoriale de leur base. C'est pour ça qu'on préfère
 * repasser par TMDB plutôt que par Gemini pour traduire une fiche déjà identifiée via TMDB
 * (voir src/services/translations.ts).
 */

import { Locale } from "../../middleware/locale";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function toTmdbLanguage(locale: Locale): string {
  return locale === "en" ? "en-US" : "fr-FR";
}

export interface TmdbSearchResult {
  tmdbId: number;
  mediaType: "tv" | "movie";
  title: string;
  originalYear: number | null;
  synopsis: string | null;
  posterUrl: string | null;
}

export async function searchTmdbByTitle(
  title: string,
  locale: Locale = "fr"
): Promise<TmdbSearchResult[]> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY manquante dans l'environnement");

  const url = new URL(`${TMDB_BASE_URL}/search/multi`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", title);
  url.searchParams.set("language", toTmdbLanguage(locale));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Erreur TMDB (${response.status})`);
  }

  const data = await response.json();

  return data.results
    .filter((r: any) => r.media_type === "tv" || r.media_type === "movie")
    .map((r: any) => ({
      tmdbId: r.id,
      mediaType: r.media_type,
      title: r.name ?? r.title,
      originalYear: parseYear(r.first_air_date ?? r.release_date),
      synopsis: r.overview || null,
      posterUrl: r.poster_path
        ? `https://image.tmdb.org/t/p/w342${r.poster_path}`
        : null,
    }));
}

/**
 * Récupère titre + résumé d'une fiche déjà identifiée (on a déjà son tmdbId), dans
 * une langue précise — utilisé pour traduire à la demande une fiche existante sans
 * refaire une recherche complète. Voir src/services/translations.ts.
 */
export async function fetchShowDetails(
  tmdbId: number,
  mediaType: "tv" | "movie",
  locale: Locale
): Promise<{ title: string; synopsis: string | null }> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY manquante dans l'environnement");

  const url = new URL(`${TMDB_BASE_URL}/${mediaType}/${tmdbId}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", toTmdbLanguage(locale));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Erreur TMDB détails (${response.status})`);
  }

  const data = await response.json();
  return {
    title: data.name ?? data.title,
    synopsis: data.overview || null,
  };
}

export interface TmdbImage {
  url: string;
  type: "poster" | "backdrop";
}

/**
 * Récupère une galerie d'images (affiches + captures) pour confirmation visuelle.
 * Les images elles-mêmes n'ont pas de langue (ce sont des photos), donc pas besoin
 * de paramètre locale ici — seul le texte (titre/résumé) doit être traduit.
 * Limité à 6 images (4 backdrops + 2 posters) pour ne pas surcharger l'écran.
 */
export async function fetchShowImages(
  tmdbId: number,
  mediaType: "tv" | "movie"
): Promise<TmdbImage[]> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY manquante dans l'environnement");

  const url = new URL(`${TMDB_BASE_URL}/${mediaType}/${tmdbId}/images`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("include_image_language", "null");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Erreur TMDB images (${response.status})`);
  }

  const data = await response.json();

  const backdrops: TmdbImage[] = (data.backdrops ?? [])
    .slice(0, 4)
    .map((img: any) => ({
      url: `https://image.tmdb.org/t/p/w500${img.file_path}`,
      type: "backdrop" as const,
    }));

  const posters: TmdbImage[] = (data.posters ?? [])
    .slice(0, 2)
    .map((img: any) => ({
      url: `https://image.tmdb.org/t/p/w342${img.file_path}`,
      type: "poster" as const,
    }));

  return [...backdrops, ...posters];
}

function parseYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

export interface TmdbEpisode {
  season: number;
  episode: number;
  title: string | null;
}

/**
 * Récupère la vraie liste d'épisodes d'une série TMDB, saison par saison, dans la
 * langue demandée. NB : les épisodes ne sont récupérés/stockés qu'UNE fois (voir
 * searchCascade.ts), dans la langue de la première recherche qui a créé la fiche —
 * traduire titre par titre chaque épisode multiplierait les appels API pour un gain
 * marginal (les titres d'épisodes sont rarement ce qui aide à confirmer une œuvre,
 * contrairement au titre et au résumé de la série elle-même).
 */
export async function fetchTvEpisodes(
  tmdbId: number,
  locale: Locale = "fr"
): Promise<TmdbEpisode[]> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY manquante dans l'environnement");

  const detailsUrl = new URL(`${TMDB_BASE_URL}/tv/${tmdbId}`);
  detailsUrl.searchParams.set("api_key", apiKey);
  detailsUrl.searchParams.set("language", toTmdbLanguage(locale));

  const detailsResponse = await fetch(detailsUrl.toString());
  if (!detailsResponse.ok) {
    throw new Error(`Erreur TMDB détails série (${detailsResponse.status})`);
  }
  const details = await detailsResponse.json();

  const seasonNumbers: number[] = (details.seasons ?? [])
    .map((s: any) => s.season_number)
    .filter((n: number) => n > 0);

  const episodes: TmdbEpisode[] = [];

  for (const seasonNumber of seasonNumbers) {
    const seasonUrl = new URL(`${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNumber}`);
    seasonUrl.searchParams.set("api_key", apiKey);
    seasonUrl.searchParams.set("language", toTmdbLanguage(locale));

    const seasonResponse = await fetch(seasonUrl.toString());
    if (!seasonResponse.ok) continue;

    const seasonData = await seasonResponse.json();
    for (const ep of seasonData.episodes ?? []) {
      episodes.push({
        season: seasonNumber,
        episode: ep.episode_number,
        title: ep.name || null,
      });
    }
  }

  return episodes;
}
