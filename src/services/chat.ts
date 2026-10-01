import { prisma } from "../lib/prisma";
import { spendCreditsForSearch, InsufficientCreditsError } from "./creditLedger";
import { chatWithGemini, ChatTurn } from "./providers/gemini";
import { CHAT_MESSAGE_COST_CREDITS } from "../config/providers";
import { Locale } from "../middleware/locale";
import { t } from "../i18n/messages";

export class ChatError extends Error {}

/**
 * Envoie un message au chatbot. Débite les crédits AVANT l'appel Gemini (même
 * principe que la recherche — voir searchCascade.ts) pour ne jamais laisser
 * quelqu'un enchaîner des appels au-delà de son solde réel via des requêtes
 * simultanées.
 *
 * Si le solde est insuffisant, le message d'erreur oriente explicitement vers
 * /support/contact — c'est le lien demandé entre "pas de crédits" et "contacter
 * l'administration" plutôt que deux fonctionnalités isolées l'une de l'autre.
 */
export async function sendChatMessage(params: {
  userId: string;
  conversationId?: string;
  message: string;
  locale: Locale;
}) {
  const conversation = params.conversationId
    ? await prisma.chatConversation.findUnique({
        where: { id: params.conversationId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    : null;

  if (params.conversationId && (!conversation || conversation.userId !== params.userId)) {
    // Le "|| conversation.userId !== params.userId" empêche qu'un utilisateur lise
    // ou continue la conversation de quelqu'un d'autre en devinant un id.
    throw new ChatError(t("conversationNotFound", params.locale));
  }

  const requestId = crypto.randomUUID();

  try {
    await spendCreditsForSearch(params.userId, CHAT_MESSAGE_COST_CREDITS, requestId);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      throw new ChatError(t("chatInsufficientCredits", params.locale));
    }
    throw err;
  }

  const activeConversation =
    conversation ??
    (await prisma.chatConversation.create({
      data: { userId: params.userId, title: params.message.slice(0, 60) },
      include: { messages: true },
    }));

  const history: ChatTurn[] = [
    ...activeConversation.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: params.message },
  ];

  const replyText = await chatWithGemini(history);

  // Les deux messages (utilisateur + assistant) sont enregistrés ensemble : jamais
  // l'un sans l'autre, sinon l'historique renvoyé à Gemini au tour suivant serait
  // incohérent (un message utilisateur sans réponse, ou l'inverse).
  await prisma.chatMessage.createMany({
    data: [
      { conversationId: activeConversation.id, role: "user", content: params.message },
      { conversationId: activeConversation.id, role: "assistant", content: replyText },
    ],
  });

  return {
    conversationId: activeConversation.id,
    reply: replyText,
    creditsSpent: CHAT_MESSAGE_COST_CREDITS,
  };
}

export async function getConversation(userId: string, conversationId: string, locale: Locale) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conversation || conversation.userId !== userId) {
    throw new ChatError(t("conversationNotFound", locale));
  }

  return conversation;
}

export async function listConversations(userId: string) {
  return prisma.chatConversation.findMany({
    where: { userId },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}
