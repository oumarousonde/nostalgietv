/**
 * Recherche YouTube — outil d'AIDE pour l'admin, pas une source automatique.
 * Contrairement à TMDB (données officielles) ou à une Source déjà vérifiée par
 * la modération, une vidéo YouTube n'a AUCUNE garantie de légalité — beaucoup
 * de rediffusions y sont mises en ligne sans autorisation. Ces résultats ne
 * sont donc jamais insérés automatiquement comme Source "vérifiée" ; l'admin
 * les consulte, décide, et si besoin les ajoute manuellement via le circuit de
 * modération habituel (voir services/community.ts / admin.ts).
 *
 * Coût : gratuit (pas de carte bancaire), mais quota strict — une recherche
 * coûte 100 unités sur les 10 000 disponibles par jour, donc ~100 recherches/jour
 * maximum. Voir docs/04-aspects-legaux.md pour le contexte légal complet.
 */

const YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3";

export interface YoutubeCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  url: string;
}

export async function searchYoutubeCandidates(
  query: string,
  maxResults = 5
): Promise<YoutubeCandidate[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY manquante dans l'environnement");

  const url = new URL(`${YOUTUBE_BASE_URL}/search`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(maxResults));

  const response = await fetch(url.toString());
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Quota YouTube épuisé pour aujourd'hui (403) — réessayer demain");
    }
    throw new Error(`Erreur YouTube (${response.status})`);
  }

  const data = (await response.json()) as any;

  return (data.items ?? []).map((item: any) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? null,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
  }));
}
