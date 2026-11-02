import { Papicons } from "@getpapillon/papicons";
import { useTheme } from "expo-router/react-navigation";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, View } from "react-native";

import {
  getNotificationPermission,
  requestNotificationPermission,
  runNotificationCheck,
  sendTestNotification,
} from "@/services/notifications";
import { removePapillonCalendar, requestCalendarAccess, syncTimetableToCalendar } from "@/services/calendarSync";
import { scheduleDailyDigest } from "@/services/notifications/check";
import { createVikunjaToken, VikunjaClient, VikunjaProject, VikunjaTOTPRequiredError, normalizeVikunjaURL } from "@/services/vikunja/api";
import { getVikunjaProjects, getVikunjaClient } from "@/services/vikunja";
import { useNotificationsStore } from "@/stores/notifications";
import { useVikunjaStore } from "@/stores/vikunja";
import Button from "@/ui/components/Button";
import Icon from "@/ui/components/Icon";
import Picker from "@/ui/components/Picker";
import NativeSwitch from "@/ui/native/NativeSwitch";
import List from "@/ui/new/List";
import TextInput from "@/ui/new/TextInput";
import Typography from "@/ui/new/Typography";

const MEAL_OPTIONS = [1, 2, 3, 5, 10];
const HOUR_OPTIONS = [6, 7, 8, 9];

function toggleRow({ icon, title, description, value, onValueChange }: {
  icon: string; title: string; description: string; value: boolean; onValueChange: (value: boolean) => void;
}) {
  return (
    <List.Item key={title}>
      <List.Leading>
        <Icon>
          <Papicons name={icon} />
        </Icon>
      </List.Leading>
      <Typography variant="title">{title}</Typography>
      <Typography color="textSecondary" numberOfLines={3}>{description}</Typography>
      <List.Trailing>
        <NativeSwitch value={value} onValueChange={onValueChange} />
      </List.Trailing>
    </List.Item>
  );
}

