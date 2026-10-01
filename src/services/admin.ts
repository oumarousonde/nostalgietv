import { prisma } from "../lib/prisma";
import { addCreditTransaction } from "./creditLedger";
import { notifySubscribersOfShow } from "./alerts";
import { Locale } from "../middleware/locale";
import { normalizePhone, looksLikeEmail } from "./phone";
import { t } from "../i18n/messages";

export class AdminActionError extends Error {}

/**
 * Un admin connaît l'email d'un membre, jamais son id interne (un UUID).
 * Cette recherche fait le pont pour l'écran "donner des crédits" : l'admin
 * tape un email, on retrouve le userId nécessaire à grantCreditsToUser.
 */
export async function findUserByEmail(email: string) {
  // Comparaison exacte, sans normaliser la casse : le reste de l'app (signup,
  // login) ne normalise pas non plus l'email à l'écriture, donc le faire
  // uniquement ici créerait un faux "introuvable" pour un email enregistré
  // avec une casse différente plutôt que de corriger vraiment le problème.
  return prisma.user.findUnique({
    where: { email: email.trim() },
    select: { id: true, email: true, role: true, createdAt: true },
  });
}

/**
 * Retrouve un compte par numéro de téléphone (cas normal) ou par email (anciens
 * comptes). L'admin tape ce qu'il connaît ; on en déduit le userId interne.
 */
export async function findUserByIdentifier(identifier: string) {
  const value = identifier.trim();
  const select = { id: true, email: true, phone: true, role: true, createdAt: true };

  if (looksLikeEmail(value)) {
    return prisma.user.findUnique({ where: { email: value }, select });
  }
  const phone = normalizePhone(value);
  if (!phone) return null;
  return prisma.user.findUnique({ where: { phone }, select });
}

/**
 * Distribue des crédits IA à un utilisateur, décision manuelle de l'admin
 * (nouveau membre à encourager, contributeur actif à récompenser, etc.).
 * Passe par le même grand livre que tout le reste — aucune table séparée
 * "crédits admin", pour garder une seule source de vérité du solde.
 */
export async function grantCreditsToUser(params: {
  adminId: string;
  targetUserId: string;
  amount: number;
  reason: string; // note libre, ex. "contributeur actif — 40 sources vérifiées ce mois-ci"
  locale: Locale;
}) {
  await assertIsAdmin(params.adminId, params.locale);

  if (params.amount <= 0) {
    throw new AdminActionError(t("amountMustBePositive", params.locale));
  }

  // idempotencyKey inclut un timestamp arrondi à la minute : empêche un double-clic
  // accidentel de l'admin de créditer deux fois dans la même minute, sans empêcher
  // deux attributions légitimes à des moments différents.
  const minuteWindow = Math.floor(Date.now() / 60_000);

  return addCreditTransaction({
    userId: params.targetUserId,
    amount: params.amount,
    reason: "admin_grant",
    referenceId: params.adminId,
    idempotencyKey: `admin_grant:${params.adminId}:${params.targetUserId}:${minuteWindow}`,
  });
}

/**
 * File de modération : sources uploadées par la communauté, en attente de vérification
 * avant d'être visibles publiquement sur une fiche.
 */
export async function getPendingSources() {
  return prisma.source.findMany({
    where: { verified: false },
    include: { episode: { include: { show: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Renvoie les sources gratuites VÉRIFIÉES d'un épisode — c'est le lien concret que
 * l'utilisateur clique pour aller regarder, une fois qu'un épisode passe à "found".
 * Ne renvoie jamais les sources non vérifiées : ce serait publier un lien avant
 * validation par la modération, exactement ce que la file existe pour empêcher.
 */
export async function getVerifiedSourcesForEpisode(episodeId: string) {
  return prisma.source.findMany({
    where: { episodeId, verified: true },
    select: { id: true, url: true, quality: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function approveSource(adminId: string, sourceId: string, locale: Locale) {
  await assertIsAdmin(adminId, locale);

  const source = await prisma.source.update({
    where: { id: sourceId },
    data: { verified: true },
    include: { episode: true },
  });

  // Une source vérifiée peut faire passer l'épisode de "missing" à "found".
  const episode = await prisma.episode.update({
    where: { id: source.episodeId },
    data: { status: "found" },
  });

  // Le contexte doit exister dans les deux langues d'un coup : chaque abonné reçoit
  // son SMS dans SA langue à lui (stockée à l'abonnement, voir alerts.ts), pas dans
  // celle de l'admin qui approuve la source.
  const episodeCode = `S${episode.season}E${episode.episode}`;

  // Ne bloque jamais l'approbation elle-même si l'envoi échoue — voir alerts.ts.
  notifySubscribersOfShow(episode.showId, {
    fr: `l'épisode ${episodeCode} vient d'être retrouvé.`,
    en: `episode ${episodeCode} was just found.`,
  }).catch((err) => console.error("Échec de notification après approbation de source", err));

  return source;
}

export async function rejectSource(adminId: string, sourceId: string, locale: Locale) {
  await assertIsAdmin(adminId, locale);
  return prisma.source.delete({ where: { id: sourceId } });
}

async function assertIsAdmin(userId: string, locale: Locale) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.role !== "admin") {
    throw new AdminActionError(t("adminOnly", locale));
  }
}
