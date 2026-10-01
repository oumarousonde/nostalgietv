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

  const data = (await response.json()) as any;

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

  const data = (await response.json()) as any;
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

  const data = (await response.json()) as any;

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
  const details = (await detailsResponse.json()) as any;

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

    const seasonData = (await seasonResponse.json()) as any;
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

// ============================================================
// Plateformes officielles (streaming / location / achat) — données JustWatch via TMDB.
// OBLIGATION TMDB : afficher "Données fournies par JustWatch" partout où ces données
// sont montrées, sinon TMDB peut révoquer l'accès (voir maquette/nostalgietv-maquette.html).
// Ces données donnent le NOM des plateformes par pays, pas de lien direct vers l'épisode.
// ============================================================

export interface WatchProvider {
  name: string;
  logoUrl: string | null;
}

export interface WatchProviderCategories {
  flatrate: WatchProvider[]; // abonnement
  free: WatchProvider[];     // gratuit
  ads: WatchProvider[];      // gratuit avec publicité
  rent: WatchProvider[];     // location
  buy: WatchProvider[];      // achat
}

export interface WatchProvidersInfo {
  country: string;          // pays dont proviennent les données (code ISO, ex. "FR")
  requestedCountry: string | null;
  isFallback: boolean;      // true si on n'avait rien pour le pays demandé
  link: string | null;      // page TMDB/JustWatch avec le détail et les liens directs
  categories: WatchProviderCategories;
}

// TMDB renvoie TOUS les pays en un seul appel : on met cette réponse en mémoire 12 h
// pour ne pas la redemander à chaque visiteur (la mémoire est propre à chaque instance
// serverless, donc c'est un simple coup de pouce, pas une garantie).
const WATCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const watchCache = new Map<string, { at: number; results: Record<string, any> }>();

function mapProviders(list: any[] | undefined): WatchProvider[] {
  return (list ?? []).map((p: any) => ({
    name: p.provider_name,
    logoUrl: p.logo_path ? `https://image.tmdb.org/t/p/w45${p.logo_path}` : null,
  }));
}

function hasAnyProvider(c: WatchProviderCategories): boolean {
  return Object.values(c).some((list) => list.length > 0);
}

/**
 * Où regarder légalement, pour le pays du visiteur (code ISO fourni par Vercel).
 * Si TMDB n'a rien pour ce pays, on retombe sur la France puis les États-Unis et on le
 * signale (isFallback) plutôt que d'afficher une info fausse comme si elle était locale.
 * Retourne null si aucune plateforme n'est connue nulle part.
 */
export async function fetchWatchProviders(
  tmdbId: number,
  mediaType: "tv" | "movie",
  preferredCountry?: string | null
): Promise<WatchProvidersInfo | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY manquante dans l'environnement");

  const cacheKey = `${mediaType}:${tmdbId}`;
  let results: Record<string, any>;
  const cached = watchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < WATCH_CACHE_TTL_MS) {
    results = cached.results;
  } else {
    const url = new URL(`${TMDB_BASE_URL}/${mediaType}/${tmdbId}/watch/providers`);
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Erreur TMDB watch providers (${response.status})`);
    const data = (await response.json()) as any;
    results = data.results ?? {};
    watchCache.set(cacheKey, { at: Date.now(), results });
  }

  const requested = preferredCountry ? preferredCountry.toUpperCase() : null;
  const order = [requested, "FR", "US"].filter((c, i, arr): c is string => !!c && arr.indexOf(c) === i);

  for (const country of order) {
    const entry = results[country];
    if (!entry) continue;
    const categories: WatchProviderCategories = {
      flatrate: mapProviders(entry.flatrate),
      free: mapProviders(entry.free),
      ads: mapProviders(entry.ads),
      rent: mapProviders(entry.rent),
      buy: mapProviders(entry.buy),
    };
    if (!hasAnyProvider(categories)) continue;
    return {
      country,
      requestedCountry: requested,
      isFallback: requested !== null && country !== requested, // pas de pays connu = pas un "repli"
      link: entry.link ?? null,
      categories,
    };
  }
  return null;
}
