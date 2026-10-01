import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  grantCreditsToUser,
  getPendingSources,
  approveSource,
  rejectSource,
  findUserByIdentifier,
  AdminActionError,
} from "../services/admin";
import { addAffiliateLink } from "../services/affiliateLinks";
import { notifySubscribersOfShow } from "../services/alerts";
import { createPromoCode, PromoCodeError } from "../services/promoCode";
import { getOpenSupportMessages, replySupportMessage } from "../services/support";
import { searchYoutubeCandidates } from "../services/providers/youtube";
import { createSiteAnnouncement, deactivateSiteAnnouncement } from "../services/siteAnnouncements";

export const adminRouter = Router();

// Double barrière volontaire : requireAdmin bloque au niveau HTTP (403 propre,
// rapide), et chaque fonction de services/admin.ts revérifie aussi le rôle
// (assertIsAdmin) pour rester sûre même si elle est appelée autrement qu'via
// ces routes (job interne, script d'admin, etc.).
//
// requireAuth/requireAdmin sont appliqués route par route ci-dessous (pas via
// .use() global) — un .use() sans chemin intercepterait TOUTE requête entrant
// dans ce routeur, y compris des chemins qu'il ne gère pas, transformant un
// simple 404 en 401/403 (voir l'incident réel du même genre dans
// credits.routes.ts, qui lui cassait aussi de vraies routes publiques).

adminRouter.post("/admin/credits/grant", requireAuth, requireAdmin, async (req, res) => {
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

adminRouter.get("/admin/moderation/pending-sources", requireAuth, requireAdmin, async (_req, res) => {
  const sources = await getPendingSources();
  res.json(sources);
});

adminRouter.post("/admin/moderation/sources/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const source = await approveSource(req.auth!.userId, req.params.id, req.locale);
    res.json(source);
  } catch (err) {
    if (err instanceof AdminActionError) return res.status(403).json({ error: err.message });
    throw err;
  }
});

adminRouter.post("/admin/moderation/sources/:id/reject", requireAuth, requireAdmin, async (req, res) => {
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
adminRouter.post("/admin/shows/:showId/affiliate-links", requireAuth, requireAdmin, async (req, res) => {
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
    // Lien valable pour TOUTE la série (pas un épisode précis) : on prévient ceux
    // qui avaient demandé à être alertés. Ne bloque jamais l'ajout du lien si l'envoi échoue.
    if (!episodeId) {
      notifySubscribersOfShow(req.params.showId, {
        fr: "un lien pour la regarder est maintenant disponible.",
        en: "a link to watch it is now available.",
      }).catch((e) => console.error("Échec de notification après ajout d'un lien de série", e));
    }
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
adminRouter.post("/admin/promo-codes", requireAuth, requireAdmin, async (req, res) => {
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

adminRouter.get("/admin/support/messages", requireAuth, requireAdmin, async (_req, res) => {
  const messages = await getOpenSupportMessages();
  res.json(messages);
});

adminRouter.post("/admin/support/messages/:id/reply", requireAuth, requireAdmin, async (req, res) => {
  const message = await replySupportMessage(req.params.id, req.body.adminReply);
  res.json(message);
});

// Aide à la recherche de pistes pour un épisode manquant — résultats à vérifier
// à la main, jamais une source de confiance automatique (voir providers/youtube.ts).
adminRouter.get("/admin/youtube-search", requireAuth, requireAdmin, async (req, res) => {
  const query = req.query.q;
  if (typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({ error: "Paramètre 'q' requis" });
  }

  try {
    const candidates = await searchYoutubeCandidates(query);
    res.json(candidates);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Bandeau d'annonce affiché en page d'accueil — voir services/siteAnnouncements.ts.
// Pont numéro (ou email) -> userId pour l'écran "donner des crédits" : un admin connaît
// le numéro d'un membre, jamais son id interne.
adminRouter.get("/admin/users/lookup", requireAuth, requireAdmin, async (req, res) => {
  const identifier = req.query.identifier ?? req.query.phone ?? req.query.email;
  if (typeof identifier !== "string" || identifier.trim().length === 0) {
    return res.status(400).json({ error: "Paramètre 'identifier' requis (numéro de téléphone ou email)" });
  }
  const user = await findUserByIdentifier(identifier);
  if (!user) {
    return res.status(404).json({ error: "Aucun compte avec ce numéro ou cet email" });
  }
  res.json(user);
});

adminRouter.post("/admin/site-announcements", requireAuth, requireAdmin, async (req, res) => {
  try {
    const announcement = await createSiteAnnouncement(req.body.message ?? "");
    res.status(201).json(announcement);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.post("/admin/site-announcements/:id/deactivate", requireAuth, requireAdmin, async (req, res) => {
  await deactivateSiteAnnouncement(req.params.id);
  res.status(204).send();
});
