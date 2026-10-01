import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { createUser } from "./userAccount";
import { grantSignupBonus } from "./creditLedger";
import { Locale } from "../middleware/locale";
import { normalizePhone, looksLikeEmail } from "./phone";
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
 * Inscription : crée le compte (mot de passe hashé, jamais stocké en clair)
 * et génère un token de vérification email à durée de vie limitée.
 *
 * Ne retourne PAS de JWT ici — tant que l'email n'est pas confirmé, on préfère
 * forcer explicitement le passage par /auth/verify-email avant de laisser
 * quelqu'un se connecter (voir login() plus bas).
 */
export async function signup(params: {
  phone?: string;
  email?: string;
  password: string;
  locale: Locale;
}) {
  if (!params.password || params.password.length < 8) {
    throw new AuthError(t("passwordTooShort", params.locale));
  }

  // --- Inscription par numéro de téléphone (le cas normal) ---
  // Pas de vérification pour l'instant : aucun envoi de SMS/email n'est branché.
  // Le compte est utilisable tout de suite, et un JWT est renvoyé directement.
  if (params.phone) {
    const phone = normalizePhone(params.phone);
    if (!phone) throw new AuthError(t("invalidPhone", params.locale));

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) throw new AuthError(t("accountExists", params.locale));

    const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
    const user = await createUser({ phone, passwordHash });

    await grantSignupBonus(user.id).catch((err) =>
      console.error("Échec de l'octroi des crédits d'inscription", err)
    );

    const token = jwt.sign({ userId: user.id, role: user.role }, getJwtSecret(), {
      expiresIn: JWT_EXPIRY,
    });
    return { userId: user.id, token, role: user.role, phone };
  }

  // --- Inscription par email (ancien parcours, conservé tel quel) ---
  if (!params.email) throw new AuthError(t("phoneRequired", params.locale));

  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    throw new AuthError(t("accountExists", params.locale));
  }

  const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
  const emailVerificationToken = randomBytes(32).toString("hex");
  const emailVerificationExpiresAt = new Date(
    Date.now() + EMAIL_TOKEN_VALIDITY_HOURS * 60 * 60 * 1000
  );

  const user = await createUser({
    email: params.email,
    passwordHash,
    emailVerificationToken,
    emailVerificationExpiresAt,
  });

  await grantSignupBonus(user.id).catch((err) =>
    console.error("Échec de l'octroi des crédits d'inscription", err)
  );

  // À brancher sur un vrai envoi d'email (Resend, SES, etc.) — le token seul
  // ne sert à rien tant qu'il n'atteint pas la boîte mail du nouvel utilisateur.
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
export async function login(identifier: string, password: string, locale: Locale) {
  const genericError = new AuthError(t("invalidCredentials", locale));
  if (typeof identifier !== "string" || !identifier.trim() || typeof password !== "string") {
    throw genericError;
  }

  // identifier = numéro de téléphone (cas normal) OU email (comptes créés avant le
  // passage au numéro, dont le compte admin) — un "@" suffit à les distinguer.
  let user = null;
  if (looksLikeEmail(identifier)) {
    user = await prisma.user.findUnique({ where: { email: identifier.trim() } });
  } else {
    const phone = normalizePhone(identifier);
    if (phone) user = await prisma.user.findUnique({ where: { phone } });
  }

  if (!user) throw genericError;

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) throw genericError;

  // La vérification d'email ne concerne que les comptes SANS numéro de téléphone.
  if (!user.phone && !user.emailVerifiedAt) {
    throw new AuthError(t("emailNotVerified", locale));
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, getJwtSecret(), {
    expiresIn: JWT_EXPIRY,
  });

  return { token, userId: user.id, role: user.role };
}

/**
 * Changement de mot de passe pour un compte déjà connecté. Exige l'ancien mot
 * de passe (pas juste le JWT) : un token volé/laissé ouvert sur un appareil
 * ne doit pas suffire à lui seul pour prendre le contrôle du compte.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  locale: Locale
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordMatches) {
    throw new AuthError(t("currentPasswordWrong", locale));
  }

  if (newPassword.length < 8) {
    throw new AuthError(t("passwordTooShort", locale));
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
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
