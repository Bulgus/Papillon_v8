import { Papicons } from "@getpapillon/papicons";
import * as Haptics from "expo-haptics";
import { router, Stack as ExpoStack } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, View } from "react-native";

import { getVikunjaClient, getVikunjaProjects } from "@/services/vikunja";
import { parseVikunjaDate, VikunjaProject, VikunjaTask } from "@/services/vikunja/api";
import { useVikunjaStore } from "@/stores/vikunja";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import AnimatedPressable from "@/ui/components/AnimatedPressable";
import Icon from "@/ui/components/Icon";
import Picker from "@/ui/components/Picker";
import List from "@/ui/new/List";
import TextInput from "@/ui/new/TextInput";
import Typography from "@/ui/new/Typography";

type Group = { key: string; title: string; tasks: VikunjaTask[] };

const DAY = 86400000;

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupTasks(tasks: VikunjaTask[]): Group[] {
  const today = startOfDay(new Date());
  const groups: Group[] = [
    { key: "late", title: "En retard", tasks: [] },
    { key: "today", title: "Aujourd'hui", tasks: [] },
    { key: "tomorrow", title: "Demain", tasks: [] },
    { key: "week", title: "Dans les 7 jours", tasks: [] },
    { key: "later", title: "Plus tard", tasks: [] },
    { key: "none", title: "Sans échéance", tasks: [] },
  ];
  const byKey = Object.fromEntries(groups.map(group => [group.key, group]));
  for (const task of tasks) {
    const due = parseVikunjaDate(task.due_date);
    if (!due) {byKey.none.tasks.push(task); continue;}
    const day = startOfDay(due);
    if (day < today) {byKey.late.tasks.push(task);}
    else if (day === today) {byKey.today.tasks.push(task);}
    else if (day === today + DAY) {byKey.tomorrow.tasks.push(task);}
    else if (day <= today + 7 * DAY) {byKey.week.tasks.push(task);}
    else {byKey.later.tasks.push(task);}
  }
  for (const group of groups) {
    group.tasks.sort((a, b) =>
      (parseVikunjaDate(a.due_date)?.getTime() ?? Infinity) - (parseVikunjaDate(b.due_date)?.getTime() ?? Infinity) ||
      b.priority - a.priority
    );
  }
  return groups.filter(group => group.tasks.length > 0);
}

