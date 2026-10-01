import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { redeemPromoCode, PromoCodeError } from "../services/promoCode";
import { getBalance } from "../services/creditLedger";
import { getActiveAnnouncementsForUser, dismissAnnouncement } from "../services/announcements";
import { promoRedeemRateLimit } from "../middleware/rateLimit";

// Renommé depuis referral.routes.ts : ce fichier n'a jamais contenu de logique
// de parrainage (retiré du projet — voir services/userAccount.ts), juste les
// crédits et les codes promo. L'inscription vit dans auth.routes.ts.
export const creditsRouter = Router();

creditsRouter.post("/promo/redeem", requireAuth, promoRedeemRateLimit, async (req, res) => {
  const userId = req.auth!.userId;
  const { code } = req.body;

  try {
    const result = await redeemPromoCode(userId, code, req.locale);
    res.json(result);
  } catch (err) {
    if (err instanceof PromoCodeError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

creditsRouter.get("/credits/balance", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const balance = await getBalance(userId);
  res.json({ balance });
});

// À appeler à chaque ouverture de l'app / connexion : renvoie les codes promo actifs
// que CET utilisateur n'a pas encore vus ni utilisés — c'est le bandeau d'annonce.
creditsRouter.get("/me/announcements", requireAuth, async (req, res) => {
  const announcements = await getActiveAnnouncementsForUser(req.auth!.userId);
  res.json(announcements);
});

// À appeler quand l'utilisateur ferme le bandeau — sinon il reviendrait à chaque
// connexion tant que le code reste actif.
creditsRouter.post("/me/announcements/:code/dismiss", requireAuth, async (req, res) => {
  await dismissAnnouncement(req.auth!.userId, req.params.code);
  res.status(204).send();
});
