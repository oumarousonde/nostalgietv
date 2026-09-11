import rateLimit from "express-rate-limit";

/**
 * /auth/login n'avait AUCUNE limite jusqu'ici : un attaquant pouvait essayer autant
 * de mots de passe qu'il voulait sur un email donné, sans blocage ni délai. 10
 * tentatives / 15 min par IP est volontairement strict — un vrai utilisateur qui se
 * trompe de mot de passe ne les atteint jamais en usage normal.
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion, réessaie dans quelques minutes." },
});

/**
 * /auth/signup : plus souple que login (créer un compte n'est pas une tentative
 * d'intrusion), mais toujours limité pour empêcher la création de comptes en masse
 * (contournement du système anti-fraude de parrainage, voir docs/03).
 */
export const signupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de comptes créés depuis cette adresse, réessaie plus tard." },
});

/**
 * /promo/redeem : sans limite, quelqu'un pourrait essayer de deviner un code promo
 * valide par essais répétés (surtout si le code est court/mémorable, ex. "PROMO5").
 * La limite quotidienne par utilisateur (voir services/promoCode.ts) protège contre
 * l'abus UNE FOIS un code trouvé, mais pas contre la recherche du code lui-même.
 */
export const promoRedeemRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives de code promo, réessaie dans une heure." },
});

/**
 * /support/contact ne coûte aucun crédit (contrairement au chat) — sans limite,
 * quelqu'un pourrait inonder la file d'attente de l'admin en boucle.
 */
export const supportContactRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de messages envoyés, réessaie dans une heure." },
});
