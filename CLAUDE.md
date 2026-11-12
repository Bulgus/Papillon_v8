# Papillon — fork d'Aimé

Fork personnel de [PapillonApp/Papillon](https://github.com/PapillonApp/Papillon)
avec des ajouts : ARD (cantine), Vikunja, discussions Pronote, notifications,
simulateur de notes, compétences, bulletins, Live Activity corrigée.

## À chaque session de travail

1. **Synchroniser avec l'officiel avant de coder** (branche par défaut `dev`) :
   ```bash
   git remote add upstream https://github.com/PapillonApp/Papillon.git 2>/dev/null
   git fetch upstream dev
   git merge upstream/dev
   ```
   Résoudre les conflits en gardant les ajouts du fork **et** les correctifs
   officiels (ex. : les refresh de service passent par `runAuthRefresh` du
   coordinateur d'auth). Puis `bun install` pour mettre `bun.lock` à jour.
   Le workflow `upstream-sync.yml` signale chaque semaine le retard sur l'officiel.
2. **Tests** : `bunx jest --ci` doit passer avant chaque push (ils tournent aussi
   en CI, avant le build). Toute logique ajoutée vient avec ses tests dans
   `__tests__/` ou à côté du fichier (`*.test.ts`).
3. **Publication** : un push sur la branche déclenche `feather.yml`, qui build
   l'IPA non signée et la publie sur la source Feather via
   `Bulgus/feather-repo/.github/workflows/publish-ipa.yml`. Ne jamais envoyer
   l'IPA dans la conversation, ne jamais dupliquer la logique de release /
   source.json / ntfy dans ce repo. Première ligne de commit courte et
   parlante : elle s'affiche dans Feather.

## Règles

- Aucun identifiant (ARD, Vikunja, Pronote) dans le repo : la connexion se fait
  dans l'app.
- `bun.lock` est commité ; le build utilise `--frozen-lockfile`.
- `scripts/ios-link-check.py` bloque un build dont un symbole natif manque
  (crash au lancement).
- Les modifs natives des dépendances passent par `patches/` (patch-package).
