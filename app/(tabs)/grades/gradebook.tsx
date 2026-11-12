import { Papicons } from "@getpapillon/papicons";
import { Stack as ExpoStack } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, View } from "react-native";

import PeriodChips from "@/components/reports/PeriodChips";
import { useReportPeriods } from "@/hooks/useReportPeriods";
import { getManager } from "@/services/shared";
import { Gradebook } from "@/services/shared/evaluation";
import { Capabilities } from "@/services/shared/types";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import Icon from "@/ui/components/Icon";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { formatGradebookAverage, groupGradebookSubjects } from "@/utils/evaluations/gradebook";
import { warn } from "@/utils/logger/logger";
import { getSubjectColor } from "@/utils/subjects/colors";
import { getSubjectEmoji } from "@/utils/subjects/emoji";
import { getSubjectName } from "@/utils/subjects/name";

export default function GradebookScreen() {
  const { colors } = useTheme();
  const { periods, selected, setSelected, supported, loaded } = useReportPeriods(Capabilities.GRADEBOOK);
  const [book, setBook] = useState<Gradebook | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const manager = getManager(true);
    if (!manager || !selected) {return;}
    setLoading(true);
    try {
      setBook(await manager.getGradebook(selected, selected.createdByAccount));
      setLoadError(null);
    } catch (error) {
      warn(`Gradebook: ${String(error)}`);
      setBook(null);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selected]);

  useEffect(() => {
    load();
  }, [load]);

  const openPDF = async () => {
    const manager = getManager(true);
    if (!manager || !selected || opening) {return;}
    setOpening(true);
    try {
      const url = await manager.getGradebookPDF(selected, selected.createdByAccount);
      await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
    } catch (error) {
      Alert.alert("Bulletin PDF", String(error instanceof Error ? error.message : error));
    } finally {
      setOpening(false);
    }
  };

  const groups = book ? groupGradebookSubjects(book.subjects) : [];
  const empty = loaded && !loading && (!book || (book.subjects.length === 0 && book.overall.length === 0));

  return (
    <>
      <ExpoStack.Screen
        options={{
          headerTitle: "Bulletin",
          headerRight: () =>
            book ? (
              <Pressable onPress={openPDF} hitSlop={10} accessibilityLabel="Ouvrir le PDF du bulletin">
                {opening ? <ActivityIndicator /> : (
                  <Icon>
                    <Papicons name="Paper" />
                  </Icon>
                )}
              </Pressable>
            ) : null,
        }}
      />
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        contentContainerStyle={{ paddingVertical: 12 }}
        style={{ flex: 1, backgroundColor: colors.overground }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={<PeriodChips periods={periods} selected={selected} onSelect={setSelected} />}
      >
        {(loading || !loaded) && !book && (
          <View style={{ padding: 40 }}>
            <ActivityIndicator />
          </View>
        )}

        {empty && (
          <View style={{ padding: 32, alignItems: "center", gap: 6 }}>
            <Typography style={{ fontSize: 40 }}>📄</Typography>
            <Typography variant="title" align="center">
              {!supported ? "Bulletin indisponible" : "Pas encore de bulletin"}
            </Typography>
            <Typography color="textSecondary" align="center">
              {!supported
                ? "Ton établissement ne publie pas les bulletins sur ton service scolaire."
                : loadError ?? book?.message ?? "Le bulletin de cette période n'est pas encore publié."}
            </Typography>
          </View>
        )}

        {book && book.overall.length > 0 && (
          <List.Section>
            <List.SectionTitle>
              <List.Label>Appréciation générale</List.Label>
            </List.SectionTitle>
            {book.overall.map(item => (
              <List.Item key={item.name}>
                <Typography variant="body2" color="textSecondary" weight="semibold">{item.name}</Typography>
                <Typography variant="body1" selectable>{item.value}</Typography>
              </List.Item>
            ))}
          </List.Section>
        )}

        {groups.map(group => (
          <List.Section key={group.name || "subjects"}>
            <List.SectionTitle>
              <List.Label>{group.name || "Matières"}</List.Label>
            </List.SectionTitle>
            {group.subjects.map(subject => (
              <List.Item key={`${group.name}-${subject.name}`}>
                <List.Leading>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: getSubjectColor(subject.name) + "33", alignItems: "center", justifyContent: "center" }}>
                    <Typography style={{ fontSize: 18 }}>{getSubjectEmoji(subject.name)}</Typography>
                  </View>
                </List.Leading>
                <Typography variant="title">{getSubjectName(subject.name)}</Typography>
                <Typography variant="body2" color="textSecondary">
                  {[
                    `Moi ${formatGradebookAverage(subject.studentAverage)}`,
                    `classe ${formatGradebookAverage(subject.classAverage)}`,
                    subject.min !== null && subject.max !== null ? `${formatGradebookAverage(subject.min)} – ${formatGradebookAverage(subject.max)}` : "",
                    subject.coefficient && subject.coefficient !== 1 ? `coef. ${subject.coefficient}` : "",
                  ].filter(Boolean).join(" · ")}
                </Typography>
                {subject.appreciation ? (
                  <Typography variant="body1" selectable style={{ marginTop: 4 }}>{subject.appreciation}</Typography>
                ) : (
                  <Typography variant="body2" color="textSecondary" style={{ marginTop: 4 }}>Pas d'appréciation.</Typography>
                )}
                {subject.teachers.length > 0 && (
                  <Typography variant="caption" color="textSecondary">{subject.teachers.join(", ")}</Typography>
                )}
              </List.Item>
            ))}
          </List.Section>
        ))}
      </List>
    </>
  );
}
