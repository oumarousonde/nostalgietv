# Architecture technique

## Stack

Node.js / TypeScript / Express / PostgreSQL / Prisma. Choisie pour la robustesse
des transactions et contraintes uniques (critique pour les crédits et le parrainage),
et l'écosystème mature autour de Gemini et TMDB en JS.

## Principe directeur : tout est piloté par la configuration, rien n'est en dur

- `src/config/providers.ts` définit l'ordre de la cascade de recherche et le coût
  en crédits de chaque étape. Ajouter/retirer une étape = modifier ce fichier, pas
  le moteur (`searchCascade.ts`).
- La même logique s'applique aux plateformes d'affiliation : le flag `hasCommission`
  vit dans la config, jamais saisi manuellement lors de la création d'un lien —
  impossible d'afficher par erreur un lien Netflix comme générant une commission.

**Résidu à nettoyer** : le modèle `SearchProvider` existe dans `schema.prisma` mais
n'est interrogé nulle part dans le code — toute la cascade tourne sur la config statique
ci-dessus. Soit supprimer ce modèle (le plus simple, rien n'en dépend), soit migrer
`SEARCH_CASCADE` vers la base si l'objectif est de pouvoir la modifier sans redéploiement
(ex. depuis le panneau admin) — décision produit à trancher, pas juste technique.

## Le grand livre de crédits (déjà détaillé dans `03-parrainage-anti-fraude.md`)

Aucune table ne stocke un solde. Chaque mouvement (gain de parrainage, dépense de
recherche IA, code promo, don admin) est une ligne dans `CreditTransaction`, avec
une clé d'idempotence unique qui rend tout double-traitement impossible au niveau
de la base de données elle-même — pas seulement du code applicatif.

## Schéma de données — vue d'ensemble

```
User ──< Referral >── User (parrain / filleul, refereeId UNIQUE)
User ──< CreditTransaction (grand livre, jamais modifié après coup)
User ──< PromoRedemption >── PromoCode

Show ──< Episode ──< Source (source gratuite, vérifiée par modération)
Show ──< AffiliateLink (payant, hasCommission piloté par la config)
Show ──< Review

DonationChannel (indépendant de tout le reste — dons libres, pas de crédit associé)
```

## Points d'attention pour la suite

- **Modération des sources communautaires** : le schéma, la file d'attente et les routes
  d'approbation/rejet existent (`admin.ts`), mais il n'y a toujours pas d'upload de fichier
  côté utilisateur pour alimenter cette file — `Source.url` suppose un lien externe déjà
  hébergé ailleurs.
- **Coût réel Gemini variable** selon la taille du fichier envoyé (image vs vidéo de
  2 minutes) : le coût fixe en crédits (`costInCredits: 1`) est une simplification de
  départ à revoir avec de vraies données de coût API en production.
