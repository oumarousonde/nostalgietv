import { prisma } from "../lib/prisma";
import { creditReferral } from "../services/referral";

// Délai de carence avant qu'un parrainage puisse être crédité.
// Rend la fraude aux faux comptes non rentable : il faut attendre pour rien.
const CARENCE_DELAI_HEURES = 48;

// Au-delà de ce délai sans activation, le parrainage est abandonné.
const REJET_DELAI_JOURS = 14;

/**
 * À lancer périodiquement (ex. toutes les heures, via un cron / scheduler).
 * Valide un parrainage seulement si le filleul :
 *   1. a confirmé son email
 *   2. a effectué au moins une action réelle (ici : une recherche)
 *   3. son compte a au moins CARENCE_DELAI_HEURES d'ancienneté
 */
export async function runValidateReferralsJob() {
  const carenceLimite = new Date(Date.now() - CARENCE_DELAI_HEURES * 60 * 60 * 1000);
  const rejetLimite = new Date(Date.now() - REJET_DELAI_JOURS * 24 * 60 * 60 * 1000);

  const pendingReferrals = await prisma.referral.findMany({
    where: { status: "pending", createdAt: { lte: carenceLimite } },
    include: { referee: true },
  });

  let validated = 0;
  let rejected = 0;

  for (const referral of pendingReferrals) {
    const filleulActif = await hasCompletedFirstAction(referral.refereeId);
    const emailConfirme = referral.referee.emailVerifiedAt !== null;

    if (emailConfirme && filleulActif) {
      await creditReferral(referral.id);
      validated++;
      continue;
    }

    // Trop vieux et toujours inactif : on abandonne, pas de crédit distribué.
    if (referral.createdAt <= rejetLimite) {
      await prisma.referral.update({
        where: { id: referral.id },
        data: { status: "rejected" },
      });
      rejected++;
    }
    // Sinon : on laisse en pending, on retentera au prochain passage du job.
  }

  return { examined: pendingReferrals.length, validated, rejected };
}

/**
 * Remplacer par la vraie vérification métier si besoin d'un critère plus strict —
 * ici, "a fait au moins une recherche", gratuite ou payante. Compter uniquement
 * les recherches payantes (ia_search_spend) serait trop restrictif : la cascade
 * est gratuit-d'abord (voir SEARCH_CASCADE), donc l'usage le plus courant et le
 * plus légitime — chercher un titre exact — ne coûte jamais de crédit. Exiger une
 * dépense pour valider un parrainage pénaliserait justement les utilisateurs qui
 * se servent de l'app comme prévu.
 */
async function hasCompletedFirstAction(userId: string): Promise<boolean> {
  const searchCount = await prisma.searchHistoryEntry.count({ where: { userId } });
  return searchCount > 0;
}
