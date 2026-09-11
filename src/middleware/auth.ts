import { Request, Response, NextFunction } from "express";
import { verifyJwt, AuthError } from "../services/auth";
import { t } from "../i18n/messages";

// Étend le type Request d'Express pour que `req.auth.userId` soit reconnu
// par TypeScript partout où il est utilisé dans les routes existantes.
declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; role: "member" | "admin" };
    }
  }
}

/**
 * Exige un token JWT valide dans l'en-tête Authorization (format "Bearer <token>").
 * À placer avant toute route qui suppose req.auth.userId — c'est-à-dire
 * quasiment toutes les routes de platform.routes.ts, referral.routes.ts, admin.routes.ts.
 *
 * req.locale est garanti défini ici : detectLocale tourne globalement dans app.ts
 * avant tous les routers, donc avant ce middleware.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: t("authRequired", req.locale) });
  }

  const token = header.slice("Bearer ".length);

  try {
    const decoded = verifyJwt(token, req.locale);
    req.auth = { userId: decoded.userId, role: decoded.role };
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({ error: err.message });
    }
    throw err;
  }
}

/**
 * À chaîner APRÈS requireAuth. Certaines routes admin.routes.ts vérifient déjà
 * le rôle côté service (voir admin.ts assertIsAdmin) — ce middleware ajoute une
 * deuxième barrière au niveau HTTP, pour renvoyer un 403 propre avant même
 * d'exécuter la logique métier.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role !== "admin") {
    return res.status(403).json({ error: t("adminOnly", req.locale) });
  }
  next();
}

/**
 * Ne bloque JAMAIS la requête, contrairement à requireAuth. Utile pour les routes
 * publiques (ex. s'abonner à une alerte avec juste un numéro) qui veulent quand même
 * rattacher un userId si la personne est connectée, sans l'exiger.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();

  try {
    const decoded = verifyJwt(header.slice("Bearer ".length), req.locale);
    req.auth = { userId: decoded.userId, role: decoded.role };
  } catch {
    // Token présent mais invalide/expiré : on continue quand même en mode anonyme
    // plutôt que de bloquer une action qui ne l'exigeait pas.
  }
  next();
}
