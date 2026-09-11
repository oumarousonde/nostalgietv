import { Locale } from "../../middleware/locale";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const LOCALE_NAMES: Record<Locale, string> = { fr: "français", en: "English" };

/**
 * Traduction automatique via Gemini — utilisée UNIQUEMENT pour le contenu communautaire
 * (titre/description tapés par un utilisateur), qui n'a pas de traduction éditoriale
 * disponible ailleurs. Pour tout contenu venant de TMDB, préférer fetchShowDetails()
 * dans providers/tmdb.ts, qui renvoie une vraie traduction humaine, pas automatique.
 */
export async function translateText(text: string, targetLocale: Locale): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY manquante dans l'environnement");

  const targetName = LOCALE_NAMES[targetLocale];
  const prompt =
    `Traduis le texte suivant en ${targetName}. Réponds UNIQUEMENT avec le texte traduit, ` +
    `sans guillemets, sans commentaire, sans préambule.\n\nTexte : "${text}"`;

  const response = await fetch(
    `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  if (!response.ok) {
    throw new Error(`Erreur Gemini traduction (${response.status})`);
  }

  const data = await response.json();
  const translated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  // Si la traduction échoue pour une raison quelconque, mieux vaut renvoyer le texte
  // original que de faire planter tout l'affichage de la fiche pour ce détail.
  return translated || text;
}