/** "Lire le chapitre 3 demain" → due tomorrow. */
function parseQuickAdd(input: string): { title: string; due: Date | null } {
  const rules: Array<[RegExp, number]> = [
    [/\s+(aujourd'hui|aujourdhui|auj)$/i, 0],
    [/\s+(demain|dem)$/i, 1],
    [/\s+(après-demain|apres-demain|apres demain)$/i, 2],
  ];
  for (const [regex, offset] of rules) {
    if (regex.test(input)) {
      const due = new Date();
      due.setDate(due.getDate() + offset);
      due.setHours(18, 0, 0, 0);
      return { title: input.replace(regex, "").trim(), due };
    }
  }
  return { title: input.trim(), due: null };
}

function dueLabel(task: VikunjaTask): string | null {
  const due = parseVikunjaDate(task.due_date);
  if (!due) {return null;}
  const sameYear = due.getFullYear() === new Date().getFullYear();
  const date = due.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
  const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;
  return hasTime ? `${date} · ${due.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : date;
}

export default function VikunjaTasks() {
  const { colors } = useTheme();
  const connected = useVikunjaStore(state => state.connected);
  const baseURL = useVikunjaStore(state => state.baseURL);
  const defaultProjectId = useVikunjaStore(state => state.defaultProjectId);

  const [tasks, setTasks] = useState<VikunjaTask[]>([]);
  const [projects, setProjects] = useState<VikunjaProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState(0);
  const [draft, setDraft] = useState("");
  const [targetProject, setTargetProject] = useState<number | null>(null);
  const [pending, setPending] = useState<Set<number>>(new Set());

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {setRefreshing(true);}
    try {
      const client = await getVikunjaClient();
      if (!client) {return;}
      const [openTasks, allProjects] = await Promise.all([client.getOpenTasks(), getVikunjaProjects(isRefresh)]);
      setTasks(openTasks);
      setProjects(allProjects);
    } catch (error) {
      Alert.alert("Vikunja", error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const projectPath = useCallback((id: number) => {
    const project = projectById.get(id);
    if (!project) {return "";}
    const parent = projectById.get(project.parent_project_id);
    return parent ? `${parent.title} › ${project.title}` : project.title;
  }, [projectById]);

  const filterOptions = useMemo(() => [{ id: 0, title: "Tous les projets" }, ...projects], [projects]);
  const filterId = filterOptions[filter]?.id ?? 0;

  const visibleTasks = useMemo(() => {
    if (!filterId) {return tasks;}
    // A parent project also shows its sub-projects' tasks ("Scolaire" → every subject).
    const ids = new Set([filterId, ...projects.filter(project => project.parent_project_id === filterId).map(project => project.id)]);
    return tasks.filter(task => ids.has(task.project_id));
  }, [tasks, filterId, projects]);

  const groups = useMemo(() => groupTasks(visibleTasks), [visibleTasks]);

  const resolvedTarget = targetProject
    ?? (filterId || defaultProjectId || projects.find(project => project.title.toLowerCase() === "inbox")?.id || projects[0]?.id);

  const toggle = async (task: VikunjaTask) => {
    setPending(prev => new Set(prev).add(task.id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const client = await getVikunjaClient();
      await client?.setDone(task.id, true);
      setTasks(prev => prev.filter(item => item.id !== task.id));
    } catch (error) {
      Alert.alert("Vikunja", error instanceof Error ? error.message : String(error));
    } finally {
      setPending(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  };

  const add = async () => {
    const { title, due } = parseQuickAdd(draft);
    if (!title || !resolvedTarget) {return;}
    setDraft("");
    try {
      const client = await getVikunjaClient();
      const created = await client?.createTask(resolvedTarget, { title, dueDate: due });
      if (created) {setTasks(prev => [...prev, created]);}
    } catch (error) {
      setDraft(draft);
      Alert.alert("Vikunja", error instanceof Error ? error.message : String(error));
    }
  };

  const openInVikunja = (task: VikunjaTask) => {
    if (!baseURL) {return;}
    WebBrowser.openBrowserAsync(`${baseURL.replace(/\/api\/v1$/, "")}/tasks/${task.id}`, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET });
  };

  if (!connected) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12, backgroundColor: colors.background }}>
        <Typography variant="title" align="center">Vikunja n'est pas connecté</Typography>
        <Typography color="textSecondary" align="center">Connecte ton serveur depuis Réglages › Intégrations.</Typography>
        <AnimatedPressable onPress={() => { router.back(); router.push("/(settings)/integrations"); }}>
          <Typography color="primary" variant="title">Ouvrir les intégrations</Typography>
        </AnimatedPressable>
      </View>
    );
  }

  return (
    <>
      <ExpoStack.Screen options={{ headerTitle: "Vikunja" }} />
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        contentContainerStyle={{ paddingVertical: 16 }}
        style={{ flex: 1, backgroundColor: colors.overground }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        ListHeaderComponent={
          <View style={{ gap: 10, paddingHorizontal: 16, paddingBottom: 8 }}>
            <TextInput
              placeholder="Nouvelle tâche… (finis par « demain » pour l'échéance)"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={add}
              returnKeyType="done"
            />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Typography color="textSecondary" variant="body2">Ajouter dans</Typography>
              <Picker
                options={projects.map(project => projectPath(project.id))}
                selectedIndex={Math.max(0, projects.findIndex(project => project.id === resolvedTarget))}
                onValueChange={index => setTargetProject(projects[index].id)}
              />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Typography color="textSecondary" variant="body2">Afficher</Typography>
              <Picker
                options={filterOptions.map(project => (project.id ? projectPath(project.id) : project.title))}
                selectedIndex={filter}
                onValueChange={setFilter}
              />
            </View>
          </View>
        }
      >
        {loading && (
          <View style={{ padding: 40 }}>
            <ActivityIndicator />
          </View>
        )}

        {!loading && groups.length === 0 && (
          <View style={{ padding: 40, alignItems: "center", gap: 6 }}>
            <Typography variant="title" align="center">Rien à faire 🎉</Typography>
            <Typography color="textSecondary" align="center">Aucune tâche ouverte ici.</Typography>
          </View>
        )}

        {groups.map(group => (
          <List.Section key={group.key}>
            <List.SectionTitle>
              <List.Label>{`${group.title} · ${group.tasks.length}`}</List.Label>
            </List.SectionTitle>
            {group.tasks.map(task => {
              const label = dueLabel(task);
              const color = task.hex_color ? `#${task.hex_color.replace("#", "")}` : group.key === "late" ? "#DC1400" : colors.primary;
              return (
                <List.Item key={task.id} onPress={() => openInVikunja(task)}>
                  <List.Leading>
                    <AnimatedPressable onPress={() => toggle(task)} disabled={pending.has(task.id)}>
                      <View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          borderWidth: 2,
                          borderColor: String(color),
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: pending.has(task.id) ? 0.4 : 1,
                        }}
                      >
                        {pending.has(task.id) && <Papicons name="Check" size={16} color={String(color)} />}
                      </View>
                    </AnimatedPressable>
                  </List.Leading>
                  <Typography variant="title" numberOfLines={2}>
                    {task.priority >= 3 ? "‼️ " : ""}{task.title}
                  </Typography>
                  <Typography color={group.key === "late" ? "#DC1400" : "textSecondary"} variant="body2" numberOfLines={1}>
                    {[projectPath(task.project_id), label].filter(Boolean).join(" · ")}
                  </Typography>
                  {(task.labels?.length ?? 0) > 0 && (
                    <List.Trailing>
                      <Icon>
                        <Papicons name="Bookmark" />
                      </Icon>
                    </List.Trailing>
                  )}
                </List.Item>
              );
            })}
          </List.Section>
        ))}
      </List>
    </>
  );
}
