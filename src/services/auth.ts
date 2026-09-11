import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { createUserWithReferral } from "./referral";
import { Locale } from "../middleware/locale";
import { t } from "../i18n/messages";

export class AuthError extends Error {}

const JWT_EXPIRY = "7d";
const EMAIL_TOKEN_VALIDITY_HOURS = 24;
const BCRYPT_ROUNDS = 12;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET manquant dans l'environnement");
  return secret;
}

/**
 * Inscription : crée le compte (mot de passe hashé, jamais stocké en clair),
 * génère un token de vérification email à durée de vie limitée, et déclenche
 * la logique de parrainage si un code a été fourni.
 *
 * Ne retourne PAS de JWT ici — tant que l'email n'est pas confirmé, on préfère
 * forcer explicitement le passage par /auth/verify-email avant de laisser
 * quelqu'un se connecter (voir login() plus bas).
 */
export async function signup(params: {
  email: string;
  password: string;
  referralCodeUsed?: string;
  signupIp?: string;
  deviceFingerprint?: string;
  locale: Locale;
}) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    throw new AuthError(t("accountExists", params.locale));
  }

  if (params.password.length < 8) {
    throw new AuthError(t("passwordTooShort", params.locale));
  }

  const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
  const emailVerificationToken = randomBytes(32).toString("hex");
  const emailVerificationExpiresAt = new Date(
    Date.now() + EMAIL_TOKEN_VALIDITY_HOURS * 60 * 60 * 1000
  );

  const user = await createUserWithReferral({
    email: params.email,
    passwordHash,
    emailVerificationToken,
    emailVerificationExpiresAt,
    referralCodeUsed: params.referralCodeUsed,
    signupIp: params.signupIp,
    deviceFingerprint: params.deviceFingerprint,
  });

  // À brancher sur un vrai envoi d'email (Resend, SES, etc.) — le token seul
  // ne sert à rien tant qu'il n'atteint pas la boîte mail du nouvel utilisateur.
  // Note : le contenu de CET email (une fois branché) devra aussi être traduit
  // selon params.locale — pas fait tant que l'envoi lui-même n'est pas branché.
  return { userId: user.id, emailVerificationToken };
}

/**
 * Confirme l'email à partir du token reçu par mail. Vérifie l'expiration :
 * un token périmé doit être régénéré (via une future route "renvoyer l'email"),
 * jamais accepté silencieusement.
 */
export async function verifyEmail(token: string, locale: Locale) {
  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });

  if (!user) throw new AuthError(t("invalidVerificationLink", locale));
  if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
    throw new AuthError(t("expiredVerificationLink", locale));
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationToken: null, // usage unique : consommé une fois validé
      emailVerificationExpiresAt: null,
    },
  });
}

/**
 * Connexion. Le message d'erreur est volontairement identique que l'email n'existe
 * pas OU que le mot de passe soit faux — ne jamais révéler si un email est déjà
 * inscrit, ça facilite l'énumération de comptes pour un attaquant.
 */
export async function login(email: string, password: string, locale: Locale) {
  const user = await prisma.user.findUnique({ where: { email } });
  const genericError = new AuthError(t("invalidCredentials", locale));

  if (!user) throw genericError;

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) throw genericError;

  if (!user.emailVerifiedAt) {
    throw new AuthError(t("emailNotVerified", locale));
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, getJwtSecret(), {
    expiresIn: JWT_EXPIRY,
  });

  return { token, userId: user.id, role: user.role };
}

export interface DecodedToken {
  userId: string;
  role: "member" | "admin";
}

export function verifyJwt(token: string, locale: Locale = "fr"): DecodedToken {
  try {
    return jwt.verify(token, getJwtSecret()) as DecodedToken;
  } catch {
    throw new AuthError(t("sessionInvalid", locale));
  }
}
