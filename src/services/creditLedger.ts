import { Prisma, CreditReason } from "@prisma/client";
import { prisma } from "../lib/prisma";

// Classe dédiée plutôt qu'un Error générique : searchCascade.ts et chat.ts doivent
// pouvoir détecter CE cas précis (solde insuffisant) sans comparer une chaîne de
// caractères en dur — une technique fragile qui casse silencieusement si le message
// change un jour sans que tous les points de comparaison soient mis à jour en même temps.
export class InsufficientCreditsError extends Error {}

/**
 * Le solde d'un utilisateur n'est jamais stocké : il se calcule en sommant
 * toutes ses transactions. Ça rend chaque euro/crédit traçable et corrigeable.
 */
export async function getBalance(userId: string): Promise<number> {
  const result = await prisma.creditTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

interface AddTransactionParams {
  userId: string;
  amount: number; // positif = crédit, négatif = dépense
  reason: CreditReason;
  referenceId?: string;
  idempotencyKey: string;
  tx?: Prisma.TransactionClient; // permet d'appeler ceci depuis une transaction englobante
}

/**
 * Ajoute une transaction de crédit de façon idempotente.
 * Si la même idempotencyKey a déjà été utilisée, ne fait rien et retourne l'existante
 * au lieu de planter ou de créditer deux fois — essentiel pour les doubles-clics,
 * les retries réseau, et les requêtes concurrentes.
 */
export async function addCreditTransaction(params: AddTransactionParams) {
  const client = params.tx ?? prisma;

  try {
    return await client.creditTransaction.create({
      data: {
        userId: params.userId,
        amount: params.amount,
        reason: params.reason,
        referenceId: params.referenceId,
        idempotencyKey: params.idempotencyKey,
      },
    });
  } catch (err) {
    // Violation de contrainte unique sur idempotencyKey = déjà traité, ce n'est pas une erreur.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return client.creditTransaction.findUniqueOrThrow({
        where: { idempotencyKey: params.idempotencyKey },
      });
    }
    throw err;
  }
}

/**
 * Dépense des crédits pour une recherche IA (image/vidéo/description/lien).
 * Refuse si le solde est insuffisant. La vérification + l'écriture se font
 * dans une transaction pour éviter qu'un utilisateur dépense plus que son solde
 * en envoyant deux requêtes de recherche en même temps.
 */
export async function spendCreditsForSearch(
  userId: string,
  amount: number,
  searchRequestId: string
) {
  return prisma.$transaction(async (tx) => {
    const balance = await tx.creditTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    const currentBalance = balance._sum.amount ?? 0;

    if (currentBalance < amount) {
      throw new InsufficientCreditsError("Crédits insuffisants pour cette recherche");
    }

    return addCreditTransaction({
      userId,
      amount: -amount,
      reason: "ia_search_spend",
      referenceId: searchRequestId,
      idempotencyKey: `search_spend:${searchRequestId}`,
      tx,
    });
  });
}
