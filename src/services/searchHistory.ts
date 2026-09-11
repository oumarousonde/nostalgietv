import { prisma } from "../lib/prisma";
import { SearchQuery, SearchOutcome } from "./searchCascade";

/**
 * Log chaque recherche effectuée par un utilisateur connecté, résultat trouvé ou non —
 * l'historique doit aussi montrer "j'ai cherché ça la semaine dernière, toujours rien"
 * pas seulement les succès.
 */
export async function logSearchHistory(
  userId: string,
  query: SearchQuery,
  outcome: SearchOutcome
) {
  return prisma.searchHistoryEntry.create({
    data: {
      userId,
      mode: query.mode,
      // Pas de texte à stocker pour images/vidéo — évite aussi de garder en base
      // le contenu potentiellement sensible d'une recherche par fichier.
      queryText: query.mode === "images" || query.mode === "video" ? null : query.value,
      matchedShowId: outcome.matchedShowId,
      providerUsed: outcome.providerUsed,
    },
  });
}

export async function getSearchHistory(userId: string, limit = 50) {
  return prisma.searchHistoryEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
