import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  grantCreditsToUser,
  getPendingSources,
  approveSource,
  rejectSource,
  AdminActionError,
} from "../services/admin";
import { addAffiliateLink } from "../services/affiliateLinks";
import { createPromoCode, PromoCodeError } from "../services/promoCode";
import { getOpenSupportMessages, replySupportMessage } from "../services/support";

export const adminRouter = Router();

// Double barrière volontaire : requireAdmin bloque au niveau HTTP (403 propre,
// rapide), et chaque fonction de services/admin.ts revérifie aussi le rôle
// (assertIsAdmin) pour rester sûre même si elle est appelée autrement qu'via
// ces routes (job interne, script d'admin, etc.).
adminRouter.use(requireAuth, requireAdmin);

adminRouter.post("/admin/credits/grant", async (req, res) => {
  const adminId = req.auth!.userId;
  const { targetUserId, amount, reason } = req.body;

  try {
    const tx = await grantCreditsToUser({ adminId, targetUserId, amount, reason, locale: req.locale });
    res.json(tx);
  } catch (err) {
    if (err instanceof AdminActionError) {
      return res.status(403).json({ error: err.message });
    }
    throw err;
  }
});

adminRouter.get("/admin/moderation/pending-sources", async (_req, res) => {
  const sources = await getPendingSources();
  res.json(sources);
});

adminRouter.post("/admin/moderation/sources/:id/approve", async (req, res) => {
  try {
    const source = await approveSource(req.auth!.userId, req.params.id, req.locale);
    res.json(source);
  } catch (err) {
    if (err instanceof AdminActionError) return res.status(403).json({ error: err.message });
    throw err;
  }
});

adminRouter.post("/admin/moderation/sources/:id/reject", async (req, res) => {
  try {
    await rejectSource(req.auth!.userId, req.params.id, req.locale);
    res.status(204).send();
  } catch (err) {
    if (err instanceof AdminActionError) return res.status(403).json({ error: err.message });
    throw err;
  }
});

// episodeId optionnel dans le body : présent = lien scopé à un épisode précis,
// absent = lien couvrant toute la série. Voir services/affiliateLinks.ts.
adminRouter.post("/admin/shows/:showId/affiliate-links", async (req, res) => {
  const { platformKey, url, priceLabel, episodeId, quality } = req.body;
  try {
    const link = await addAffiliateLink({
      showId: req.params.showId,
      episodeId,
      platformKey,
      url,
      priceLabel,
      quality,
    });
    res.status(201).json(link);
  } catch (err: any) {
    // Cas le plus probable : AMAZON_ASSOCIATE_TAG absent de l'environnement —
    // erreur claire plutôt qu'un 500 générique qui ne dit pas quoi corriger.
    if (err.message?.includes("AMAZON_ASSOCIATE_TAG")) {
      return res.status(500).json({
        error: "AMAZON_ASSOCIATE_TAG n'est pas configuré côté serveur — impossible de générer un lien affilié Amazon sans ça.",
      });
    }
    throw err;
  }
});

// Occasionnel, à la demande — pas de tâche planifiée : l'admin crée un code quand
// il veut (campagne ponctuelle, geste commercial groupé), pas selon un calendrier.
adminRouter.post("/admin/promo-codes", async (req, res) => {
  const { code, creditAmount, maxUses, expiresAt, announce } = req.body;
  try {
    const promoCode = await createPromoCode({
      code,
      creditAmount,
      maxUses,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      announce, // true par défaut si absent (voir promoCode.ts) — bandeau vu par tous
      locale: req.locale,
    });
    res.status(201).json(promoCode);
  } catch (err) {
    if (err instanceof PromoCodeError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

adminRouter.get("/admin/support/messages", async (_req, res) => {
  const messages = await getOpenSupportMessages();
  res.json(messages);
});

adminRouter.post("/admin/support/messages/:id/reply", async (req, res) => {
  const message = await replySupportMessage(req.params.id, req.body.adminReply);
  res.json(message);
});
