import { app } from "../src/app";

// Vercel reconnaît un export par défaut d'une app Express (ou toute fonction
// compatible avec la signature (req, res)) sous /api et la fait tourner comme
// une fonction serverless. app.ts est inchangé par ailleurs — app.listen() ne
// s'exécute que si le fichier est lancé directement (require.main === module),
// jamais quand il est simplement importé comme ici.
export default app;
