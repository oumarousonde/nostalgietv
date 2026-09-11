import { prisma } from "../lib/prisma";
import { Locale } from "../middleware/locale";
import { t } from "../i18n/messages";

export class SupportError extends Error {}

export async function submitSupportMessage(params: {
  userId: string;
  subject: string;
  message: string;
  showId?: string;
  episodeId?: string;
  locale: Locale;
}) {
  if (params.subject.trim().length === 0) {
    throw new SupportError(t("supportSubjectRequired", params.locale));
  }
  if (params.message.trim().length === 0) {
    throw new SupportError(t("supportMessageRequired", params.locale));
  }

  return prisma.supportMessage.create({
    data: {
      userId: params.userId,
      subject: params.subject,
      message: params.message,
      showId: params.showId,
      episodeId: params.episodeId,
    },
  });
}

export async function getMySupportMessages(userId: string) {
  return prisma.supportMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

// --- côté admin ---

export async function getOpenSupportMessages() {
  return prisma.supportMessage.findMany({
    where: { status: "open" },
    include: {
      user: { select: { email: true } },
      show: { select: { id: true, title: true } },
      episode: { select: { id: true, season: true, episode: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function replySupportMessage(messageId: string, adminReply: string) {
  return prisma.supportMessage.update({
    where: { id: messageId },
    data: { adminReply, status: "answered", repliedAt: new Date() },
  });
}
