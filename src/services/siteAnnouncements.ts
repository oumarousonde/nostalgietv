import { prisma } from "../lib/prisma";

/**
 * Annonces courtes écrites à la main par un admin ("On a retrouvé 40 séries
 * cette semaine !"), affichées en page d'accueil. Volontairement séparé du
 * système de codes promo (voir services/announcements.ts) : pas d'expiration,
 * pas d'usages, juste un texte affiché ou non.
 */

export async function createSiteAnnouncement(message: string) {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw new Error("Le message ne peut pas être vide.");
  }
  if (trimmed.length > 280) {
    throw new Error("Le message est trop long (280 caractères maximum).");
  }
  return prisma.siteAnnouncement.create({ data: { message: trimmed } });
}

export async function getActiveSiteAnnouncements() {
  return prisma.siteAnnouncement.findMany({
    where: { active: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

export async function deactivateSiteAnnouncement(id: string) {
  await prisma.siteAnnouncement.update({
    where: { id },
    data: { active: false },
  });
}
