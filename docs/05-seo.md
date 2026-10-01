# SEO — ce qui est fait, et ce qui manque vraiment

## Ce qui existe

- `GET /sitemap.xml` — liste toutes les fiches série/film non-communautaires avec une URL propre.
- `GET /robots.txt` — autorise l'indexation et pointe vers le sitemap.

## Ce qui NE marche PAS encore, et pourquoi c'est important

Un sitemap sert à dire à Google "voici les URLs à visiter" — mais si ces URLs ne
renvoient rien d'indexable, ça ne sert à rien. Aujourd'hui, ce projet est :

- une API backend (Express/Prisma) qui répond en JSON,
- deux maquettes HTML statiques, non connectées à l'API, qui ne sont pas déployées
  comme de vraies pages web avec une URL par série.

Il n'existe **aucune page réelle** du type `/series/les-mysteres-de-vertigo` qui
affiche le contenu d'une fiche en HTML consultable par un visiteur ou par le robot
d'indexation de Google. Le sitemap référence des URLs qui, pour l'instant, n'existent
pas côté serveur.

## Ce qu'il faut construire pour que le SEO fonctionne réellement

1. **Un vrai frontend avec rendu serveur (SSR) ou pages statiques générées** — un SPA
   React classique ne suffit pas pour un bon référencement (Google peut exécuter du
   JS mais avec des limites, et les autres moteurs/réseaux sociaux souvent pas du tout).
   Options réalistes : Next.js (SSR/SSG), Astro, ou Nuxt.
2. **Une page par fiche**, avec :
   - balise `<title>` et `<meta name="description">` uniques par série (le titre et
     le synopsis existent déjà en base, juste à les injecter)
   - balises Open Graph (`og:title`, `og:image` — la galerie d'images existe déjà,
     utilisable ici) pour un bon rendu quand le lien est partagé sur les réseaux
   - données structurées `schema.org` (type `TVSeries` ou `Movie`) — c'est ce qui permet
     à Google d'afficher des résultats enrichis (note, épisodes, image) directement
     dans les résultats de recherche
3. **URLs stables et lisibles** — le slug généré dans `seo.ts` (`slugify()`) va dans
   ce sens, mais il faut que le routeur du frontend les résolve réellement.
4. **Performance de chargement** — Google pénalise les pages lentes ; un rendu serveur
   bien fait aide aussi sur ce point.

## Priorité réaliste

Tant qu'il n'y a pas de vrai frontend déployé publiquement, travailler le SEO plus loin
que le sitemap est prématuré. C'est une brique "frontend public" à part entière, distincte
de l'API — à traiter quand ce choix technique (Next.js ou autre) sera fait.
