# Aspects légaux à clarifier avant le lancement

Ce document n'est pas un avis juridique — c'est la liste des questions à poser à un
avocat ou juriste avant d'ouvrir la plateforme au public. Je ne suis pas juriste ;
traiter ce document comme un point de départ, pas comme une validation.

## 1. Statut des "sources gratuites"

Le point le plus sensible du projet. Deux modèles très différents en termes de risque :

- **Répertoire de liens externes** : la plateforme référence des liens vers du contenu
  hébergé ailleurs (archive.org, dépôts communautaires externes), sans jamais stocker
  le fichier elle-même. Risque plus faible, comparable à un moteur de recherche.
- **Hébergement direct** : les utilisateurs uploadent des fichiers vidéo directement sur
  l'infrastructure de NostalgieTV. Là, la plateforme devient hébergeur de contenu et
  porte une responsabilité directe sur ce qui est diffusé (droits d'auteur en premier lieu,
  même pour du contenu "orphelin" ou retiré du commerce depuis des décennies — le retrait
  du commerce ne fait pas tomber le droit d'auteur).

Recommandation de départ (à valider par un juriste, pas une certitude) : démarrer en
mode répertoire de liens, pas en hébergement direct, le temps de clarifier le cadre.

## 2. Programme d'affiliation Amazon

Nécessite une inscription formelle au programme Amazon Associates (ou équivalent
selon le pays), avec validation par Amazon — la clé API PA-API ne suffit pas à elle
seule, il faut être accepté dans le programme et respecter leurs règles d'affichage
(mention obligatoire de la commission, ce qui est déjà prévu dans la maquette).

## 3. Netflix — pas de commission possible actuellement

Netflix n'a plus de programme d'affiliation public. Un lien "Regarder sur Netflix"
reste utile pour l'utilisateur mais ne doit jamais être présenté comme générant une
commission — le code (`hasCommission: false` dans la config) empêche déjà cette confusion.

## 4. Dons mobile money

Un don via Orange Money / Wave / Moov Money doit rester un don libre, sans contrepartie
directe (pas de crédits offerts en échange). Dès qu'une contrepartie existe, le flux peut
être requalifié en vente et tomber sous un régime réglementaire différent (numéro
d'entreprise, TVA éventuelle selon le pays, etc.) — à vérifier localement.

## 5. Données personnelles

Comptes utilisateurs, historique de recherche, avis publiés : selon les pays visés,
un cadre type RGPD (ou équivalent local) peut s'appliquer dès qu'il y a des utilisateurs
dans l'UE — politique de confidentialité et base légale de traitement à prévoir avant
l'ouverture publique, pas après.
