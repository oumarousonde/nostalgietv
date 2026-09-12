# Déploiement — Vercel, sans Render

## Pourquoi Vercel plutôt que Netlify pour l'API

Netlify fait tourner du site statique et des fonctions à la demande, mais son
support du cron et des fonctions Node longues est plus limité. Vercel a un
support natif pour les deux points qui bloquaient sur Netlify :
- **Cron Jobs natifs** (`vercel.json`) — remplace `node-cron`, qui ne
  fonctionnerait pas de façon fiable sur des fonctions serverless (aucun
  process ne reste allumé entre deux requêtes pour qu'un cron interne ait un sens).
- **Vercel Blob** pour l'upload d'images/vidéos — contourne la limite de 4,5 Mo
  par requête (voir plus bas), qui aurait autrement cassé la recherche par
  image/vidéo dès qu'un fichier dépasse quelques Mo.

## Option recommandée — tout sur Vercel, un seul projet

La plus simple : l'API **et** les maquettes sur Vercel, dans le même projet.
Pas de CORS à configurer entre deux domaines différents, une seule interface à surveiller.

1. Connecte ton dépôt Git sur [vercel.com](https://vercel.com).
2. Vercel détecte `api/index.ts` automatiquement et le déploie comme fonction
   serverless — `vercel.json` route déjà tout le trafic vers cette fonction.
3. Crée un store **Vercel Blob** : dans ton projet Vercel → Storage → Create →
   Blob. Une fois créé, `BLOB_READ_WRITE_TOKEN` est injectée automatiquement,
   rien à copier-coller.
4. Dans Project Settings → Environment Variables, ajoute :
   ```
   DATABASE_URL=...       (Neon ou Supabase, voir docs/07)
   JWT_SECRET=...
   TMDB_API_KEY=...
   GEMINI_API_KEY=...
   AMAZON_ASSOCIATE_TAG=...
   CRON_SECRET=...        (génère avec openssl rand -hex 32)
   PUBLIC_BASE_URL=https://ton-projet.vercel.app
   ```
5. Une fois le premier déploiement terminé, lance la migration de base de
   données **depuis ta machine**, avec la même `DATABASE_URL` que celle collée
   à l'étape 4 :
   ```bash
   npx prisma migrate deploy
   ```
6. Vérifie le Cron Job : Vercel → ton projet → Cron Jobs, tu dois voir
   `/internal/cron/validate-referrals` programmé **une fois par jour** (`0 3 * * *`,
   autour de 3h UTC). Vercel envoie automatiquement `Authorization: Bearer <CRON_SECRET>`
   sur cette route — c'est pour ça que `CRON_SECRET` doit être identique des deux
   côtés (variable d'environnement Vercel = celle que la route vérifie).

   **Pourquoi une fois par jour et pas plus souvent** : le plan Hobby (gratuit)
   de Vercel refuse toute fréquence de cron plus rapide qu'une fois par jour —
   une tentative avec `0 * * * *` (toutes les heures) fait échouer le déploiement
   avec l'erreur *"Hobby accounts are limited to daily cron jobs"*. Une fois par
   jour reste largement suffisant ici, vu le délai de carence de 48h avant qu'un
   parrainage soit de toute façon éligible à validation.
7. Les maquettes (`maquette/*.html`) sont servies par le même déploiement —
   ouvre `https://ton-projet.vercel.app/nostalgietv-maquette.html` pour vérifier.
   Dans le fichier, remplace `API_BASE_URL` par `""` (chaîne vide) : même
   domaine que l'API, plus besoin de préciser d'adresse séparée.

## Option alternative — maquettes sur Netlify, API sur Vercel

Si tu préfères garder les maquettes sur Netlify (par exemple parce que c'est
déjà déployé là), `netlify.toml` est prêt à la racine du projet pour ça :
publie uniquement le dossier `maquette/`, sans étape de build.

Dans ce cas, deux différences par rapport à l'option recommandée :
- `CORS_ORIGIN` (variable Vercel) doit lister ton domaine Netlify, ex.
  `https://nostalgietv.netlify.app` — sinon le navigateur bloquera les
  requêtes de la maquette vers l'API.
- Dans les fichiers `maquette/*.html`, `API_BASE_URL` doit pointer vers ton
  URL Vercel (`https://ton-projet.vercel.app`), pas rester vide.

## Pourquoi l'upload d'images/vidéos ne passe plus par l'API directement

Vercel impose une limite **stricte de 4,5 Mo par requête** sur ses fonctions —
non négociable, pas un réglage de plan. Une vidéo de recherche dépasse
largement cette taille.

La solution : le fichier ne transite jamais par notre fonction. Le flux réel
(voir `src/routes/upload.routes.ts`) :

1. Le client demande un jeton via `POST /uploads/handshake` (authentifié).
2. Le navigateur envoie le fichier **directement** à Vercel Blob, sans passer
   par notre code.
3. Le client appelle `POST /search` avec juste l'URL du fichier déjà uploadé
   (`fileUrls` pour des images, `fileUrl` pour une vidéo) — une requête de
   quelques dizaines de caractères, largement sous la limite.
4. Notre fonction va chercher le fichier depuis cette URL Vercel Blob (ça,
   *ce n'est pas* limité à 4,5 Mo — la limite ne s'applique qu'aux requêtes
   **entrantes**, pas aux appels sortants que la fonction fait elle-même),
   puis l'envoie à Gemini.

`src/services/blobFetcher.ts` n'accepte que des URLs venant de notre propre
store Vercel Blob (`*.vercel-storage.com`) — sinon cette route deviendrait un
proxy de fetch arbitraire pour n'importe quelle URL fournie par un utilisateur,
même risque que le mode "lien" de la recherche (voir `linkScraper.ts`).

## Résumé — où va chaque variable

| Variable | Va dans... |
|---|---|
| `TMDB_API_KEY`, `GEMINI_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, `AMAZON_ASSOCIATE_TAG`, `CRON_SECRET` | Vercel (Project Settings → Environment Variables) |
| `BLOB_READ_WRITE_TOKEN` | Vercel, injectée automatiquement — rien à faire |
| `CORS_ORIGIN`, `PUBLIC_BASE_URL` | Vercel, seulement si tu utilises l'option Netlify+Vercel séparée |
| Rien | Netlify (si utilisé) — les maquettes n'ont besoin d'aucune clé |
