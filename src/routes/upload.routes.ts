import { Router } from "express";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAuth } from "../middleware/auth";

export const uploadRouter = Router();

/**
 * Poignée de main pour l'upload direct navigateur → Vercel Blob. Le fichier
 * lui-même ne passe JAMAIS par cette route ni par aucune de nos fonctions —
 * seul un jeton transite ici, ce qui contourne la limite de 4,5 Mo par requête
 * des fonctions Vercel (voir docs/08-deploiement.md pour le détail du flux).
 *
 * Authentification : requireAuth s'applique globalement à ce routeur, donc
 * seul un utilisateur connecté peut obtenir un jeton d'upload — sinon
 * n'importe qui pourrait remplir le stockage Blob à nos frais.
 */
uploadRouter.use(requireAuth);

uploadRouter.post("/uploads/handshake", async (req, res) => {
  const body = req.body as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // N'accepte que des images/vidéos, avec une limite de taille — Vercel
        // Blob lui-même n'a pas de limite basse, mais on n'a aucune raison
        // d'accepter un fichier de plusieurs Go pour une recherche Gemini.
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 Mo — large mais borné
          tokenPayload: JSON.stringify({ userId: req.auth!.userId }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // Rien à faire ici pour l'instant — le client récupère blob.url
        // directement en réponse de upload() côté navigateur et l'envoie
        // ensuite à /search. Ce hook existe pour un usage futur (ex. logguer
        // l'upload, déclencher un traitement asynchrone).
        console.log("Upload Vercel Blob terminé :", blob.url);
      },
    });

    res.json(jsonResponse);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
