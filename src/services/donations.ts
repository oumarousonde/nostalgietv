import { prisma } from "../lib/prisma";

/**
 * Le tab "soutenir le projet" est volontairement séparé du système de crédits IA :
 * un don ici ne débloque AUCUN crédit ni avantage. Ça évite que ce flux soit
 * requalifié comme un moyen de paiement commercial (réglementation différente
 * selon les pays pour un don libre vs un achat de service).
 */
export async function getActiveDonationChannels() {
  return prisma.donationChannel.findMany({ where: { active: true } });
}

/**
 * Génère l'URL d'un QR code pointant vers le numéro, pour éviter à l'utilisateur
 * de recopier un numéro à la main. Utilise un service de génération de QR code
 * externe simple ; à remplacer par une lib locale (ex. `qrcode` npm) si on veut
 * éviter une dépendance à un service tiers.
 */
export function buildDonationQrCodeUrl(countryCode: string, phoneNumber: string): string {
  const payload = encodeURIComponent(`${countryCode}${phoneNumber}`);
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${payload}`;
}

/**
 * Données de départ à insérer via seed / migration — à ajuster depuis l'admin
 * plutôt que redéployer si les numéros changent.
 */
export const DEFAULT_DONATION_CHANNELS = [
  { provider: "orange_money", countryCode: "+226", phoneNumber: "75318351" },
  { provider: "wave", countryCode: "+226", phoneNumber: "75318351" },
  { provider: "moov_money", countryCode: "+226", phoneNumber: "71607287" },
];
