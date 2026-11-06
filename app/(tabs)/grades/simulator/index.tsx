import { Papicons } from "@getpapillon/papicons";
import * as Haptics from "expo-haptics";
import { router, Stack as ExpoStack, useLocalSearchParams } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { t } from "i18next";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";

import { AverageHero, Chip, ChipRow, DeltaPill, describeRequired } from "@/components/simulator/SimulatorBits";
import { getManager } from "@/services/shared";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import Icon from "@/ui/components/Icon";
import Picker from "@/ui/components/Picker";
import List from "@/ui/new/List";
import TextInput from "@/ui/new/TextInput";
import Typography from "@/ui/new/Typography";
import adjust from "@/utils/adjustColor";
import { getCurrentPeriod } from "@/utils/grades/helper/period";
import {
  anchorsFrom,
  formatAverage,
  gradeKey,
  overallAverage,
  parseNumber,
  requiredForOverall,
  SimulationState,
  subjectAverage,
} from "@/utils/grades/simulator";
import { warn } from "@/utils/logger/logger";
import { getSubjectColor } from "@/utils/subjects/colors";
import { getSubjectEmoji } from "@/utils/subjects/emoji";
import { getSubjectName } from "@/utils/subjects/name";
import { useSimulatorStore } from "@/stores/simulator";

const COEFFICIENTS = [0.5, 1, 2, 3, 4];
const EMPTY: SimulationState = { simulated: [], excluded: new Set() };

