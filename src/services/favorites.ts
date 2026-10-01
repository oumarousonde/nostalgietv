import { prisma } from "../lib/prisma";

export async function addFavorite(userId: string, showId: string) {
  // upsert plutôt que create : appeler deux fois "ajouter en favori" ne doit jamais
  // planter avec une erreur de contrainte unique, juste ne rien faire de plus la 2e fois.
  return prisma.favorite.upsert({
    where: { userId_showId: { userId, showId } },
    create: { userId, showId },
    update: {},
  });
}

export async function removeFavorite(userId: string, showId: string) {
  // deleteMany plutôt que delete : ne plante pas si le favori n'existait déjà plus
  // (double-clic, requête rejouée) — retirer un favori absent n'est pas une erreur.
  return prisma.favorite.deleteMany({ where: { userId, showId } });
}

export async function getFavorites(userId: string) {
  return prisma.favorite.findMany({
    where: { userId },
    include: { show: { include: { images: true } } },
    orderBy: { createdAt: "desc" },
  });
}
