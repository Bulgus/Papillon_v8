# Papillon : installation par IPA (Feather / Signulous)

## Récupérer l'IPA

Chaque push lance le workflow **Feather** (`.github/workflows/feather.yml`) :
build non signé (Xcode 27), contrôle anti-crash de l'édition de liens, puis
publication sur la source Feather (`Bulgus/feather-repo`, `source.json`) et
notification ntfy. La première ligne du message de commit s'affiche dans
Feather pour distinguer les builds.

## Signer avec Feather

1. Feather › Réglages › Signature : importer le `.p12` (mot de passe Signulous
   `123456`) et le `.mobileprovision` Signulous.
2. Importer l'IPA dans Feather, puis la signer et l'installer.
3. Garder le même identifiant de bundle d'une version à l'autre : les données
   (comptes, réglages) sont alors conservées lors des mises à jour.

## Ce qui dépend du certificat

| Fonction | Besoin | Si absent |
| --- | --- | --- |
| Notifications locales (notes, devoirs, solde, résumé du matin) | rien de spécial | — |
| Rafraîchissement en arrière-plan | Actualisation en arrière-plan activée dans Réglages iOS | vérification à l'ouverture de l'app seulement |
| Widget **Papillon** (EDT, tâches), Live Activity | App Group `group.xyz.getpapillon(.ios)` dans le profil | widget vide → utiliser l'option ci-dessous |
| **Cours dans l'app Calendrier** (Réglages › Intégrations) | accès Calendrier | — |

Avec un profil sans App Group (cas courant des certificats de sideload),
l'app démarre normalement : MMKV et la base de données basculent dans le
dossier de l'app. Pour l'EDT du jour sur l'écran d'accueil ou verrouillé,
active **Cours dans l'app Calendrier** et ajoute le widget **Calendrier**
(« Prochain événement » / « Liste ») d'iOS, éventuellement filtré sur le
calendrier « Papillon – Cours » via le Focus.

## Nouveautés de cette version

- **ARD** : connexion réparée (nouveau portail ARD), soldes, historique complet,
  « Mon identifiant QR Code » affiché dès que l'établissement l'active.
  L'iPhone ne peut pas émuler le badge sans contact du self.
- **Notifications** : nouvelles notes, nouveaux devoirs ou évaluations, solde
  de cantine bas, résumé du matin (Réglages › Intégrations).
- **Vikunja** : tâches dans Papillon, envoi des devoirs (manuel ou automatique)
  dans le projet de la matière, « fait » synchronisé.
- **EDT dans Calendrier** pour les widgets natifs.
- Nombreux correctifs (sessions invalides, comptes en double à l'ajout
  d'ARD/Izly, plantages de la page carte self…).
