# NostalgieTV — Système de parrainage & crédits IA

## 1. Principe

- Parrain : **+10 crédits** quand son filleul remplit la condition de validation.
- Filleul : **+5 crédits** à l'inscription via code de parrainage.
- Code promo (indépendant du parrainage) : quantité de crédits variable, définie par l'admin.

L'enjeu n'est pas de calculer les crédits (trivial), c'est d'empêcher qu'un même individu se crée dix comptes pour se parrainer lui-même et engranger des crédits gratuitement. Deux problèmes distincts à traiter séparément : **la duplication de compte (fraude)** et **la duplication de crédit (bug d'attribution)**.

---

## 2. Modèle de données (ledger, pas de solde brut)

Ne jamais stocker le solde de crédits comme un simple champ `credits = 42` qu'on incrémente. Utiliser un **grand livre de transactions** : le solde est toujours *calculé* en sommant l'historique. C'est ce qui rend les doublons détectables et corrigeables après coup.

```
users
  id, email, email_verified_at, referral_code (unique, généré à l'inscription)
  referred_by_code (nullable — le code qu'il a saisi, pas l'ID directement)

referrals
  id
  referrer_id        -- celui qui a parrainé
  referee_id UNIQUE  -- celui qui a été parrainé (un seul parrain possible, jamais deux)
  status              -- pending | validated | rejected
  created_at, validated_at

credit_transactions        -- LA source de vérité, jamais modifiée après coup
  id
  user_id
  amount              -- +10, +5, -1 (dépense recherche IA), etc.
  reason              -- referral_bonus | referral_reward | promo_code | admin_grant | ia_search_spend
  reference_id        -- id du referral, du promo_code, ou de la recherche concernée
  idempotency_key UNIQUE  -- voir section 4
  created_at

promo_codes
  code UNIQUE, credit_amount, max_uses, uses_count, expires_at
```

Le solde affiché = `SUM(amount) WHERE user_id = X`. Si un bug double-crédite quelqu'un, on le voit immédiatement dans l'historique et on peut corriger sans deviner.

---

## 3. Empêcher qu'un compte soit parrainé deux fois

- **Contrainte `UNIQUE` sur `referee_id`** dans la table `referrals` : au niveau base de données, pas juste côté code. Un `referee_id` ne peut apparaître qu'une seule fois, point final — même deux requêtes simultanées ne peuvent pas passer.
- Le code de parrainage ne peut être saisi **qu'une seule fois, à l'inscription**. Une fois le compte créé sans code, impossible de l'ajouter après coup (sinon on peut créer un compte, puis se faire "parrainer" par un complice après coup pour multiplier les cas).

---

## 4. Empêcher qu'un même individu se parraine lui-même (multi-comptes)

C'est le vrai sujet, et il n'y a pas de solution unique — on empile plusieurs signaux, du plus léger au plus fort :

| Signal | Ce qu'il détecte | Limite |
|---|---|---|
| **Vérification email obligatoire** avant tout crédit | Comptes jetables en masse | Contournable avec emails temporaires |
| **Empreinte device/navigateur** (fingerprint) au moment de l'inscription | Même appareil créant plusieurs comptes | Contournable en changeant de navigateur/VPN, mais coûte cher à l'attaquant |
| **Comparaison IP + fenêtre de temps** entre parrain et filleul | Deux comptes créés depuis le même réseau à quelques minutes d'écart | Faux positifs (famille, colocataires) → à utiliser comme *signal de suspicion*, pas comme blocage automatique |
| **Délai de carence avant crédit** (ex. 48h à 7 jours) | Comptes créés puis supprimés juste après avoir touché les crédits | N'empêche pas la fraude patiente, mais la rend moins rentable |
| **Action de validation réelle** avant crédit (voir §5) | Comptes fantômes qui ne servent à rien d'autre | La meilleure protection, la plus simple à expliquer |

Recommandation concrète : combiner **vérification email + action de validation + fingerprint comme filtre de suspicion (pas de blocage dur)**. Le blocage dur (IP, fingerprint) génère trop de faux positifs pour une appli grand public ; il vaut mieux l'utiliser pour **mettre en file d'attente de revue manuelle** les cas suspects plutôt que les rejeter automatiquement.

---

## 5. Ne jamais créditer à l'inscription — créditer à la validation

Le crédit ne doit **pas** tomber au moment où le filleul crée son compte. Il tombe quand le filleul fait une **action qui prouve que c'est un vrai usage** :

- Exemples d'action de validation : email confirmé **et** première recherche effectuée, ou compte actif depuis 3 jours.
- Tant que la condition n'est pas remplie, le `referral.status = pending`.
- Une tâche planifiée (cron) scanne les `referrals` en attente et les passe à `validated` (déclenchant les deux transactions de crédit) ou `rejected` (si le compte est resté inactif / a été supprimé) après un délai fixe.

Ça élimine à la source l'intérêt de créer des faux comptes qui ne servent jamais à rien.

---

## 6. Empêcher le double-crédit technique (bug, pas fraude)

Même sans fraude, un souci classique : l'utilisateur double-clique, ou une requête réseau est rejouée, et le système crédite deux fois.

- Chaque transaction de crédit porte un **`idempotency_key`** unique et déterministe, par exemple `referral:{referral_id}:referrer` et `referral:{referral_id}:referee`. Avant d'insérer, on vérifie que cette clé n'existe pas déjà — contrainte `UNIQUE` en base, donc même en cas de double appel simultané, le deuxième échoue proprement.
- Idem pour les codes promo : `promo_codes.uses_count` s'incrémente dans la **même transaction SQL** que la vérification `uses_count < max_uses`, pour éviter qu'un code à usage unique soit validé deux fois par deux requêtes simultanées (race condition classique).

---

## 7. Ce qui reste à trancher (décisions produit, pas techniques)

- Combien de temps le "délai de carence" avant crédit (48h ? 7 jours ?) — arbitrage entre friction et sécurité.
- Que se passe-t-il si un `referral` est rejeté après coup (filleul supprimé) : retire-t-on les crédits déjà dépensés par le parrain ? (Recommandé : non, on log juste la perte, pour ne pas mettre un utilisateur en solde négatif à cause d'un tiers.)
- Plafond de parrainages par personne et par semaine, pour limiter la fraude "lente" et patiente.
