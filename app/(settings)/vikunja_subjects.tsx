import { useTheme } from "expo-router/react-navigation";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";

import { getVikunjaProjects, resolveSubjectProject, SUBJECT_NOT_SYNCED, subjectKey } from "@/services/vikunja";
import { VikunjaProject } from "@/services/vikunja/api";
import { useAccountStore } from "@/stores/account";
import { useVikunjaStore } from "@/stores/vikunja";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import Picker from "@/ui/components/Picker";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";

export default function VikunjaSubjects() {
  const { colors } = useTheme();
  const [projects, setProjects] = useState<VikunjaProject[] | null>(null);
  const subjectProjects = useVikunjaStore(state => state.subjectProjects);
  const defaultProjectId = useVikunjaStore(state => state.defaultProjectId);
  const update = useVikunjaStore(state => state.update);

  const accounts = useAccountStore(state => state.accounts);
  const lastUsedAccount = useAccountStore(state => state.lastUsedAccount);
  const subjects = useMemo(() => {
    const account = accounts.find(item => item.id === lastUsedAccount);
    return Object.entries(account?.customisation?.subjects ?? {})
      .map(([key, value]) => ({ key, name: value.name || key, emoji: value.emoji || "📚", color: value.color }))
      .filter(subject => subject.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, lastUsedAccount]);

  useEffect(() => {
    getVikunjaProjects(true)
      .then(setProjects)
      .catch(error => {
        setProjects([]);
        Alert.alert("Vikunja", error instanceof Error ? error.message : String(error));
      });
  }, []);

  const paths = useMemo(() => {
    const byId = new Map((projects ?? []).map(project => [project.id, project]));
    return (projects ?? [])
      .map(project => {
        const parent = byId.get(project.parent_project_id);
        return { id: project.id, path: parent ? `${parent.title} › ${project.title}` : project.title };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [projects]);
  const pathOf = (id?: number) => paths.find(item => item.id === id)?.path ?? "—";

  if (!projects) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.overground }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <List
      contentInsetAdjustmentBehavior="automatic"
      safeHorizontalPadding={16}
      contentContainerStyle={{ paddingVertical: 16 }}
      style={{ flex: 1, backgroundColor: colors.overground }}
    >
      <List.Section>
        <List.Item>
          <Typography color="textSecondary">
            Choisis dans quel projet Vikunja arrivent les devoirs de chaque matière. « Automatique » associe la
            matière au projet qui porte son nom, sinon au projet par défaut. Les tâches des projets associés
            s'affichent avec la couleur et l'emoji de la matière.
          </Typography>
        </List.Item>
      </List.Section>

      <List.Section>
        <List.SectionTitle>
          <List.Label>Projet par défaut</List.Label>
        </List.SectionTitle>
        <List.Item>
          <Typography variant="title">Quand aucune matière ne correspond</Typography>
          <List.Trailing>
            <View style={{ maxWidth: 190, alignItems: "flex-end" }}>
              <Picker
                options={["Automatique (Scolaire, sinon Inbox)", ...paths.map(item => item.path)]}
                selectedIndex={Math.max(0, paths.findIndex(item => item.id === defaultProjectId) + 1)}
                onValueChange={index => update({ defaultProjectId: index === 0 ? undefined : paths[index - 1].id })}
              />
            </View>
          </List.Trailing>
        </List.Item>
      </List.Section>

      <List.Section>
        <List.SectionTitle>
          <List.Label>Matières</List.Label>
        </List.SectionTitle>
        {subjects.length === 0 && (
          <List.Item>
            <Typography color="textSecondary">Aucune matière pour l'instant : elles apparaissent avec tes premières notes et devoirs.</Typography>
          </List.Item>
        )}
        {subjects.map(subject => {
          const key = subjectKey(subject.key);
          const manual = subjectProjects[key];
          const resolved = resolveSubjectProject(subject.key, projects);
          const autoLabel = resolved.source === "auto"
            ? `Automatique (${pathOf(resolved.project?.id)})`
            : `Automatique (par défaut : ${pathOf(resolved.project?.id ?? undefined)})`;
          const options = [
            manual === undefined ? autoLabel : "Automatique",
            "Ne pas envoyer",
            ...paths.map(item => item.path),
          ];
          const selectedIndex = manual === undefined
            ? 0
            : manual === SUBJECT_NOT_SYNCED
              ? 1
              : Math.max(0, paths.findIndex(item => item.id === manual) + 2);

          const subtitle = resolved.source === "excluded"
            ? "Jamais envoyée automatiquement"
            : resolved.source === "fallback"
              ? `Aucun projet à son nom → ${pathOf(resolved.project?.id)}`
              : `→ ${pathOf(resolved.project?.id)}`;

          return (
            <List.Item key={subject.key}>
              <List.Leading>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: (subject.color || "#888888") + "33", alignItems: "center", justifyContent: "center" }}>
                  <Typography>{subject.emoji}</Typography>
                </View>
              </List.Leading>
              <Typography variant="title" numberOfLines={1}>{subject.name}</Typography>
              <Typography variant="body2" color={resolved.source === "fallback" ? "#C94F1A" : "textSecondary"} numberOfLines={1}>
                {subtitle}
              </Typography>
              <List.Trailing>
                <View style={{ maxWidth: 150, alignItems: "flex-end" }}>
                  <Picker
                    options={options}
                    selectedIndex={selectedIndex}
                    onValueChange={index => {
                      const next = { ...subjectProjects };
                      if (index === 0) {delete next[key];}
                      else if (index === 1) {next[key] = SUBJECT_NOT_SYNCED;}
                      else {next[key] = paths[index - 2].id;}
                      update({ subjectProjects: next });
                    }}
                  />
                </View>
              </List.Trailing>
            </List.Item>
          );
        })}
      </List.Section>
    </List>
  );
}
