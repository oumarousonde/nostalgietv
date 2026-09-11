import { prisma } from "../lib/prisma";

/**
 * Le détail complet, épisode par épisode, de ce qui est trouvé, manquant, ou
 * disponible en payant — c'est ce qui permet de dire concrètement "Badlands,
 * 5 saisons, tout est là sauf S01E03 et S01E09, disponibles chez Amazon".
 * Sans cette fonction, l'app savait QUE des épisodes manquaient (via leur statut
 * en base) mais ne le communiquait jamais au client.
 */
export async function getShowEpisodesWithAvailability(showId: string) {
  const show = await prisma.show.findUniqueOrThrow({
    where: { id: showId },
    select: { id: true, title: true, mediaType: true },
  });

  const episodes = await prisma.episode.findMany({
    where: { showId },
    include: {
      // Seulement les sources VÉRIFIÉES : jamais exposer un lien avant validation
      // par la modération (voir services/admin.ts).
      sources: { where: { verified: true }, select: { id: true, url: true, quality: true } },
      affiliateLinks: true,
    },
    orderBy: [{ season: "asc" }, { episode: "asc" }],
  });

  const episodeDetails = episodes.map((ep) => ({
    season: ep.season,
    episode: ep.episode,
    title: ep.title,
    status: ep.status, // "found" | "missing" | "paidOnly"
    freeSources: ep.sources.map((s) => ({ id: s.id, url: s.url, quality: s.quality })),
    paidLinks: ep.affiliateLinks.map((link) => ({
      platform: link.platform,
      url: link.url,
      quality: link.quality,
      hasCommission: link.hasCommission,
      priceLabel: link.priceLabel,
    })),
  }));

  // Résumé pratique pour l'affichage type "Badlands — 5 saisons, 2 épisodes
  // manquants" sans que le client ait à recompter lui-même sur toute la liste.
  const summary = {
    totalEpisodes: episodeDetails.length,
    seasonCount: new Set(episodeDetails.map((e) => e.season)).size,
    foundCount: episodeDetails.filter((e) => e.status === "found").length,
    missingCount: episodeDetails.filter((e) => e.status === "missing").length,
    paidOnlyCount: episodeDetails.filter((e) => e.status === "paidOnly").length,
  };

  return {
    showId: show.id,
    title: show.title,
    mediaType: show.mediaType,
    summary,
    episodes: episodeDetails,
  };
}
