import { prisma } from "../lib/prisma";
import { Locale } from "../middleware/locale";

/**
 * Ouvre une "piste" quand NostalgieTV n'a rien trouvé — ni gratuitement, ni en payant.
 * Crée un épisode ancre (S01E01) même pour un film, pour que les sources proposées
 * par la suite aient toujours un point d'accroche (le schéma attache une Source à
 * un Episode, jamais directement à un Show).
 *
 * originalLocale = la langue de la personne qui ouvre la piste : son titre/description
 * sont tapés dans CETTE langue, donc c'est la langue d'origine réelle de la fiche —
 * nécessaire pour que translations.ts sache dans quel sens traduire ensuite.
 */
export async function createCommunityShow(params: {
  title: string;
  description?: string;
  locale: Locale;
}) {
  return prisma.show.create({
    data: {
      title: params.title,
      synopsis: params.description,
      originalLocale: params.locale,
      communityCreated: true,
      episodes: {
        create: [{ season: 1, episode: 1, status: "missing" }],
      },
    },
    include: { episodes: true },
  });
}

/**
 * "Ah, je sais où ça se trouve" — n'importe quel utilisateur connecté peut proposer
 * un lien. Rien n'est visible publiquement avant validation : verified reste false
 * jusqu'à passage par la file de modération admin (voir services/admin.ts).
 *
 * quality : la personne qui propose le lien sait généralement dans quelle qualité
 * elle l'a trouvé (SD/HD/4K) — utile si plusieurs sources existent pour le même
 * épisode, pour que l'utilisateur final choisisse plutôt que de tomber au hasard
 * sur la moins bonne.
 */
export async function proposeSource(params: {
  episodeId: string;
  url: string;
  submittedByUserId: string;
  quality?: "unknown" | "sd" | "hd" | "uhd_4k";
}) {
  return prisma.source.create({
    data: {
      episodeId: params.episodeId,
      url: params.url,
      quality: params.quality ?? "unknown",
      submittedBy: params.submittedByUserId,
      verified: false,
    },
  });
}
