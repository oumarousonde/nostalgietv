import { prisma } from "../lib/prisma";
import { AFFILIATE_PLATFORMS } from "../config/providers";

/**
 * Ajoute un lien "où regarder en payant". episodeId optionnel :
 * - absent → le lien couvre toute la série (ex. abonnement Netflix, coffret complet)
 * - présent → le lien couvre UN épisode précis (ex. acheté à l'unité sur Amazon)
 *
 * Le flag hasCommission vient du registre central (config/providers.ts), jamais saisi
 * à la main ici — évite qu'un lien Netflix soit affiché par erreur comme générant
 * une commission.
 *
 * Quand un lien épisode précis est ajouté sur un épisode actuellement "missing",
 * on le fait passer à "paidOnly" : ça répond directement à la question "qu'est-ce
 * qui se passe si 2 épisodes manquent gratuitement" — ils changent de statut dès
 * qu'une option payante existe pour eux, et la grille reflète cette nuance au lieu
 * de juste dire "manquant" sans plus de détail.
 */
export async function addAffiliateLink(params: {
  showId: string;
  episodeId?: string;
  platformKey: string;
  url: string;
  priceLabel?: string;
  quality?: "unknown" | "sd" | "hd" | "uhd_4k";
}) {
  const platform = AFFILIATE_PLATFORMS.find((p) => p.key === params.platformKey);
  if (!platform) throw new Error(`Plateforme inconnue : ${params.platformKey}`);

  // C'était un vrai trou : buildAmazonAffiliateUrl() existait mais n'était jamais
  // appelée. Sans ce tag, un lien Amazon collé tel quel ne génère AUCUNE commission —
  // exactement le contraire de l'objectif du projet. Appliqué automatiquement ici,
  // une seule fois, pour que ça ne dépende jamais de la mémoire de la personne qui
  // colle le lien depuis le panneau admin.
  const finalUrl = platform.key === "amazon" ? buildAmazonAffiliateUrl(params.url) : params.url;

  return prisma.$transaction(async (tx) => {
    const link = await tx.affiliateLink.create({
      data: {
        showId: params.showId,
        episodeId: params.episodeId,
        platform: platform.key,
        url: finalUrl,
        quality: params.quality ?? "unknown",
        hasCommission: platform.hasCommission,
        priceLabel: params.priceLabel,
      },
    });

    if (params.episodeId) {
      const episode = await tx.episode.findUniqueOrThrow({ where: { id: params.episodeId } });
      if (episode.status === "missing") {
        await tx.episode.update({
          where: { id: params.episodeId },
          data: { status: "paidOnly" },
        });
      }
    }

    return link;
  });
}

/**
 * Construit une URL d'affiliation Amazon avec le tag partenaire.
 * Nécessite AMAZON_ASSOCIATE_TAG dans les variables d'environnement
 * (obtenu via le programme Amazon Associates — inscription et validation requises,
 * ce n'est pas automatique même avec une clé API PA-API).
 */
export function buildAmazonAffiliateUrl(productUrl: string): string {
  const tag = process.env.AMAZON_ASSOCIATE_TAG;
  if (!tag) throw new Error("AMAZON_ASSOCIATE_TAG manquant dans l'environnement");

  const url = new URL(productUrl);
  url.searchParams.set("tag", tag);
  return url.toString();
}

/**
 * Retourne les liens valables pour TOUTE la série (episodeId null), triés pour
 * mettre en avant en premier les plateformes qui génèrent une commission — sans
 * jamais masquer les autres (l'utilisateur doit toujours voir toutes les options légales).
 */
export async function getAffiliateLinksForShow(showId: string) {
  const links = await prisma.affiliateLink.findMany({ where: { showId, episodeId: null } });
  return links.sort((a, b) => Number(b.hasCommission) - Number(a.hasCommission));
}

/**
 * Retourne les liens spécifiques à UN épisode — répond précisément à "cet épisode-là
 * précis, où je le trouve en payant", plutôt qu'un lien générique pour la série entière
 * qui ne dit pas si CET épisode y est vraiment inclus.
 */
export async function getAffiliateLinksForEpisode(episodeId: string) {
  const links = await prisma.affiliateLink.findMany({ where: { episodeId } });
  return links.sort((a, b) => Number(b.hasCommission) - Number(a.hasCommission));
}
