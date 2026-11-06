import { Papicons } from "@getpapillon/papicons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Platform, View } from "react-native";

import ModalOverhead from "@/components/ModalOverhead";
import { getVikunjaClient } from "@/services/vikunja";
import { parseVikunjaDate, VikunjaTask } from "@/services/vikunja/api";
import { useVikunjaStore } from "@/stores/vikunja";
import { useVikunjaTasksStore, vikunjaTasksAsHomework } from "@/stores/vikunja/tasks";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import AnimatedPressable from "@/ui/components/AnimatedPressable";
import Icon from "@/ui/components/Icon";
import SafeHorizontalView from "@/ui/components/SafeHorizontalView";
import Stack from "@/ui/components/Stack";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { formatHTML } from "@/utils/format/html";
import { getSubjectColor } from "@/utils/subjects/colors";
import { getSubjectEmoji } from "@/utils/subjects/emoji";
import { getSubjectName } from "@/utils/subjects/name";

export default function VikunjaTaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const taskId = Number(id);
  const router = useRouter();
  const theme = useTheme();
  const { colors } = theme;
  const baseURL = useVikunjaStore(state => state.baseURL);

  const { tasks, projects, doneLocally, setDone, remove } = useVikunjaTasksStore();
  const [task, setTask] = useState<VikunjaTask | undefined>(() => tasks.find(item => item.id === taskId));
  const [loading, setLoading] = useState(!task);

  useEffect(() => {
    let cancelled = false;
    getVikunjaClient()
      .then(client => client?.getTask(taskId))
      .then(fresh => {
        if (!cancelled && fresh) {setTask(fresh);}
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {setLoading(false);}
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const item = useMemo(
    () => (task ? vikunjaTasksAsHomework([task], projects, doneLocally, new Date(0))[0] : undefined),
    [task, projects, doneLocally]
  );

  if (loading && !task) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;
  }
  if (!task || !item?.vikunja) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Typography color="textSecondary">Tâche introuvable.</Typography></View>;
  }

  const meta = item.vikunja;
  const display = meta.subjectKey
    ? { name: getSubjectName(meta.subjectKey), emoji: getSubjectEmoji(meta.subjectKey), color: getSubjectColor(meta.subjectKey) }
    : { name: meta.projectPath, emoji: "📋", color: meta.color ?? "#5B6CF0" };
  const due = parseVikunjaDate(task.due_date);
  const isDone = item.isDone;

  const toggle = async () => {
    try {
      await setDone(task.id, !isDone);
    } catch (error) {
      Alert.alert("Vikunja", String(error instanceof Error ? error.message : error));
    }
  };

  const open = () => {
    if (!baseURL) {return;}
    WebBrowser.openBrowserAsync(`${baseURL.replace(/\/api\/v1$/, "")}/tasks/${task.id}`, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
    });
  };

  const confirmDelete = () => {
    Alert.alert("Supprimer la tâche ?", `« ${task.title} » sera supprimée de Vikunja.`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            await remove(task.id);
            router.back();
          } catch (error) {
            Alert.alert("Vikunja", String(error instanceof Error ? error.message : error));
          }
        },
      },
    ]);
  };

  return (
    <>
      {Platform.OS !== "android" && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overground, zIndex: -10 }}>
          <LinearGradient
            colors={[display.color, String(colors.overground)]}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: 300, opacity: 0.4 }}
          />
        </View>
      )}
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        style={{ backgroundColor: "transparent" }}
        contentContainerStyle={{ paddingVertical: 16 }}
        ListHeaderComponent={
          <SafeHorizontalView base={16}>
            <ModalOverhead
              emoji={display.emoji}
              subject={display.name}
              subjectVariant="header"
              color={Platform.OS === "ios" ? display.color : String(colors.primary)}
              title={task.title}
              date={due ?? undefined}
              style={{ marginVertical: 0 }}
            />
          </SafeHorizontalView>
        }
      >
        <List.Section>
          <List.SectionTitle>
            <List.Label>Statut</List.Label>
          </List.SectionTitle>
          <List.Item>
            <List.Leading>
              <AnimatedPressable onPress={toggle}>
                <Stack
                  backgroundColor={isDone ? (Platform.OS === "ios" ? display.color : String(colors.primary)) : String(colors.card)}
                  card
                  radius={100}
                  width={28}
                  height={28}
                  vAlign="center"
                  hAlign="center"
                >
                  {isDone && <Papicons name="check" size={22} color="white" />}
                </Stack>
              </AnimatedPressable>
            </List.Leading>
            <Typography variant="title">{isDone ? "Fait" : "À faire"}</Typography>
            <Typography variant="body1" color="textSecondary">
              {[meta.projectPath, due ? due.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "Sans échéance"].join(" · ")}
            </Typography>
          </List.Item>
        </List.Section>

        {Boolean(task.description?.trim()) && (
          <List.Section>
            <List.SectionTitle>
              <List.Label>Description</List.Label>
            </List.SectionTitle>
            <List.Item>
              <Typography>{formatHTML(task.description)}</Typography>
            </List.Item>
          </List.Section>
        )}

        <List.Section>
          <List.Item onPress={open}>
            <List.Leading>
              <Icon>
                <Papicons name="ExternalLink" />
              </Icon>
            </List.Leading>
            <Typography variant="title">Ouvrir dans Vikunja</Typography>
            <Typography variant="body1" color="textSecondary">Modifier, ajouter des rappels, des étiquettes…</Typography>
          </List.Item>
          <List.Item onPress={confirmDelete}>
            <List.Leading>
              <Icon>
                <Papicons name="Trash" />
              </Icon>
            </List.Leading>
            <Typography variant="title" color="#DC1400">Supprimer la tâche</Typography>
          </List.Item>
        </List.Section>
      </List>
    </>
  );
}
