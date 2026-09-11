import { Router } from "express";
import { runValidateReferralsJob } from "../jobs/validateReferrals";

export const cronRouter = Router();

/**
 * Appelé par Vercel Cron Jobs (voir vercel.json), pas par un cron interne — sur
 * Vercel, aucune fonction ne reste allumée entre deux requêtes pour qu'un cron
 * interne type node-cron ait un sens (voir app.ts).
 *
 * Protection par secret : sans ça, cette route serait un GET public qui
 * déclencherait le job à la demande pour n'importe qui — y compris l'envoi de
 * SMS aux abonnés (voir alerts.ts), donc un vecteur de spam si laissé ouvert.
 * Vercel envoie automatiquement `Authorization: Bearer <CRON_SECRET>` sur les
 * requêtes qu'il déclenche lui-même, dès que CRON_SECRET est défini dans les
 * variables d'environnement du projet Vercel.
 */
cronRouter.get("/internal/cron/validate-referrals", async (req, res) => {
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || req.headers.authorization !== expectedAuth) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const result = await runValidateReferralsJob();
  res.json({ ok: true, ...result });
});
