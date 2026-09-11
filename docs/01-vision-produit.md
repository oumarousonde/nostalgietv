# NostalgieTV — Vision produit

## Le problème

Des millions de personnes se souviennent d'un film, d'une série ou d'une émission
sans jamais réussir à en retrouver le nom — programme jeunesse des années 80/90,
diffusion régionale unique, œuvre retirée du catalogue officiel. Les moteurs de
recherche classiques échouent parce qu'ils exigent déjà de connaître le titre.

## La proposition de valeur

NostalgieTV inverse le problème : l'utilisateur décrit ce dont il se souvient
(texte, image, extrait vidéo, ou lien vers une page qui en parle), et la
plateforme identifie l'œuvre — puis indique concrètement où la regarder,
légalement, gratuitement si possible.

## Comment ça marche (cascade de recherche)

1. **Titre exact → TMDB.** Instantané, gratuit, couvre l'essentiel du catalogue référencé.
2. **Sources déjà connues de la communauté.** Avant tout appel externe payant, on vérifie
   si quelqu'un a déjà résolu cette recherche.
3. **Description / image / vidéo / lien → Gemini.** Seul le multimodal peut relier
   "un renard bleu, dessin animé, vers 1994" à un titre. Consomme des crédits utilisateur.
4. **Fallback payant.** Si aucune source gratuite n'existe, la plateforme affiche les
   options légales payantes (Amazon Prime Video en priorité — programme d'affiliation actif ;
   Netflix affiché à titre informatif, sans commission, le programme d'affiliation Netflix
   n'existant plus).

## Les moteurs d'engagement

- **Crédits IA** : gratuits à l'inscription, gagnés par parrainage (10 pour le parrain,
  5 pour le filleul, distribués seulement après un usage réel — voir
  `03-parrainage-anti-fraude.md`), ou distribués par l'administration pour mettre en
  avant certains contributeurs.
- **Contribution communautaire** : quand rien n'est trouvé, l'utilisateur peut ouvrir
  une fiche et la communauté la complète au fil du temps — l'échec de recherche devient
  un point de départ, pas une impasse.
- **Avis et commentaires** sur chaque fiche, y compris pour signaler une source retrouvée.
- **Soutien libre** via mobile money (Orange Money, Wave, Moov Money), séparé du système
  de crédits payants pour rester un don sans contrepartie.

## Modèle de revenus

- Commission Amazon Associates sur les épisodes/films disponibles uniquement en payant.
- Dons volontaires (mobile money).
- (Piste future) crédits IA vendables directement, au-delà du système gratuit par parrainage.

## Ce qui reste à trancher avant le lancement

Voir `04-aspects-legaux.md` pour le point le plus sensible : le statut juridique des
sources "gratuites" hébergées ou relayées par la plateforme.
