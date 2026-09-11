/**
 * Registre central des fournisseurs. Le moteur de recherche (searchCascade.ts)
 * et l'affichage des liens affiliés lisent CE fichier plutôt que d'avoir les noms
 * de plateformes en dur dans le code — ajouter Disney+ demain = une ligne ici.
 */

export interface SearchProviderConfig {
  key: string;
  order: number;       // ordre d'exécution dans la cascade, croissant
  costInCredits: number; // 0 = gratuit
}

export const SEARCH_CASCADE: SearchProviderConfig[] = [
  { key: "tmdb", order: 1, costInCredits: 0 },       // titre exact, gratuit, quasi illimité
  { key: "community", order: 2, costInCredits: 0 },  // sources déjà uploadées par la communauté
  { key: "gemini", order: 3, costInCredits: 1 },     // description / image / vidéo / lien
];

// Coût d'un message envoyé au chatbot — même registre central que la recherche,
// pour rester cohérent si un jour le prix des appels Gemini change.
export const CHAT_MESSAGE_COST_CREDITS = 1;

export interface AffiliatePlatformConfig {
  key: string;
  label: string;
  hasCommission: boolean; // false = lien affiché mais pas de revenu (ex: Netflix)
}

export const AFFILIATE_PLATFORMS: AffiliatePlatformConfig[] = [
  { key: "amazon", label: "Amazon Prime Video", hasCommission: true },
  { key: "netflix", label: "Netflix", hasCommission: false }, // pas de programme d'affiliation actif
  // Ajouter ici Disney+, Apple TV, etc. au fur et à mesure des partenariats trouvés.
];
