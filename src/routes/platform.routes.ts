import { Router } from "express";
import path from "path";
import express from "express";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { fetchBlobAsBase64, BlobFetchError } from "../services/blobFetcher";
import { InsufficientCreditsError } from "../services/creditLedger";
import { sendChatMessage, getConversation, listConversations, ChatError } from "../services/chat";
import { submitSupportMessage, getMySupportMessages, SupportError } from "../services/support";
import { supportContactRateLimit } from "../middleware/rateLimit";
import { runSearchCascade, LoginRequiredError } from "../services/searchCascade";
import { getAffiliateLinksForShow, getAffiliateLinksForEpisode } from "../services/affiliateLinks";
import { getActiveDonationChannels, buildDonationQrCodeUrl } from "../services/donations";
import { subscribeToShowAlert, AlertError } from "../services/alerts";
import { createCommunityShow, proposeSource } from "../services/community";
import { logSearchHistory, getSearchHistory } from "../services/searchHistory";
import { addFavorite, removeFavorite, getFavorites } from "../services/favorites";
import { submitReview, getReviewsForShow, ReviewError } from "../services/reviews";
import { generateSitemapXml, getPublicBaseUrl } from "../services/seo";
import { getPublicActivePromoCodes } from "../services/announcements";
import { getActiveSiteAnnouncements } from "../services/siteAnnouncements";
import { getVerifiedSourcesForEpisode } from "../services/admin";
import { getShowEpisodesWithAvailability } from "../services/showDetails";
import { t } from "../i18n/messages";
import { prisma } from "../lib/prisma";
import { fetchWatchProviders } from "../services/providers/tmdb";

export const platformRouter = Router();

