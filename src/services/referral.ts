import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { addCreditTransaction } from "./creditLedger";

export const REFERRER_BONUS = 10;
export const REFEREE_BONUS = 5;

/** Génère un code de parrainage court et non devinable. */
export function generateReferralCode(): string {
  return randomBytes(4).toString("hex"); // ex: "a3f9c1e2"
}

interface SignupParams {
  email: string;
  passwordHash: string; // déjà hashé par src/services/auth.ts — cette fonction ne hash jamais elle-même
  emailVerificationToken: string;
  emailVerificationExpiresAt: Date;
  signupIp?: string;
  deviceFingerprint?: string;
  referralCodeUsed?: string; // le code saisi par le nouvel utilisateur, s'il y en a un
}

/**
 * À appeler à la création d'un compte (depuis src/services/auth.ts, jamais directement
 * depuis une route — la validation du mot de passe et le hashing se font en amont).
 * Le referral est créé en status "pending" — AUCUN crédit n'est distribué ici.
 * Les crédits ne tombent qu'à la validation (voir jobs/validateReferrals.ts),
 * pour ne pas récompenser des comptes qui ne servent jamais à rien.
 */
export async function createUserWithReferral(params: SignupParams) {
  return prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: params.email,
        passwordHash: params.passwordHash,
        emailVerificationToken: params.emailVerificationToken,
        emailVerificationExpiresAt: params.emailVerificationExpiresAt,
        referralCode: generateReferralCode(),
        referredByCode: params.referralCodeUsed,
        signupIp: params.signupIp,
        deviceFingerprint: params.deviceFingerprint,
      },
    });

    if (!params.referralCodeUsed) {
      return newUser;
    }

    const referrer = await tx.user.findUnique({
      where: { referralCode: params.referralCodeUsed },
    });

    // Code invalide ou expiré : on crée quand même le compte, juste sans parrainage.
    if (!referrer) {
      return newUser;
    }

    // Empêche l'auto-parrainage trivial (même email n'est de toute façon pas possible,
    // mais on garde ce garde-fou si la logique évolue).
    if (referrer.id === newUser.id) {
      return newUser;
    }

    // Signaux de suspicion, purement informatifs — voir doc anti-fraude section 4.
    // Ils alimentent une file de revue manuelle admin, ils ne bloquent rien automatiquement.
    const sameIp = Boolean(
      params.signupIp && referrer.signupIp && params.signupIp === referrer.signupIp
    );
    const sameDevice = Boolean(
      params.deviceFingerprint &&
        referrer.deviceFingerprint &&
        params.deviceFingerprint === referrer.deviceFingerprint
    );

    // La contrainte @unique sur refereeId dans le schéma garantit qu'un utilisateur
    // ne peut être filleul qu'une fois, même si cette fonction est appelée deux fois
    // pour le même compte (protection au niveau base de données, pas seulement ici).
    await tx.referral.create({
      data: {
        referrerId: referrer.id,
        refereeId: newUser.id,
        status: "pending",
        sameIpAsReferrer: sameIp,
        sameDeviceAsReferrer: sameDevice,
      },
    });

    return newUser;
  });
}

/**
 * Distribue les crédits pour un parrainage donné. Idempotent : peut être
 * appelée plusieurs fois sans risque, les clés d'idempotence empêchent
 * tout double-crédit (voir creditLedger.addCreditTransaction).
 */
export async function creditReferral(referralId: string) {
  return prisma.$transaction(async (tx) => {
    const referral = await tx.referral.findUniqueOrThrow({
      where: { id: referralId },
    });

    if (referral.status === "validated") {
      return referral; // déjà traité, rien à faire
    }

    await addCreditTransaction({
      userId: referral.referrerId,
      amount: REFERRER_BONUS,
      reason: "referral_bonus",
      referenceId: referral.id,
      idempotencyKey: `referral:${referral.id}:referrer`,
      tx,
    });

    await addCreditTransaction({
      userId: referral.refereeId,
      amount: REFEREE_BONUS,
      reason: "referral_reward",
      referenceId: referral.id,
      idempotencyKey: `referral:${referral.id}:referee`,
      tx,
    });

    return tx.referral.update({
      where: { id: referralId },
      data: { status: "validated", validatedAt: new Date() },
    });
  });
}
