import { prisma } from "../lib/prisma";
import { sendSms } from "./notifications/sms";
import { Locale } from "../middleware/locale";
import { t } from "../i18n/messages";

export class AlertError extends Error {}

// Gabarit du SMS par langue — hors du dictionnaire t() car il a besoin d'interpolation
// (titre de la série + contexte), alors que t() ne renvoie que des chaînes fixes.
const SMS_TEMPLATES: Record<Locale, (showTitle: string, context: string) => string> = {
  fr: (showTitle, context) => `NostalgieTV — du nouveau sur "${showTitle}" : ${context}`,
  en: (showTitle, context) => `NostalgieTV — news about "${showTitle}": ${context}`,
};

/**
 * Inscrit quelqu'un pour être alerté quand la série se complète. Pas de compte requis —
 * juste un numéro. Si la personne est connectée, on garde son userId en plus, pour
 * pouvoir un jour proposer une gestion centralisée de ses alertes dans son profil.
 *
 * locale est stockée AVEC l'abonnement (pas déduite d'un profil, qui n'existe pas
 * forcément) : c'est la seule info de langue disponible au moment de rédiger le SMS,
 * potentiellement des semaines plus tard.
 */
export async function subscribeToShowAlert(params: {
  showId: string;
  phoneNumber?: string;
  userId?: string;
  locale: Locale;
}) {
  if (!params.phoneNumber && !params.userId) {
    throw new AlertError(t("phoneOrAccountRequired", params.locale));
  }

  // Évite les doublons évidents : la même personne (même numéro) ne s'inscrit
  // pas deux fois à l'alerte pour la même série.
  if (params.phoneNumber) {
    const existing = await prisma.alertSubscription.findFirst({
      where: { showId: params.showId, phoneNumber: params.phoneNumber },
    });
    if (existing) return existing;
  }

  return prisma.alertSubscription.create({
    data: {
      showId: params.showId,
      phoneNumber: params.phoneNumber,
      userId: params.userId,
      locale: params.locale,
    },
  });
}

/**
 * À appeler chaque fois qu'une série passe d'un état incomplet à un état plus complet
 * (nouvel épisode retrouvé, nouvelle source approuvée par la modération). Prévient
 * tout le monde d'un coup, puis marque chaque abonnement comme notifié pour ne
 * jamais spammer deux fois pour le même événement.
 *
 * contextMessageByLocale : le contexte ("l'épisode S02E02 vient d'être retrouvé")
 * doit déjà être fourni traduit dans les deux langues par l'appelant — voir admin.ts.
 *
 * Volontairement PAS transactionnel avec l'action qui déclenche la notification
 * (ex. approveSource) : un échec d'envoi SMS ne doit jamais faire annuler
 * l'approbation de la source elle-même. Les échecs sont logués, pas propagés.
 */
export async function notifySubscribersOfShow(
  showId: string,
  contextMessageByLocale: Record<Locale, string>
) {
  const pending = await prisma.alertSubscription.findMany({
    where: { showId, notifiedAt: null },
    include: { show: true },
  });

  for (const subscription of pending) {
    if (subscription.phoneNumber) {
      try {
        const locale = (subscription.locale as Locale) ?? "fr";
        const buildMessage = SMS_TEMPLATES[locale] ?? SMS_TEMPLATES.fr;
        const context = contextMessageByLocale[locale] ?? contextMessageByLocale.fr;

        await sendSms(subscription.phoneNumber, buildMessage(subscription.show.title, context));
      } catch (err) {
        console.error(`Échec d'envoi SMS pour l'alerte ${subscription.id}`, err);
        continue; // on retentera au prochain déclenchement plutôt que de bloquer les autres
      }
    }

    await prisma.alertSubscription.update({
      where: { id: subscription.id },
      data: { notifiedAt: new Date() },
    });
  }

  return { notifiedCount: pending.length };
}