// optionalAuth (pas requireAuth) : une recherche par titre est gratuite et doit
// rester utilisable sans compte. runSearchCascade ne réclame une connexion
// (LoginRequiredError, catché plus bas) que si elle atteint vraiment l'étape
// payante (description/lien/image/vidéo) — jamais avant, jamais "au cas où".
// /shows/:id/where-to-watch et /support/donation-channels restent publiques —
// pas de raison d'exiger un compte pour consulter des liens affiliés ou un numéro de don.
//
// Recherche textuelle uniquement (titre/description/lien) — JSON classique.
// Un seul endpoint pour les 5 modes désormais : titre/description/lien passent
// directement value en JSON ; images/vidéo passent des URLs Vercel Blob (voir
// POST /uploads/handshake pour obtenir ces URLs — le fichier lui-même ne
// transite jamais par cette route, seulement son URL une fois déjà uploadé).
// C'est ce qui permet de rester sous la limite de 4,5 Mo par requête des
// fonctions Vercel même pour une vidéo de 100 Mo — voir docs/08-deploiement.md.
platformRouter.post("/search", optionalAuth, async (req, res) => {
  const userId = req.auth?.userId ?? null;
  const { mode } = req.body;

  try {
    let query;

    if (mode === "title" || mode === "description" || mode === "link") {
      query = { mode, value: req.body.value };
    } else if (mode === "images") {
      const fileUrls: string[] = req.body.fileUrls ?? [];
      if (fileUrls.length === 0) {
        return res.status(400).json({ error: "Au moins une URL d'image est requise (fileUrls)" });
      }
      if (fileUrls.length > 5) {
        return res.status(400).json({ error: "5 images maximum par recherche" });
      }
      const files = await Promise.all(fileUrls.map((url) => fetchBlobAsBase64(url)));
      query = { mode: "images" as const, files };
    } else if (mode === "video") {
      if (!req.body.fileUrl) {
        return res.status(400).json({ error: "Une URL de vidéo est requise (fileUrl)" });
      }
      const { base64, mimeType } = await fetchBlobAsBase64(req.body.fileUrl);
      query = { mode: "video" as const, base64, mimeType };
    } else {
      return res.status(400).json({ error: "mode doit être title, description, link, images ou video" });
    }

    const outcome = await runSearchCascade(userId, query, req.locale);
    // Historique de recherche : lié à un compte par nature (SearchHistoryEntry.userId
    // est obligatoire en base) — une recherche par titre faite sans être connecté
    // n'est donc simplement pas journalisée, ce n'est pas une erreur.
    if (userId) {
      logSearchHistory(userId, query, outcome).catch((err) =>
        console.error("Échec de log d'historique", err)
      );
    }
    res.json(outcome);
  } catch (err) {
    if (err instanceof LoginRequiredError) {
      return res.status(401).json({ error: err.message });
    }
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: err.message });
    }
    if (err instanceof BlobFetchError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

// Plateformes officielles (Netflix, Prime, etc.) pour le pays du visiteur — données
// JustWatch fournies par TMDB. Pays = ?country=XX, sinon l'en-tête que Vercel ajoute
// d'après l'IP du visiteur (x-vercel-ip-country). Ne fait jamais échouer la page :
// en cas de problème on renvoie null et le front n'affiche simplement rien.
platformRouter.get("/shows/:showId/watch-providers", async (req, res) => {
  const show = await prisma.show.findUnique({
    where: { id: req.params.showId },
    select: { tmdbId: true, mediaType: true },
  });
  if (!show || !show.tmdbId || (show.mediaType !== "tv" && show.mediaType !== "movie")) {
    return res.json(null);
  }

  const headerCountry = req.headers["x-vercel-ip-country"];
  const country =
    typeof req.query.country === "string"
      ? req.query.country
      : typeof headerCountry === "string"
        ? headerCountry
        : null;

  try {
    const info = await fetchWatchProviders(show.tmdbId, show.mediaType, country);
    res.set("Cache-Control", "private, max-age=3600"); // privé : la réponse dépend du pays du visiteur
    res.json(info);
  } catch (err) {
    console.error(`watch providers indisponibles pour tmdbId=${show.tmdbId}`, err);
    res.json(null);
  }
});

platformRouter.get("/shows/:showId/where-to-watch", async (req, res) => {
  const links = await getAffiliateLinksForShow(req.params.showId);
  res.json(links);
});

// La vue "Badlands — 5 saisons, S01E03 et S01E09 manquants, disponibles chez
// Amazon" — tout en un seul appel plutôt que de recomposer côté client.
platformRouter.get("/shows/:showId/episodes", async (req, res) => {
  const details = await getShowEpisodesWithAvailability(req.params.showId);
  res.json(details);
});

// Répond précisément à "CET épisode manquant, où le trouver en payant" —
// distinct du lien générique série, qui ne dit pas si cet épisode précis y est inclus.
platformRouter.get("/episodes/:episodeId/where-to-watch", async (req, res) => {
  const links = await getAffiliateLinksForEpisode(req.params.episodeId);
  res.json(links);
});

// LE lien gratuit une fois l'épisode trouvé — c'était manquant jusqu'ici : la
// modération pouvait valider une source, mais rien ne la renvoyait à l'utilisateur.
platformRouter.get("/episodes/:episodeId/free-sources", async (req, res) => {
  const sources = await getVerifiedSourcesForEpisode(req.params.episodeId);
  res.json(sources);
});

platformRouter.get("/support/donation-channels", async (_req, res) => {
  const channels = await getActiveDonationChannels();
  res.json(
    channels.map((c) => ({
      provider: c.provider,
      display: `${c.countryCode} ${c.phoneNumber}`,
      qrCodeUrl: buildDonationQrCodeUrl(c.countryCode, c.phoneNumber),
    }))
  );
});

// Pas de compte requis : quelqu'un qui cherche une série qu'on n'a pas trouvée doit
// pouvoir juste laisser son numéro pour être prévenu, sans friction supplémentaire.
platformRouter.post("/shows/:showId/alerts", optionalAuth, async (req, res) => {
  try {
    const subscription = await subscribeToShowAlert({
      showId: req.params.showId,
      phoneNumber: req.body.phoneNumber,
      userId: req.auth?.userId, // rempli automatiquement si un token était fourni, sinon undefined
      locale: req.locale,
    });
    res.status(201).json(subscription);
  } catch (err) {
    if (err instanceof AlertError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// "On n'a rien trouvé" → la communauté ouvre une piste, compte requis pour la traçabilité.
platformRouter.post("/shows/community", requireAuth, async (req, res) => {
  const { title, description } = req.body;
  const show = await createCommunityShow({ title, description, locale: req.locale });
  res.status(201).json(show);
});

// "Ah, je sais où ça se trouve" — proposition de lien, mise en file de modération.
platformRouter.post("/episodes/:episodeId/sources", requireAuth, async (req, res) => {
  const source = await proposeSource({
    episodeId: req.params.episodeId,
    url: req.body.url,
    quality: req.body.quality,
    submittedByUserId: req.auth!.userId,
  });
  res.status(201).json({
    ...source,
    message: t("sourceProposalThanks", req.locale),
  });
});

// ============================================================
// HISTORIQUE — "qu'est-ce que j'ai cherché avant"
// ============================================================

platformRouter.get("/me/history", requireAuth, async (req, res) => {
  const history = await getSearchHistory(req.auth!.userId);
  res.json(history);
});

// ============================================================
// FAVORIS
// ============================================================

platformRouter.post("/shows/:showId/favorite", requireAuth, async (req, res) => {
  const favorite = await addFavorite(req.auth!.userId, req.params.showId);
  res.status(201).json(favorite);
});

platformRouter.delete("/shows/:showId/favorite", requireAuth, async (req, res) => {
  await removeFavorite(req.auth!.userId, req.params.showId);
  res.status(204).send();
});

platformRouter.get("/me/favorites", requireAuth, async (req, res) => {
  const favorites = await getFavorites(req.auth!.userId);
  res.json(favorites);
});

// ============================================================
// AVIS — jusqu'ici seulement un modèle en base, sans route pour s'en servir
// ============================================================

// episodeId optionnel dans le body : présent = avis sur cet épisode précis,
// absent = avis sur la série/le film entier — voir services/reviews.ts.
platformRouter.post("/shows/:showId/reviews", requireAuth, async (req, res) => {
  try {
    const review = await submitReview({
      showId: req.params.showId,
      episodeId: req.body.episodeId,
      userId: req.auth!.userId,
      rating: req.body.rating,
      comment: req.body.comment,
      locale: req.locale,
    });
    res.status(201).json(review);
  } catch (err) {
    if (err instanceof ReviewError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// ?episodeId=... en query pour ne récupérer que les avis d'un épisode précis,
// sinon tous les avis de la fiche (série + épisodes confondus).
platformRouter.get("/shows/:showId/reviews", async (req, res) => {
  const episodeId = typeof req.query.episodeId === "string" ? req.query.episodeId : undefined;
  const reviews = await getReviewsForShow(req.params.showId, episodeId);
  res.json(reviews);
});

// ============================================================
// SEO — sitemap public pour l'indexation Google
// ============================================================

platformRouter.get("/sitemap.xml", async (_req, res) => {
  const xml = await generateSitemapXml();
  res.type("application/xml").send(xml);
});

// Sert le site (la maquette) à la racine du domaine Vercel, pour que le
// domaine affiche vraiment le site et pas juste l'état de l'API en JSON.
// process.cwd() = racine du projet côté serveur (où se trouve le dossier
// maquette/), aussi bien en local qu'une fois déployé sur Vercel grâce à
// "includeFiles" dans vercel.json (sans ça, ce fichier n'existerait pas au
// moment de l'exécution — Vercel n'embarque que ce qui est explicitement listé).
platformRouter.get("/", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "maquette", "nostalgietv-maquette.html"));
});

platformRouter.get("/admin", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "maquette", "nostalgietv-admin.html"));
});

// Logo, favicon et manifest PWA (icône + nom quand on "ajoute à l'écran d'accueil"
// sur mobile). express.static sert tout le contenu de maquette/icons/ tel quel ;
// res.sendFile fixe le bon Content-Type d'après l'extension RÉELLE du fichier
// (image/png), peu importe que l'URL demandée se termine en .ico — les
// navigateurs se basent sur ce header, pas sur l'URL, donc ça fonctionne
// normalement malgré ce décalage d'extension.
platformRouter.use("/icons", express.static(path.join(process.cwd(), "maquette", "icons")));
platformRouter.get("/manifest.json", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "maquette", "manifest.json"));
});
platformRouter.get("/favicon.ico", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "maquette", "icons", "favicon-64.png"));
});

