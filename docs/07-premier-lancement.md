# Premier lancement réel — guide pas à pas

Ce guide t'emmène de "j'ai le dossier dézippé" à "j'ai fait ma première vraie
recherche via l'API, sur mon ordinateur". Suis les étapes dans l'ordre, sans
sauter — chaque étape vérifie que la précédente a marché avant de continuer.

## 0. Prérequis

- **Node.js 20 ou plus récent** (`node -v` pour vérifier). Si tu ne l'as pas :
  [nodejs.org](https://nodejs.org).
- **Une base PostgreSQL**, une des trois options :
  - **La plus simple pour commencer** : un compte gratuit sur
    [neon.com](https://neon.com) ou [supabase.com](https://supabase.com) — tu
    récupères une URL de connexion en 2 minutes, rien à installer.
  - PostgreSQL installé en local sur ta machine.
  - Docker : `docker run --name nostalgietv-db -e POSTGRES_PASSWORD=motdepasse -p 5432:5432 -d postgres`
- **Un outil pour envoyer des requêtes HTTP** : `curl` (déjà installé sur
  Mac/Linux) ou [Postman](https://postman.com) si tu préfères une interface graphique.

## 1. Installer les dépendances

```bash
cd nostalgietv-platform
npm install
```

Si ça affiche des `npm warn deprecated`, ignore-les — ce sont des avertissements,
pas des erreurs. Le dossier `node_modules` doit apparaître à la fin.

## 2. Configurer les variables d'environnement

```bash
cp .env.example .env
```

Ouvre `.env` et remplis, dans cet ordre de priorité :

| Variable | Où l'obtenir | Obligatoire pour démarrer ? |
|---|---|---|
| `DATABASE_URL` | Ton fournisseur PostgreSQL (Neon/Supabase te la donne directement) | **Oui** |
| `JWT_SECRET` | Tu l'inventes toi-même : `openssl rand -hex 32` dans un terminal | **Oui** |
| `TMDB_API_KEY` | [themoviedb.org](https://www.themoviedb.org) → créer un compte → Réglages → API | **Oui** pour tester la recherche |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API key | Non pour ce premier test (seulement le mode titre) |
| `AMAZON_ASSOCIATE_TAG` | Programme Amazon Associates, une fois accepté | Non |
| Le reste | Laisse vide pour l'instant | Non |

## 3. Créer les tables dans la base

```bash
npx prisma migrate dev --name init
```

Si ça se termine sans erreur, tes 21 tables existent dans la base. Pour le
vérifier visuellement (facultatif) :

```bash
npx prisma studio
```

Ça ouvre une interface web sur `http://localhost:5555` où tu peux voir toutes
les tables, vides pour l'instant.

## 4. Lancer le serveur

```bash
npm run dev
```

Tu dois voir : `NostalgieTV API démarrée sur le port 3000`. Laisse ce terminal
ouvert, ouvre-en un deuxième pour la suite.

**Si ça plante ici**, l'erreur la plus probable concerne `DATABASE_URL` — vérifie
qu'il n'y a ni espace ni guillemet superflu dans le `.env`.

## 5. Test de vie basique

```bash
curl -i http://localhost:3000/robots.txt
```

Tu dois recevoir une réponse HTTP 200 avec du texte. Si tu obtiens une erreur
de connexion, le serveur n'a pas démarré — retourne à l'étape 4.

## 6. Créer un compte

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "toi@example.com", "password": "motdepasse123"}'
```

Réponse attendue :
```json
{ "userId": "...", "emailVerificationToken": "abc123..." }
```

**Garde ce `emailVerificationToken`** — normalement il partirait par email, mais
l'envoi n'est pas branché (volontaire, voir le README). C'est ce token qui te
sert de "lien de vérification" pour la suite.

## 7. Confirmer l'email (avec le token de l'étape 6)

```bash
curl -X POST http://localhost:3000/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"token": "COLLE_LE_TOKEN_ICI"}'
```

Réponse attendue : `{ "verified": true }`

## 8. Se connecter

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "toi@example.com", "password": "motdepasse123"}'
```

Réponse attendue :
```json
{ "token": "eyJhbGci...", "userId": "...", "role": "member" }
```

**Garde ce `token`** — c'est ta clé pour toutes les routes protégées ensuite.

## 9. Ta première vraie recherche

```bash
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer COLLE_LE_TOKEN_ICI" \
  -d '{"mode": "title", "value": "Breaking Bad"}'
```

Si `TMDB_API_KEY` est bien configuré, tu dois recevoir une vraie fiche avec
`providerUsed: "tmdb"`, un résumé, une galerie d'images. **C'est le moment de
vérité** — si ça marche, toute la chaîne (base de données, auth, TMDB) fonctionne
réellement, pas juste sur le papier.

## 10. Créer ton premier compte admin

Aucune route ne permet de se promouvoir admin soi-même (volontaire, question de
sécurité) — il faut le faire directement en base, une seule fois. Avec `psql` :

```bash
psql "$DATABASE_URL" -c "UPDATE \"User\" SET role = 'admin' WHERE email = 'toi@example.com';"
```

Ou via `npx prisma studio` (étape 3) : ouvre la table `User`, trouve ta ligne,
change `role` de `member` à `admin`, sauvegarde.

Ensuite, reconnecte-toi (étape 8) pour obtenir un nouveau token — l'ancien a
été signé avec `role: "member"` et ne changera pas tout seul.

## 11. Tester une action admin

```bash
curl -X POST http://localhost:3000/admin/promo-codes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TON_NOUVEAU_TOKEN_ADMIN" \
  -d '{"code": "BIENVENUE", "creditAmount": 10, "maxUses": 100}'
```

Si tu reçois le code promo créé en retour (pas une erreur 403), tout le système
d'autorisation fonctionne de bout en bout.

## Pièges fréquents

- **`Erreur TMDB (401)`** : la clé `TMDB_API_KEY` est absente ou invalide —
  revérifie l'étape 2.
- **`JWT_SECRET manquant dans l'environnement`** : le `.env` n'a pas été chargé,
  ou la variable est vide.
- **`P1001: Can't reach database server`** : `DATABASE_URL` est incorrecte, ou
  ta base ne tourne pas (si Docker, vérifie `docker ps`).
- **401 sur une route protégée alors que tu as bien mis le token** : vérifie le
  format exact de l'en-tête — `Authorization: Bearer <token>`, avec "Bearer" et
  un espace, pas juste le token seul.
- **403 sur une route admin après l'étape 10** : tu utilises encore l'ancien
  token (signé avant le changement de rôle) — reconnecte-toi.

## Une fois que tout ça marche

Tu as maintenant la première vraie confirmation que le projet fonctionne en
conditions réelles, pas juste en lecture de code. Prochaine étape logique :
essayer le mode `description` ou `images` de la recherche (ça nécessite
`GEMINI_API_KEY`), puis explorer les autres routes listées dans le README.