function useNotificationsSections(): React.ReactNode[] {
  const preferences = useNotificationsStore(state => state.preferences);
  const setPreferences = useNotificationsStore(state => state.setPreferences);
  const lastCheckAt = useNotificationsStore(state => state.lastCheckAt);
  const [permission, setPermission] = useState<string>("undetermined");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getNotificationPermission().then(setPermission).catch(() => undefined);
  }, []);

  const askPermission = useCallback(async () => {
    const granted = await requestNotificationPermission();
    setPermission(granted ? "granted" : "denied");
    if (!granted) {
      Alert.alert(
        "Notifications désactivées",
        "Active les notifications de Papillon dans Réglages pour être prévenu de tes nouvelles notes.",
        [{ text: "Annuler", style: "cancel" }, { text: "Ouvrir Réglages", onPress: () => Linking.openSettings() }]
      );
    }
  }, []);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const result = await runNotificationCheck({ refresh: true });
      Alert.alert("Vérification terminée", result.replace(/ /g, "\n"));
    } catch (error) {
      Alert.alert("Erreur", String(error));
    } finally {
      setChecking(false);
    }
  }, []);

  return React.Children.toArray((
    <>
      <List.Section>
        <List.SectionTitle>
          <List.Label>Notifications</List.Label>
        </List.SectionTitle>

        {permission !== "granted" && (
          <List.Item onPress={askPermission}>
            <List.Leading>
              <Icon>
                <Papicons name="Bell" />
              </Icon>
            </List.Leading>
            <Typography variant="title">Autoriser les notifications</Typography>
            <Typography color="textSecondary">Nécessaire pour être prévenu en arrière-plan.</Typography>
          </List.Item>
        )}

        {toggleRow({ icon: "Grades", title: "Nouvelles notes", description: "Note, matière et moyenne de classe dès qu'elles arrivent.", value: preferences.newGrades, onValueChange: value => setPreferences({ newGrades: value }) })}
        {toggleRow({ icon: "Tasks", title: "Nouveaux devoirs", description: "Quand un prof ajoute un devoir ou une évaluation sur les deux prochaines semaines.", value: preferences.newHomework, onValueChange: value => setPreferences({ newHomework: value }) })}
        {toggleRow({ icon: "PiggyBank", title: "Solde de cantine bas", description: "Prévient une fois par baisse quand il te reste peu de repas.", value: preferences.lowBalance, onValueChange: value => setPreferences({ lowBalance: value }) })}
        {preferences.lowBalance && (
          <List.Item>
            <List.Leading>
              <Icon>
                <Papicons name="Cutlery" />
              </Icon>
            </List.Leading>
            <Typography variant="title">Seuil d'alerte</Typography>
            <List.Trailing>
              <View style={{ width: 130, alignItems: "flex-end" }}>
                <Picker
                  options={MEAL_OPTIONS.map(count => `${count} repas`)}
                  selectedIndex={Math.max(0, MEAL_OPTIONS.indexOf(preferences.lowBalanceMeals))}
                  onValueChange={index => setPreferences({ lowBalanceMeals: MEAL_OPTIONS[index] })}
                />
              </View>
            </List.Trailing>
          </List.Item>
        )}
        {toggleRow({
          icon: "Sunrise",
          title: "Résumé du matin",
          description: "Tes cours (et ceux annulés) et les devoirs à rendre, chaque matin.",
          value: preferences.dailyDigest,
          onValueChange: value => {
            setPreferences({ dailyDigest: value });
            setTimeout(() => scheduleDailyDigest().catch(() => undefined), 0);
          },
        })}
        {preferences.dailyDigest && (
          <List.Item>
            <List.Leading>
              <Icon>
                <Papicons name="Clock" />
              </Icon>
            </List.Leading>
            <Typography variant="title">Heure du résumé</Typography>
            <List.Trailing>
              <View style={{ width: 100, alignItems: "flex-end" }}>
                <Picker
                  options={HOUR_OPTIONS.map(hour => `${hour} h`)}
                  selectedIndex={Math.max(0, HOUR_OPTIONS.indexOf(preferences.dailyDigestHour))}
                  onValueChange={index => {
                    setPreferences({ dailyDigestHour: HOUR_OPTIONS[index] });
                    setTimeout(() => scheduleDailyDigest().catch(() => undefined), 0);
                  }}
                />
              </View>
            </List.Trailing>
          </List.Item>
        )}
      </List.Section>

      <List.Section>
        <List.SectionTitle>
          <List.Label>Widget emploi du temps</List.Label>
        </List.SectionTitle>
        {toggleRow({
          icon: "Calendar",
          title: "Cours dans l'app Calendrier",
          description: "Copie tes cours des 2 prochaines semaines dans un calendrier « Papillon – Cours » : ajoute le widget Calendrier (écran d'accueil ou verrouillé) pour voir ton EDT du jour. Fonctionne même quand le widget Papillon ne peut pas lire les données (app re-signée).",
          value: preferences.calendarSync,
          onValueChange: async value => {
            if (value) {
              const granted = await requestCalendarAccess();
              if (!granted) {
                Alert.alert(
                  "Accès au calendrier refusé",
                  "Autorise l'accès complet au calendrier pour Papillon dans Réglages.",
                  [{ text: "Annuler", style: "cancel" }, { text: "Ouvrir Réglages", onPress: () => Linking.openSettings() }]
                );
                return;
              }
              setPreferences({ calendarSync: true });
              syncTimetableToCalendar()
                .then(count => Alert.alert("Calendrier", count > 0 ? `${count} cours ajoutés au calendrier « Papillon – Cours ».` : "Ton calendrier est à jour."))
                .catch(error => Alert.alert("Calendrier", String(error)));
            } else {
              setPreferences({ calendarSync: false });
              await removePapillonCalendar();
            }
          },
        })}
      </List.Section>

      <List.Section>
        <List.Item onPress={checking ? undefined : checkNow}>
          <List.Leading>
            <Icon>
              <Papicons name="Search" />
            </Icon>
          </List.Leading>
          <Typography variant="title">{checking ? "Vérification…" : "Vérifier maintenant"}</Typography>
          <Typography color="textSecondary">
            {lastCheckAt
              ? `Dernière vérification : ${new Date(lastCheckAt).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
              : "iOS vérifie en arrière-plan quand il le juge bon (Actualisation en arrière-plan doit être activée)."}
          </Typography>
        </List.Item>
        <List.Item onPress={() => sendTestNotification()}>
          <List.Leading>
            <Icon>
              <Papicons name="Bell" />
            </Icon>
          </List.Leading>
          <Typography variant="title">Envoyer une notification de test</Typography>
        </List.Item>
      </List.Section>
    </>
  ).props.children);
}

function useVikunjaLoginSections(): React.ReactNode[] {
  const connect = useVikunjaStore(state => state.connect);
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [useToken, setUseToken] = useState(false);
  const [apiToken, setApiToken] = useState("");
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!server) {return;}
    setLoading(true);
    try {
      if (useToken) {
        const baseURL = normalizeVikunjaURL(server);
        const client = new VikunjaClient(baseURL, apiToken.trim());
        await client.getProjects();
        await connect({ baseURL, token: apiToken.trim(), displayName: undefined });
      } else {
        const result = await createVikunjaToken(server, username, password, needsTotp ? totp : undefined);
        await connect({ baseURL: result.baseURL, token: result.token, tokenId: result.tokenId, displayName: result.username });
      }
      setPassword("");
    } catch (error) {
      if (error instanceof VikunjaTOTPRequiredError) {
        setNeedsTotp(true);
        Alert.alert("Double authentification", "Entre le code à 6 chiffres de ton application d'authentification.");
      } else {
        Alert.alert("Connexion à Vikunja impossible", error instanceof Error ? error.message : String(error));
      }
    } finally {
      setLoading(false);
    }
  };

  return [
    <List.Section key="vikunja-login">
      <List.SectionTitle>
        <List.Label>Vikunja</List.Label>
      </List.SectionTitle>
      <List.Item>
        <Typography color="textSecondary">
          Connecte ton serveur Vikunja pour voir tes tâches dans Papillon et y envoyer tes devoirs, rangés automatiquement
          dans le projet de chaque matière. Papillon crée un jeton dédié et ne garde jamais ton mot de passe.
        </Typography>
      </List.Item>
      <View style={{ gap: 10, paddingVertical: 10 }}>
        <TextInput
          placeholder="Adresse du serveur (vikunja.exemple.fr)"
          value={server}
          onChangeText={setServer}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
        />
        {useToken ? (
          <TextInput
            placeholder="Jeton API (tk_…)"
            value={apiToken}
            onChangeText={setApiToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        ) : (
          <>
            <TextInput
              placeholder="Identifiant ou e-mail"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
            />
            <TextInput
              placeholder="Mot de passe"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
            />
            {needsTotp && (
              <TextInput
                placeholder="Code de double authentification"
                value={totp}
                onChangeText={setTotp}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
              />
            )}
          </>
        )}
        <Button title="Se connecter" onPress={login} loading={loading} disabled={loading} />
        <Button
          variant="ghost"
          title={useToken ? "Utiliser identifiant et mot de passe" : "J'ai déjà un jeton API"}
          onPress={() => setUseToken(!useToken)}
        />
      </View>
    </List.Section>,
  ];
}

function useVikunjaConnectedSections(): React.ReactNode[] {
  const state = useVikunjaStore();
  const [projects, setProjects] = useState<VikunjaProject[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!state.connected) {return;}
    getVikunjaProjects(true)
      .then(setProjects)
      .catch(error => Alert.alert("Vikunja", error instanceof Error ? error.message : String(error)));
  }, [state.connected]);

  const projectOptions = useMemo(() => [{ id: 0, title: "Automatique" }, ...projects], [projects]);
  const defaultIndex = Math.max(0, projectOptions.findIndex(project => project.id === (state.defaultProjectId ?? 0)));

  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await runNotificationCheck();
      const created = /vikunja:(\d+)/.exec(result)?.[1];
      Alert.alert("Synchronisation", created ? `${created} devoir(s) envoyé(s) vers Vikunja.` : "Rien de nouveau à envoyer.");
    } catch (error) {
      Alert.alert("Vikunja", String(error));
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = () => {
    Alert.alert(
      "Déconnecter Vikunja ?",
      "Le jeton « Papillon » restera visible dans Vikunja (Paramètres › Jetons API), tu peux l'y supprimer.",
      [
        { text: "Annuler", style: "cancel" },
        { text: "Déconnecter", style: "destructive", onPress: () => state.disconnect() },
      ]
    );
  };

  return React.Children.toArray((
    <>
      <List.Section>
        <List.SectionTitle>
          <List.Label>Vikunja</List.Label>
        </List.SectionTitle>
        <List.Item onPress={() => router.push("/(features)/vikunja")}>
          <List.Leading>
            <Icon>
              <Papicons name="Tasks" />
            </Icon>
          </List.Leading>
          <Typography variant="title">Mes tâches Vikunja</Typography>
          <Typography color="textSecondary">
            {state.displayName ? `${state.displayName} · ` : ""}{state.baseURL?.replace(/^https?:\/\//, "").replace(/\/api\/v1$/, "")}
          </Typography>
        </List.Item>
        {toggleRow({ icon: "ArrowRightUp", title: "Envoyer les devoirs automatiquement", description: "Chaque nouveau devoir Pronote devient une tâche dans le projet de sa matière.", value: state.autoSync, onValueChange: value => state.update({ autoSync: value }) })}
        {toggleRow({ icon: "Check", title: "Synchroniser « fait »", description: "Cocher un devoir dans Papillon le coche aussi dans Vikunja.", value: state.syncCompletion, onValueChange: value => state.update({ syncCompletion: value }) })}
        {toggleRow({ icon: "Home", title: "Afficher dans l'onglet Tâches", description: "Ajoute un raccourci vers tes tâches Vikunja dans l'onglet Tâches.", value: state.showInApp, onValueChange: value => state.update({ showInApp: value }) })}
        <List.Item>
          <List.Leading>
            <Icon>
              <Papicons name="Folder" />
            </Icon>
          </List.Leading>
          <Typography variant="title">Projet par défaut</Typography>
          <Typography color="textSecondary" numberOfLines={3}>
            Utilisé quand aucune matière ne correspond. « Automatique » choisit « Scolaire » puis « Inbox ».
          </Typography>
          <List.Trailing>
            <View style={{ width: 130, alignItems: "flex-end" }}>
              <Picker
                options={projectOptions.map(project => project.title)}
                selectedIndex={defaultIndex}
                onValueChange={index => state.update({ defaultProjectId: projectOptions[index].id || undefined })}
              />
            </View>
          </List.Trailing>
        </List.Item>
      </List.Section>
      <List.Section>
        <List.Item onPress={syncing ? undefined : syncNow}>
          <List.Leading>
            <Icon>
              <Papicons name="ArrowRight" />
            </Icon>
          </List.Leading>
          <Typography variant="title">{syncing ? "Synchronisation…" : "Synchroniser maintenant"}</Typography>
          {state.lastSyncAt ? (
            <Typography color="textSecondary">
              Dernière : {new Date(state.lastSyncAt).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
            </Typography>
          ) : null}
        </List.Item>
        <List.Item onPress={disconnect}>
          <List.Leading>
            <Icon>
              <Papicons name="Logout" />
            </Icon>
          </List.Leading>
          <Typography variant="title" color="#DC1400">Déconnecter Vikunja</Typography>
        </List.Item>
      </List.Section>
    </>
  ).props.children);
}

export default function SettingsIntegrations() {
  const { colors } = useTheme();
  const connected = useVikunjaStore(state => state.connected);
  // Hooks, not components: the List only understands sections it can see directly.
  const notificationSections = useNotificationsSections();
  const loginSections = useVikunjaLoginSections();
  const connectedSections = useVikunjaConnectedSections();

  // Make sure the stored token still exists (e.g. after a restore).
  useEffect(() => {
    if (connected) {
      getVikunjaClient().then(client => {
        if (!client) {useVikunjaStore.getState().update({ connected: false });}
      });
    }
  }, [connected]);

  return (
    <List
      contentInsetAdjustmentBehavior="automatic"
      safeHorizontalPadding={16}
      contentContainerStyle={{ paddingVertical: 16 }}
      style={{ flex: 1, backgroundColor: colors.overground }}
    >
      {notificationSections}
      {connected ? connectedSections : loginSections}
    </List>
  );
}