export default function GradeSimulator() {
  const { period: periodId } = useLocalSearchParams<{ period?: string }>();
  const theme = useTheme();
  const { colors } = theme;

  const { subjects, anchors, simulated, excluded, periodName, load, reset } = useSimulatorStore();
  const [loading, setLoading] = useState(subjects.length === 0);

  const [goalTarget, setGoalTarget] = useState("");
  const [goalSubject, setGoalSubject] = useState(0);
  const [goalCoefficient, setGoalCoefficient] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manager = getManager();
        if (!manager) {return;}
        const periods = await manager.getGradesPeriods();
        const period = periods.find(candidate => candidate.id === periodId) ?? getCurrentPeriod(periods);
        if (!period) {return;}
        const periodGrades = await manager.getGradesForPeriod(period, period.createdByAccount);
        if (cancelled) {return;}
        const withGrades = (periodGrades.subjects ?? [])
          .filter(subject => (subject.grades?.length ?? 0) > 0)
          .sort((a, b) => getSubjectName(a.name).localeCompare(getSubjectName(b.name)));
        load(
          `${period.createdByAccount}:${period.id ?? period.name}`,
          period.name,
          withGrades,
          anchorsFrom(withGrades, periodGrades.studentOverall)
        );
      } catch (error) {
        warn(`Simulator: unable to load grades: ${String(error)}`);
      } finally {
        if (!cancelled) {setLoading(false);}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [periodId, load]);

  const state = useMemo<SimulationState>(() => ({ simulated, excluded: new Set(excluded) }), [simulated, excluded]);
  const modified = simulated.length > 0 || excluded.length > 0;

  const current = useMemo(() => overallAverage(subjects, EMPTY, [], anchors), [subjects, anchors]);
  const simulatedOverall = useMemo(() => overallAverage(subjects, state, [], anchors), [subjects, state, anchors]);

  const goal = useMemo(() => {
    const target = parseNumber(goalTarget);
    const subject = subjects[goalSubject];
    if (!subject || !Number.isFinite(target) || target <= 0 || target > 20) {return null;}
    return describeRequired(requiredForOverall(subjects, subject.id, state, target, 20, goalCoefficient, anchors), 20);
  }, [goalTarget, goalSubject, goalCoefficient, subjects, state, anchors]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (subjects.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 6, backgroundColor: colors.background }}>
        <Typography variant="title" align="center">{t("Grades_Empty_Title")}</Typography>
        <Typography color="textSecondary" align="center">Le simulateur a besoin d'au moins une note sur la période.</Typography>
      </View>
    );
  }

  const tint = String(Platform.OS === "android" ? colors.primary : colors.text);
  const accent = String(colors.primary);

  return (
    <>
      <ExpoStack.Screen options={{ headerTitle: "Simulateur" }} />
      {modified && Platform.OS === "ios" && (
        <ExpoStack.Toolbar placement="right">
          <ExpoStack.Toolbar.Button icon="arrow.counterclockwise" onPress={() => { reset(); Haptics.selectionAsync(); }}>
            Réinitialiser
          </ExpoStack.Toolbar.Button>
        </ExpoStack.Toolbar>
      )}
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        contentContainerStyle={{ paddingVertical: 8, width: "100%", maxWidth: 900, alignSelf: "center" }}
        style={{ flex: 1, backgroundColor: colors.overground }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <AverageHero
            label={periodName ? `Moyenne générale · ${periodName}` : "Moyenne générale"}
            before={current}
            after={simulatedOverall}
            tint={tint}
            caption="Touche une matière pour y ajouter ou retirer des notes."
          />
        }
      >
        <List.Section>
          <List.SectionTitle>
            <List.Label>Matières</List.Label>
          </List.SectionTitle>
          {subjects.map(subject => {
            const color = getSubjectColor(subject.name);
            const subjectTint = String(Platform.OS === "android" ? colors.primary : adjust(color, theme.dark ? 0.4 : -0.3));
            const before = subjectAverage(subject, EMPTY, [], anchors);
            const after = subjectAverage(subject, state, [], anchors);
            const sims = simulated.filter(sim => sim.subjectId === subject.id).length;
            const removed = (subject.grades ?? []).filter((grade, index) => excluded.includes(gradeKey(grade, index))).length;
            const details = [
              `${subject.grades?.length ?? 0} note${(subject.grades?.length ?? 0) > 1 ? "s" : ""}`,
              sims ? `+${sims} simulée${sims > 1 ? "s" : ""}` : null,
              removed ? `${removed} retirée${removed > 1 ? "s" : ""}` : null,
            ].filter(Boolean).join(" · ");

            return (
              <List.Item
                key={subject.id}
                onPress={() => router.push({ pathname: "/(tabs)/grades/simulator/[id]", params: { id: subject.id } })}
              >
                <List.Leading>
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: color + "2E", alignItems: "center", justifyContent: "center" }}>
                    <Typography>{getSubjectEmoji(subject.name)}</Typography>
                  </View>
                </List.Leading>
                <Typography variant="title" numberOfLines={1}>{getSubjectName(subject.name)}</Typography>
                <Typography color={sims || removed ? subjectTint : "textSecondary"} variant="body2" numberOfLines={1}>
                  {details}
                </Typography>
                <List.Trailing>
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    <Typography variant="title" color={subjectTint}>{formatAverage(after)}</Typography>
                    <DeltaPill before={before} after={after} />
                  </View>
                </List.Trailing>
              </List.Item>
            );
          })}
        </List.Section>

        <List.Section>
          <List.SectionTitle>
            <List.Label>Objectif de moyenne générale</List.Label>
          </List.SectionTitle>
          <View style={{ gap: 12, paddingVertical: 6 }}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <View style={{ width: 120 }}>
                <TextInput
                  placeholder="Ex. 17,5"
                  value={goalTarget}
                  onChangeText={setGoalTarget}
                  keyboardType="decimal-pad"
                />
              </View>
              <Typography color="textSecondary" style={{ flex: 1 }}>
                avec la prochaine note en
              </Typography>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Picker
                options={subjects.map(subject => `${getSubjectEmoji(subject.name)} ${getSubjectName(subject.name)}`)}
                selectedIndex={Math.min(goalSubject, subjects.length - 1)}
                onValueChange={setGoalSubject}
              />
            </View>
            <View style={{ gap: 6 }}>
              <Typography variant="body2" color="textSecondary">Coefficient de cette note</Typography>
              <ChipRow>
                {COEFFICIENTS.map(coef => (
                  <Chip
                    key={coef}
                    label={`×${String(coef).replace(".", ",")}`}
                    selected={goalCoefficient === coef}
                    onPress={() => setGoalCoefficient(coef)}
                    color={accent}
                  />
                ))}
              </ChipRow>
            </View>
            {goal && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 2 }}>
                <Icon>
                  <Papicons name="Sparkles" />
                </Icon>
                <Typography variant="title" color={goal.color ?? "textPrimary"} style={{ flex: 1 }}>
                  {goal.text}
                </Typography>
              </View>
            )}
          </View>
        </List.Section>

        <List.Section>
          <List.Item>
            <Typography variant="caption" color="textSecondary">
              Les moyennes partent de celles de ton établissement ; chaque changement les décale de l'écart calculé par Papillon. C'est une estimation : les coefficients des matières du bulletin ne sont pas connus.
            </Typography>
          </List.Item>
          {modified && Platform.OS === "android" && (
            <List.Item onPress={() => reset()}>
              <List.Leading>
                <Icon>
                  <Papicons name="Cross" />
                </Icon>
              </List.Leading>
              <Typography variant="title">Réinitialiser la simulation</Typography>
            </List.Item>
          )}
        </List.Section>
      </List>
    </>
  );
}
