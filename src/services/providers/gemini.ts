/**
 * Recherche multimodale via l'API Gemini : description libre, une ou plusieurs images,
 * vidéo, ou lien (le lien est d'abord récupéré/scrapé, puis son contenu est passé à Gemini).
 * Étape 3 de la cascade, seulement si TMDB et les sources communautaires n'ont rien donné.
 * Consomme des crédits — voir src/services/creditLedger.ts pour le débit.
 * Nécessite GEMINI_API_KEY dans les variables d'environnement.
 */

const GEMINI_MODEL = "gemini-2.5-flash"; // multimodal, bon rapport coût/latence pour ce cas d'usage
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export interface ImageFile {
  base64: string;
  mimeType: string;
}

export type GeminiSearchInput =
  | { type: "description"; text: string }
  // Plusieurs images (jusqu'à 5, imposé dans routes/platform.routes.ts) : utile quand une seule
  // capture est ambiguë — plusieurs angles/moments d'une même scène aident Gemini à
  // trancher entre deux œuvres qui se ressemblent.
  | { type: "images"; files: ImageFile[] }
  | { type: "video"; base64: string; mimeType: string }
  | { type: "link"; scrapedText: string };

export interface GeminiSearchResult {
  bestGuessTitle: string | null;
  confidence: "low" | "medium" | "high";
  reasoning: string; // pourquoi Gemini pense que c'est ce titre — utile pour l'utilisateur ET pour debug
}

export async function searchWithGemini(
  input: GeminiSearchInput
): Promise<GeminiSearchResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY manquante dans l'environnement");

  const prompt = buildPrompt(input);
  const parts: any[] = [{ text: prompt }];

  if (input.type === "images") {
    for (const file of input.files) {
      parts.push({ inline_data: { mime_type: file.mimeType, data: file.base64 } });
    }
  } else if (input.type === "video") {
    parts.push({ inline_data: { mime_type: input.mimeType, data: input.base64 } });
  }

  const response = await fetch(
    `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Erreur Gemini (${response.status})`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

  try {
    return JSON.parse(rawText);
  } catch {
    return { bestGuessTitle: null, confidence: "low", reasoning: "Réponse non exploitable" };
  }
}

function buildPrompt(input: GeminiSearchInput): string {
  const base =
    "Tu es un expert en films et séries, y compris obscurs ou anciens (années 1970-2000, " +
    "émissions jeunesse, publicités, programmes régionaux). On te donne un indice pour " +
    "identifier une œuvre. Réponds UNIQUEMENT en JSON avec les clés : " +
    '"bestGuessTitle" (string ou null), "confidence" ("low"|"medium"|"high"), ' +
    '"reasoning" (courte explication en français).';

  switch (input.type) {
    case "description":
      return `${base}\n\nIndice (description utilisateur) : "${input.text}"`;
    case "link":
      return `${base}\n\nIndice (contenu d'une page web fournie par l'utilisateur) : "${input.scrapedText}"`;
    case "images":
      return input.files.length > 1
        ? `${base}\n\nIndice : ${input.files.length} images jointes, probablement de la même scène ou œuvre sous différents angles/moments — croise-les pour affiner ta réponse.`
        : `${base}\n\nIndice : l'image jointe.`;
    case "video":
      return `${base}\n\nIndice : la vidéo jointe.`;
  }
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Chat conversationnel — distinct de searchWithGemini() qui ne gère qu'un seul
 * échange sans mémoire. Ici l'historique complet est renvoyé à chaque appel
 * (Gemini, comme la plupart des LLM, n'a pas de mémoire serveur entre deux appels
 * API : c'est à nous de repasser toute la conversation à chaque fois).
 */
export async function chatWithGemini(history: ChatTurn[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY manquante dans l'environnement");

  const systemPrompt =
    "Tu es l'assistant de NostalgieTV, un service qui aide les gens à retrouver des " +
    "films et séries dont ils se souviennent vaguement. Aide la personne à préciser sa " +
    "recherche (détails visuels, époque, langue, plateforme de diffusion d'origine), " +
    "réponds aux questions sur le fonctionnement du site, reste bref et chaleureux. " +
    "Réponds dans la langue du message de l'utilisateur.";

  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Compris, je suis prêt à aider." }] },
    ...history.map((turn) => ({
      role: turn.role === "user" ? "user" : "model",
      parts: [{ text: turn.content }],
    })),
  ];

  const response = await fetch(
    `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
    }
  );

  if (!response.ok) {
    throw new Error(`Erreur Gemini chat (${response.status})`);
  }

  const data = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!reply) {
    throw new Error("Réponse vide de Gemini");
  }

  return reply;
}
