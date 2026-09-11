# NostalgieTV

Plateforme de recherche de films et séries "perdus" — l'utilisateur décrit ce dont
il se souvient (titre, description, image, extrait vidéo, ou lien) et la plateforme
identifie l'œuvre, indique les épisodes retrouvés et manquants, et propose où la
regarder légalement.

## Lire dans cet ordre

1. [`docs/01-vision-produit.md`](docs/01-vision-produit.md) — le problème, la proposition
   de valeur, le modèle de revenus.
2. [`docs/02-architecture-technique.md`](docs/02-architecture-technique.md) — comment le
   code est organisé et pourquoi.
3. [`docs/03-parrainage-anti-fraude.md`](docs/03-parrainage-anti-fraude.md) — le système
   de crédits et de parrainage en détail, avec les protections anti-fraude.
4. [`docs/04-aspects-legaux.md`](docs/04-aspects-legaux.md) — les questions à trancher
   avec un juriste avant l'ouverture au public.
5. [`docs/07-premier-lancement.md`](docs/07-premier-lancement.md) — guide pas à pas
   pour faire tourner le serveur pour de vrai, base de données comprise, et faire
   ta première recherche réelle via l'API.
6. [`docs/08-deploiement.md`](docs/08-deploiement.md) — pourquoi les maquettes vont
   sur Netlify et l'API sur Railway, avec le détail de quelle clé va où.

## Ce qui est déjà implémenté (code fonctionnel, pas des maquettes)

- **Authentification** (`src/services/auth.ts` + `src/middleware/auth.ts` + `src/routes/auth.routes.ts`) :
  inscription avec mot de passe hashé (bcrypt), vérification email obligatoire avant connexion,
  JWT pour les sessions, middleware `requireAuth`/`requireAdmin` branché sur toutes les routes qui
  en ont besoin.
- **Cascade de recherche** (`src/services/searchCascade.ts`) : TMDB (gratuit) →
  fiches communautaires (gratuit) → Gemini multimodal (payant en crédits), chaque
  étape ne s'exécutant que si la précédente échoue. Chaque résultat renvoie une
  galerie d'images + synopsis pour que l'utilisateur confirme visuellement.
- **Grand livre de crédits** (`src/services/creditLedger.ts`) : solde toujours calculé,
  jamais stocké — traçable et corrigeable.
- **Parrainage** (`src/services/referral.ts` + `src/jobs/validateReferrals.ts`) : crédit
  différé jusqu'à validation réelle du compte filleul, pas à l'inscription.
- **Codes promo** (`src/services/promoCode.ts`) : verrouillage atomique du quota,
  impossible à dépasser même avec des requêtes simultanées.
- **Affiliation** (`src/services/affiliateLinks.ts`) : distingue les plateformes avec
  commission réelle (Amazon) de celles affichées à titre informatif (Netflix).
- **Dons mobile money** (`src/services/donations.ts`) : canal indépendant du système
  de crédits payants, avec génération de QR code.
- **Panneau admin** (`src/services/admin.ts` + `src/routes/admin.routes.ts`) : distribution
  manuelle de crédits IA, modération des sources communautaires — protégé par une double
  barrière (middleware HTTP + vérification côté service).
- **Historique de recherche** (`src/services/searchHistory.ts`) : chaque recherche est loguée,
  trouvée ou non — `GET /me/history`.
- **Favoris** (`src/services/favorites.ts`) : `POST`/`DELETE /shows/:id/favorite`, `GET /me/favorites`.
- **Avis** (`src/services/reviews.ts`) : un avis par utilisateur et par fiche (upsert, pas de
  doublon possible) — `POST`/`GET /shows/:id/reviews`. Le modèle existait déjà dans le schéma
  mais sans route pour s'en servir avant cet ajout.
- **Sitemap/robots.txt** (`src/services/seo.ts`) : généré depuis les fiches en base, mais voir
  `docs/05-seo.md` — ça ne suffit pas à lui seul, il manque un vrai frontend avec des pages
  publiques indexables.

## Installation

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

Copier `.env.example` en `.env` et remplir les valeurs (voir ce fichier pour la liste
exhaustive des variables requises, vérifiée directement contre le code).

## Ce qu'il reste à construire

- **Vulnérabilités npm modérées connues** (transitives, pas dans nos dépendances
  directes) : `qs`/`body-parser` via Express lui-même, et `uuid` via `node-cron`.
  `npm audit fix` ne suffit pas ; corriger `node-cron` nécessite une montée de
  version majeure (v3→v4) non testée ici — à faire avant une mise en prod sérieuse,
  pas urgent pour un usage de développement.

- **Upload de fichier pour les sources communautaires** : `Source.url` suppose un lien
  externe déjà hébergé ailleurs ; pas d'upload direct côté utilisateur.
- **Envoi réel de l'email de vérification** : le token est généré, l'envoi (Resend, SES...)
  n'est pas branché — volontairement mis de côté.
- **Fournisseur SMS réel** : le code fonctionne sans (il log au lieu d'envoyer), voir
  `src/services/notifications/sms.ts`.
- **Stockage cloud pour les fichiers volumineux** : fait — upload direct navigateur →
  Vercel Blob (voir `docs/08-deploiement.md`), plus de limite pratique de taille côté
  API. Reste néanmoins une limite de 100 Mo par fichier (volontaire, voir
  `src/routes/upload.routes.ts`) et un plafond de mémoire/durée d'exécution des
  fonctions Vercel pour les vidéos vraiment longues — pas testé au-delà.
- **Vrai frontend public** : ce projet est une API + deux maquettes HTML non connectées.
  Sans lui, le SEO (`docs/05-seo.md`) et la traduction de l'interface (`docs/06-i18n.md`)
  restent bloqués, quoi qu'on fasse côté backend.
- **Résidu à nettoyer** : le modèle `SearchProvider` en base n'est jamais utilisé
  (voir `docs/02-architecture-technique.md`) — à supprimer ou à vraiment brancher.
- **Compilation réelle jamais vérifiée dans cet environnement** : `binaries.prisma.sh`
  est hors liste blanche réseau ici, donc tout a été relu à la main plutôt que compilé.
  Lancer `npm install && npx prisma generate && npx tsc --noEmit` avant tout déploiement.
- Tests automatisés : aucun pour l'instant.

- File de modération : le schéma et les routes d'approbation existent, mais pas encore
  l'upload de fichier lui-même côté utilisateur (aujourd'hui `Source.url` suppose un lien externe)
- Scraping sécurisé pour le mode de recherche "lien" (aujourd'hui le texte scrapé est
  supposé déjà extrait en amont de `runSearchCascade`)
- Renvoi effectif de l'email de vérification (le token est généré, mais l'envoi
  réel — Resend, SES, etc. — n'est pas branché)
- Tests automatisés (aucun pour l'instant)
