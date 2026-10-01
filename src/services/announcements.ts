import { prisma } from "../lib/prisma";

/**
 * Bandeau d'annonce "un code promo est actif" — pas une notification poussée
 * (pas d'email ni de push disponible dans ce projet), mais récupéré par le client
 * à l'ouverture de l'app. C'est la façon la plus honnête de faire "tous les
 * utilisateurs sont alertés" avec l'infrastructure actuelle.
 *
 * Deux versions, pour deux publics différents :
 * - getPublicActivePromoCodes() : accessible SANS compte, pour un bandeau visible
 *   par n'importe qui ouvre l'app — c'est ce que tu voulais ("tous les utilisateurs
 *   le verront", connectés ou pas). Ne mémorise pas "déjà vu" (impossible sans
 *   identifier la personne), donc un visiteur anonyme le reverra tant qu'il est actif.
 * - getActiveAnnouncementsForUser() : pour un utilisateur connecté, en plus filtre
 *   ce qu'il a déjà vu ou déjà utilisé, pour ne pas le lui remontrer inutilement.
 */
async function queryActiveAnnounceablePromoCodes() {
  const activeCodes = await prisma.promoCode.findMany({
    where: {
      announce: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  return activeCodes.filter((promo) => promo.usesCount < promo.maxUses);
}

export async function getPublicActivePromoCodes() {
  return queryActiveAnnounceablePromoCodes();
}

export async function getActiveAnnouncementsForUser(userId: string) {
  const activeCodes = await queryActiveAnnounceablePromoCodes();

  const seen = await prisma.promoCodeSeen.findMany({
    where: { userId },
    select: { code: true },
  });
  const seenCodes = new Set(seen.map((s) => s.code));

  const redeemed = await prisma.promoRedemption.findMany({
    where: { userId },
    select: { code: true },
  });
  const redeemedCodes = new Set(redeemed.map((r) => r.code));

  return activeCodes.filter(
    (promo) => !seenCodes.has(promo.code) && !redeemedCodes.has(promo.code)
  );
}

/**
 * À appeler quand l'utilisateur ferme le bandeau (ou l'a vu) — évite qu'il revienne
 * à chaque connexion tant que le code reste actif. Idempotent : fermer deux fois
 * le même bandeau ne fait rien de plus la seconde fois. Nécessite un compte
 * (impossible de mémoriser "déjà vu" pour un visiteur anonyme).
 */
export async function dismissAnnouncement(userId: string, code: string) {
  return prisma.promoCodeSeen.upsert({
    where: { code_userId: { code, userId } },
    create: { code, userId },
    update: {},
  });
}
