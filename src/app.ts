import express from "express";
// DOIT être importé avant toute définition de route. Express 4 (contrairement à
// Express 5) ne route JAMAIS automatiquement une erreur venant d'un handler async
// vers le middleware d'erreur ci-dessous — même un "throw err" dans un catch async
// ne fait que créer une "unhandledRejection" silencieuse, et la requête reste
// bloquée sans jamais répondre. Ce module patche Express pour que ça fonctionne
// enfin comme on l'attend, sans avoir à réécrire chaque route une par une.
import "express-async-errors";
import cors from "cors";
import cron from "node-cron";
import { detectLocale } from "./middleware/locale";
import { authRouter } from "./routes/auth.routes";
import { referralRouter } from "./routes/referral.routes";
import { platformRouter } from "./routes/platform.routes";
import { adminRouter } from "./routes/admin.routes";
import { uploadRouter } from "./routes/upload.routes";
import { cronRouter } from "./routes/cron.routes";
import { runValidateReferralsJob } from "./jobs/validateReferrals";

const app = express();

// Nécessaire dès que l'API tourne derrière un proxy (Vercel, Railway, Render, etc.).
// Sans ça, req.ip renvoie l'IP du proxy pour TOUTES les requêtes, pas celle du vrai
// visiteur — ce qui casse silencieusement le signal anti-fraude du parrainage
// (signupIp, voir docs/03).
// "1" = fait confiance au premier proxy devant l'app, le cas standard sur ces
// plateformes (un seul saut de proxy, pas une chaîne de plusieurs).
app.set("trust proxy", 1);

// Sans CORS, un frontend hébergé sur un autre domaine (ex. Netlify) verrait TOUTES
// ses requêtes bloquées par le navigateur, silencieusement.
// CORS_ORIGIN : liste de domaines autorisés séparés par des virgules. Vide/absent
// = tout autorisé (pratique en développement, à restreindre explicitement en prod).
const allowedOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim());
app.use(cors({ origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : true }));

// Limite volontairement basse : depuis le passage à Vercel Blob pour les
// images/vidéos (voir routes/upload.routes.ts), plus aucune requête ne devrait
// transporter du contenu volumineux — seulement des URLs, du texte, des identifiants.
app.use(express.json({ limit: "1mb" }));
app.use(detectLocale); // remplit req.locale ("fr" | "en") à partir de ?lang= ou Accept-Language

app.use(authRouter);
app.use(referralRouter);
app.use(platformRouter);
app.use(adminRouter);
app.use(uploadRouter);
app.use(cronRouter);

// Gestionnaire d'erreurs générique — évite qu'une exception non prévue fasse
// planter le process ou renvoie une stack trace brute au client.
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur interne" });
  }
);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// process.env.VERCEL est défini automatiquement par Vercel sur ses fonctions.
// Sur Vercel, une fonction serverless n'a PAS de process qui reste allumé entre
// deux requêtes — un cron interne (node-cron/setInterval) ne se déclencherait
// jamais de façon fiable, voire jamais du tout. Le job y est plutôt appelé via
// un vrai Vercel Cron Job qui fait une requête HTTP (voir routes/cron.routes.ts
// et vercel.json) — c'est LUI qui remplace node-cron sur cette plateforme.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`NostalgieTV API démarrée sur le port ${PORT}`);
  });

  if (!process.env.VERCEL) {
    // Pertinent seulement pour un serveur qui reste allumé en continu (local,
    // Railway, Render...) — jamais sur Vercel, voir commentaire ci-dessus.
    cron.schedule("0 * * * *", () => {
      runValidateReferralsJob().catch((err) =>
        console.error("Échec du job de validation des parrainages", err)
      );
    });
  }
}

export { app };
