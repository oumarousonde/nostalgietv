import { prisma } from "../lib/prisma";
import { addCreditTransaction } from "./creditLedger";
import { Locale } from "../middleware/locale";
import { t } from "../i18n/messages";

export class PromoCodeError extends Error {}

/**
 * Crée un nouveau code promo — occasionnel, quand l'admin veut (campagne ponctuelle,
 * geste commercial groupé, etc.), pas une tâche planifiée. maxUses limite l'exposition :
 * même si le code fuite, il s'arrête tout seul une fois épuisé.
 *
 * announce (true par défaut) : si true, le code apparaît dans le bandeau d'annonce vu
 * par tous les utilisateurs à leur prochaine connexion (voir announcements.ts). Mettre
 * à false pour un code communiqué à la main à une personne précise, qu'il serait
 * contre-productif d'afficher à tout le monde.
 */
export async function createPromoCode(params: {
  code: string;
  creditAmount: number;
  maxUses: number;
  expiresAt?: Date;
  announce?: boolean;
  locale: Locale;
}) {
  if (params.creditAmount <= 0) {
    throw new PromoCodeError(t("amountMustBePositive", params.locale));
  }
  if (params.maxUses <= 0) {
    throw new PromoCodeError(t("maxUsesMustBePositive", params.locale));
  }

  try {
    return await prisma.promoCode.create({
      data: {
        code: params.code,
        creditAmount: params.creditAmount,
        maxUses: params.maxUses,
        expiresAt: params.expiresAt,
        announce: params.announce ?? true,
      },
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      throw new PromoCodeError(t("promoCodeAlreadyExists", params.locale));
    }
    throw err;
  }
}

/**
 * Applique un code promo pour un utilisateur.
 * Deux garde-fous critiques, tous les deux au niveau base de données :
 *
 * 1. Un utilisateur ne peut pas réutiliser un code déjà utilisé
 *    → clé primaire composite (code, userId) sur PromoRedemption.
 * 2. Un code à usage limité ne peut pas dépasser son quota même avec
 *    deux requêtes simultanées → updateMany conditionnel atomique,
 *    qui échoue silencieusement (0 ligne affectée) si le quota est atteint,
 *    au lieu d'un flow "lire le compteur, vérifier, puis écrire" qui
 *    laisserait une fenêtre de race condition.
 */
export async function redeemPromoCode(userId: string, code: string, locale: Locale) {
  return prisma.$transaction(async (tx) => {
    const promo = await tx.promoCode.findUnique({ where: { code } });

    if (!promo) throw new PromoCodeError(t("invalidPromoCode", locale));
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      throw new PromoCodeError(t("expiredPromoCode", locale));
    }

    // Règle métier : un jour = un code promo, tous codes confondus. Même si un
    // utilisateur n'a jamais touché CE code précis, s'il a déjà utilisé un AUTRE
    // code aujourd'hui, ça ne passe pas — seul le lendemain (calendaire, minuit UTC)
    // débloque à nouveau la possibilité, avec ce code ou un autre.
    //
    // Vérification applicative d'abord (message rapide et clair dans le cas courant),
    // MAIS la vraie garantie contre une course entre deux requêtes simultanées est
    // la contrainte unique @@unique([userId, redeemedDay]) plus bas — voir le catch.
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const redeemedDay = startOfToday.toISOString().slice(0, 10); // "2026-09-05"

    const alreadyRedeemedToday = await tx.promoRedemption.findFirst({
      where: { userId, createdAt: { gte: startOfToday } },
    });
    if (alreadyRedeemedToday) {
      throw new PromoCodeError(t("promoCodeOncePerDay", locale));
    }

    // Tentative d'enregistrement de l'utilisation. Deux contraintes uniques différentes
    // peuvent être violées ici, et il faut les distinguer pour renvoyer le bon message :
    // - (code, userId) → ce code précis déjà utilisé par ce compte, un jour quelconque
    // - (userId, redeemedDay) → un AUTRE code déjà utilisé aujourd'hui par ce compte
    //   (c'est le filet de sécurité qui rattrape la course que la vérification
    //   applicative ci-dessus ne peut pas garantir à 100% seule)
    try {
      await tx.promoRedemption.create({ data: { code, userId, redeemedDay } });
    } catch (err: any) {
      if (err.code === "P2002") {
        const violatedFields: string[] = err.meta?.target ?? [];
        if (violatedFields.includes("redeemedDay")) {
          throw new PromoCodeError(t("promoCodeOncePerDay", locale));
        }
        throw new PromoCodeError(t("promoCodeAlreadyUsed", locale));
      }
      throw err;
    }

    // Incrément atomique et CONDITIONNEL : n'incrémente que si le quota n'est pas dépassé.
    // Si deux utilisateurs valident le dernier usage en même temps, un seul des deux
    // updateMany touchera une ligne — l'autre repartira avec count=0 et on annule.
    const result = await tx.promoCode.updateMany({
      where: { code, usesCount: { lt: promo.maxUses } },
      data: { usesCount: { increment: 1 } },
    });

    if (result.count === 0) {
      throw new PromoCodeError(t("promoCodeMaxUsesReached", locale));
    }

    await addCreditTransaction({
      userId,
      amount: promo.creditAmount,
      reason: "promo_code",
      referenceId: code,
      idempotencyKey: `promo:${code}:${userId}`,
      tx,
    });

    return { creditsGranted: promo.creditAmount };
  });
}
