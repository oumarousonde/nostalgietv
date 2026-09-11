import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { redeemPromoCode, PromoCodeError } from "../services/promoCode";
import { getBalance } from "../services/creditLedger";
import { getActiveAnnouncementsForUser, dismissAnnouncement } from "../services/announcements";
import { promoRedeemRateLimit } from "../middleware/rateLimit";

// L'inscription vit désormais dans auth.routes.ts (POST /auth/signup) — c'est la
// seule route qui doit créer un compte, puisqu'elle seule gère le hash du mot de
// passe et le token de vérification email.
export const referralRouter = Router();

referralRouter.use(requireAuth);

referralRouter.post("/promo/redeem", promoRedeemRateLimit, async (req, res) => {
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

referralRouter.get("/credits/balance", async (req, res) => {
  const userId = req.auth!.userId;
  const balance = await getBalance(userId);
  res.json({ balance });
});

// À appeler à chaque ouverture de l'app / connexion : renvoie les codes promo actifs
// que CET utilisateur n'a pas encore vus ni utilisés — c'est le bandeau d'annonce.
referralRouter.get("/me/announcements", async (req, res) => {
  const announcements = await getActiveAnnouncementsForUser(req.auth!.userId);
  res.json(announcements);
});

// À appeler quand l'utilisateur ferme le bandeau — sinon il reviendrait à chaque
// connexion tant que le code reste actif.
referralRouter.post("/me/announcements/:code/dismiss", async (req, res) => {
  await dismissAnnouncement(req.auth!.userId, req.params.code);
  res.status(204).send();
});
