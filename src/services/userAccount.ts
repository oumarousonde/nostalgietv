import { prisma } from "../lib/prisma";

interface CreateUserParams {
  email?: string;
  phone?: string;
  passwordHash: string; // déjà hashé par src/services/auth.ts — cette fonction ne hash jamais elle-même
  emailVerificationToken?: string;
  emailVerificationExpiresAt?: Date;
}

/**
 * Création de compte simple, sans logique de parrainage automatique.
 *
 * Le parrainage existait auparavant ici (crédit différé +10/+5 via un job
 * planifié), mais ça exigeait un cron qui compliquait le déploiement — en
 * particulier sur Vercel, où le plan Hobby limite les Cron Jobs à une fois par
 * jour. Décision prise : le retirer entièrement plutôt que de composer avec
 * cette contrainte pour une fonctionnalité encore jamais testée en conditions
 * réelles. Si quelqu'un parraine quelqu'un d'autre, c'est maintenant à l'admin
 * de créditer les deux comptes manuellement via POST /admin/credits/grant —
 * ce endpoint existe déjà, fonctionne, et ne dépend d'aucun cron.
 */
export async function createUser(params: CreateUserParams) {
  return prisma.user.create({
    data: {
      email: params.email,
      phone: params.phone,
      passwordHash: params.passwordHash,
      emailVerificationToken: params.emailVerificationToken,
      emailVerificationExpiresAt: params.emailVerificationExpiresAt,
    },
  });
}
