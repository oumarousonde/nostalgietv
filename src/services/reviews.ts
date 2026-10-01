import { prisma } from "../lib/prisma";
import { Locale } from "../middleware/locale";
import { t } from "../i18n/messages";

export class ReviewError extends Error {}

/**
 * Un seul avis par utilisateur, par fiche, et par portée (série entière ou épisode
 * précis) — cette fonction fait donc un upsert plutôt qu'un create pour permettre
 * de modifier son avis existant sans avoir besoin d'une route de suppression séparée.
 */
export async function submitReview(params: {
  showId: string;
  episodeId?: string; // absent = avis sur la série/le film entier
  userId: string;
  rating: number;
  comment: string;
  locale: Locale;
}) {
  if (params.rating < 1 || params.rating > 5) {
    throw new ReviewError(t("reviewRatingRange", params.locale));
  }
  if (params.comment.trim().length === 0) {
    throw new ReviewError(t("reviewCommentEmpty", params.locale));
  }

  const reviewScope = params.episodeId ?? "show";

  return prisma.review.upsert({
    where: { showId_userId_reviewScope: { showId: params.showId, userId: params.userId, reviewScope } },
    create: {
      showId: params.showId,
      episodeId: params.episodeId,
      reviewScope,
      userId: params.userId,
      rating: params.rating,
      comment: params.comment,
    },
    update: {
      rating: params.rating,
      comment: params.comment,
    },
  });
}

/**
 * Sans episodeId : tous les avis de la fiche (série + tous ses épisodes confondus).
 * Avec episodeId : uniquement les avis sur CET épisode précis.
 */
export async function getReviewsForShow(showId: string, episodeId?: string) {
  return prisma.review.findMany({
    where: episodeId ? { showId, episodeId } : { showId },
    orderBy: { createdAt: "desc" },
  });
}
