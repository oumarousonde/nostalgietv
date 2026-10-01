/**
 * Une fois le fichier uploadé directement navigateur → Vercel Blob (voir
 * routes/upload.routes.ts), notre fonction a juste besoin de le récupérer pour
 * le passer à Gemini. Ce fetch-là n'est PAS soumis à la limite de 4,5 Mo des
 * fonctions Vercel — cette limite ne s'applique qu'aux requêtes ENTRANTES vers
 * une fonction, pas aux appels sortants qu'elle fait elle-même.
 */

const MAX_FETCH_BYTES = 100 * 1024 * 1024; // même plafond que l'upload lui-même

export class BlobFetchError extends Error {}

export async function fetchBlobAsBase64(
  url: string
): Promise<{ base64: string; mimeType: string }> {
  assertIsVercelBlobUrl(url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new BlobFetchError(`Impossible de récupérer le fichier uploadé (${response.status})`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_FETCH_BYTES) {
    throw new BlobFetchError("Fichier trop volumineux");
  }

  const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  return { base64, mimeType };
}

/**
 * N'accepte QUE des URLs venant de notre propre stockage Vercel Blob — sinon
 * cette fonction deviendrait un proxy de fetch arbitraire pour n'importe quelle
 * URL fournie par l'utilisateur (même risque que le mode "lien" de la
 * recherche, voir linkScraper.ts).
 */
function assertIsVercelBlobUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlobFetchError("URL de fichier invalide");
  }

  const isVercelBlob =
    url.hostname.endsWith(".public.blob.vercel-storage.com") ||
    url.hostname.endsWith(".vercel-storage.com");

  if (!isVercelBlob) {
    throw new BlobFetchError("Seuls les fichiers uploadés via Vercel Blob sont acceptés");
  }
}
