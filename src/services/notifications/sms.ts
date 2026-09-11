/**
 * Abstraction volontaire : aucun fournisseur SMS n'est câblé pour l'instant
 * (pas de clé fournie). Le reste du code (alerts.ts) appelle CETTE fonction,
 * donc brancher un vrai fournisseur plus tard = remplacer uniquement ce fichier,
 * rien à toucher ailleurs.
 *
 * Candidats réalistes pour le Burkina Faso : API SMS d'Orange, ou un agrégateur
 * comme Africa's Talking / Twilio qui couvre la zone. Le choix dépendra des tarifs
 * et de la couverture réseau au moment de brancher pour de vrai.
 */
export async function sendSms(phoneNumber: string, message: string): Promise<void> {
  const provider = process.env.SMS_PROVIDER; // ex: "orange" | "africas_talking" | "twilio"

  if (!provider) {
    // Pas de fournisseur configuré : on log au lieu d'échouer silencieusement,
    // pour que ce soit visible en dev/staging tant que le vrai envoi n'est pas branché.
    console.log(`[SMS non envoyé — aucun SMS_PROVIDER configuré] À ${phoneNumber} : ${message}`);
    return;
  }

  throw new Error(
    `SMS_PROVIDER="${provider}" configuré mais aucune intégration réelle branchée ` +
      `dans sendSms() — implémenter l'appel API du fournisseur choisi ici.`
  );
}