// L'état JSON de l'API reste disponible, juste déplacé pour laisser "/" au site.
platformRouter.get("/status", (_req, res) => {
  res.json({
    name: "NostalgieTV API",
    status: "ok",
    endpoints: ["/robots.txt", "/sitemap.xml", "/promo-codes/active", "/support/donation-channels"],
  });
});

platformRouter.get("/robots.txt", (_req, res) => {
  const baseUrl = getPublicBaseUrl();
  res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

// Publique, sans authentification : c'est ce qui permet au bandeau d'être visible
// par n'importe qui ouvre l'app, connecté ou non — voir services/announcements.ts.
platformRouter.get("/promo-codes/active", async (_req, res) => {
  const codes = await getPublicActivePromoCodes();
  res.json(
    codes.map((c) => ({
      code: c.code,
      creditAmount: c.creditAmount,
      expiresAt: c.expiresAt,
    }))
  );
});

// Publique, sans authentification — même logique que /promo-codes/active
// juste au-dessus. Voir services/siteAnnouncements.ts.
platformRouter.get("/site-announcements/active", async (_req, res) => {
  const announcements = await getActiveSiteAnnouncements();
  res.json(announcements.map((a) => ({ id: a.id, message: a.message, createdAt: a.createdAt })));
});

// ============================================================
// CHATBOT — payant en crédits, message d'erreur qui pointe vers /support/contact
// ============================================================

platformRouter.post("/chat/messages", requireAuth, async (req, res) => {
  try {
    const result = await sendChatMessage({
      userId: req.auth!.userId,
      conversationId: req.body.conversationId,
      message: req.body.message,
      locale: req.locale,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ChatError) return res.status(402).json({ error: err.message });
    if (err instanceof InsufficientCreditsError) return res.status(402).json({ error: err.message });
    throw err;
  }
});

platformRouter.get("/chat/conversations", requireAuth, async (req, res) => {
  const conversations = await listConversations(req.auth!.userId);
  res.json(conversations);
});

platformRouter.get("/chat/conversations/:id", requireAuth, async (req, res) => {
  try {
    const conversation = await getConversation(req.auth!.userId, req.params.id, req.locale);
    res.json(conversation);
  } catch (err) {
    if (err instanceof ChatError) return res.status(404).json({ error: err.message });
    throw err;
  }
});

// ============================================================
// CONTACT ADMIN — le canal pour ceux qui n'ont plus de crédits (ou toute autre demande)
// ============================================================

platformRouter.post("/support/contact", requireAuth, supportContactRateLimit, async (req, res) => {
  try {
    const message = await submitSupportMessage({
      userId: req.auth!.userId,
      subject: req.body.subject,
      message: req.body.message,
      showId: req.body.showId,
      episodeId: req.body.episodeId,
      locale: req.locale,
    });
    res.status(201).json(message);
  } catch (err) {
    if (err instanceof SupportError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

platformRouter.get("/support/my-messages", requireAuth, async (req, res) => {
  const messages = await getMySupportMessages(req.auth!.userId);
  res.json(messages);
});
