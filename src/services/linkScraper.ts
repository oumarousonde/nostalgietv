/**
 * Récupère et nettoie le texte d'une page web fournie par l'utilisateur (mode "lien"),
 * avant de le passer à Gemini.
 */
import { Locale } from "../middleware/locale";
import { t } from "../i18n/messages";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 2_000_000; // 2 Mo — au-delà, la page est jugée trop lourde à traiter
const MAX_EXTRACTED_CHARS = 4_000; // suffisant pour Gemini, évite de gonfler le prompt inutilement

export class LinkScrapeError extends Error {}

export async function scrapeUrlText(rawUrl: string, locale: Locale = "fr"): Promise<string> {
  const url = parseAndValidateUrl(rawUrl, locale);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "NostalgieTV-Bot/1.0 (+recherche d'oeuvres perdues)" },
      redirect: "follow",
    });
  } catch {
    throw new LinkScrapeError(t("linkUnreachable", locale));
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new LinkScrapeError(`${t("linkHttpError", locale)} (${response.status})`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_HTML_BYTES) {
    throw new LinkScrapeError(t("linkTooLarge", locale));
  }

  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  const text = stripHtmlToText(html);

  if (text.length === 0) {
    throw new LinkScrapeError(t("linkNoText", locale));
  }

  return text.slice(0, MAX_EXTRACTED_CHARS);
}

/**
 * Protection SSRF minimale : empêche qu'un utilisateur fasse pointer "le lien" vers
 * une adresse interne à l'infrastructure (localhost, réseau privé) pour sonder le
 * réseau du serveur depuis l'extérieur. Pas exhaustif (pas de résolution DNS vérifiée
 * ici), mais bloque le cas le plus évident et le plus fréquent en pratique.
 */
function parseAndValidateUrl(rawUrl: string, locale: Locale): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LinkScrapeError(t("linkInvalid", locale));
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LinkScrapeError(t("linkProtocolNotAllowed", locale));
  }

  const hostname = url.hostname.toLowerCase();
  const blockedPatterns = [
    /^localhost$/,
    /^127\./,
    /^0\.0\.0\.0$/,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./, // adresses link-local (souvent utilisées par les métadonnées cloud)
    /^\[?::1\]?$/,
  ];
  if (blockedPatterns.some((pattern) => pattern.test(hostname))) {
    throw new LinkScrapeError(t("linkBlockedAddress", locale));
  }

  return url;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
