import { Papicons } from "@getpapillon/papicons";
import * as Haptics from "expo-haptics";
import { Stack as ExpoStack, useLocalSearchParams } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { t } from "i18next";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Platform, View } from "react-native";

import { getManager } from "@/services/shared";
import { Subject } from "@/services/shared/grade";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import AnimatedPressable from "@/ui/components/AnimatedPressable";
import Button from "@/ui/components/Button";
import ContainedNumber from "@/ui/components/ContainedNumber";
import Icon from "@/ui/components/Icon";
import Picker from "@/ui/components/Picker";
import List from "@/ui/new/List";
import TextInput from "@/ui/new/TextInput";
import Typography from "@/ui/new/Typography";
import adjust from "@/utils/adjustColor";
import { getCurrentPeriod } from "@/utils/grades/helper/period";
import {
  formatAverage,
  gradeKey,
  overallAverage,
  parseNumber,
  requiredForOverall,
  requiredForSubject,
  RequiredScore,
  SimulatedGrade,
  SimulationState,
  subjectAverage,
} from "@/utils/grades/simulator";
import { warn } from "@/utils/logger/logger";
import { getSubjectColor } from "@/utils/subjects/colors";
import { getSubjectEmoji } from "@/utils/subjects/emoji";
import { getSubjectName } from "@/utils/subjects/name";

const GREEN = "#1A9E5B";
const RED = "#D60046";

function Delta({ before, after }: { before: number; after: number }) {
  if (before < 0 || after < 0) {return null;}
  const diff = after - before;
  if (Math.abs(diff) < 0.005) {return null;}
  return (
    <Typography variant="body2" weight="semibold" color={diff > 0 ? GREEN : RED}>
      {diff > 0 ? "+" : "−"}{formatAverage(Math.abs(diff))}
    </Typography>
  );
}

function describeRequired(result: RequiredScore, outOf: number): { text: string; color?: string } {
  switch (result.kind) {
    case "reached":
      return { text: "Objectif déjà atteint, même avec 0", color: GREEN };
    case "impossible":
      return { text: `Impossible avec une seule note (max ${formatAverage(result.best)} avec ${outOf}/${outOf})`, color: RED };
    case "needed":
      return { text: `Il te faut au moins ${formatAverage(result.score)}/${outOf}` };
  }
}

let simId = 0;

export default function GradeSimulator() {
  const { period: periodId } = useLocalSearchParams<{ period?: string }>();
  const theme = useTheme();
  const { colors } = theme;

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodName, setPeriodName] = useState<string>("");

  const [simulated, setSimulated] = useState<SimulatedGrade[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  // Per-subject "add a grade" inputs.
  const [score, setScore] = useState("");
  const [outOf, setOutOf] = useState("20");
  const [coefficient, setCoefficient] = useState("1");

  // Goal calculator.
  const [goalMode, setGoalMode] = useState(0); // 0 = overall, 1 = subject
  const [goalTarget, setGoalTarget] = useState("");
  const [goalSubject, setGoalSubject] = useState(0);
  const [goalCoefficient, setGoalCoefficient] = useState("1");

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
        setPeriodName(period.name);
        setSubjects(
          (periodGrades.subjects ?? [])
            .filter(subject => (subject.grades?.length ?? 0) > 0)
            .sort((a, b) => getSubjectName(a.name).localeCompare(getSubjectName(b.name)))
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
  }, [periodId]);

  const baseState = useMemo<SimulationState>(() => ({ simulated: [], excluded: new Set() }), []);
  const state = useMemo<SimulationState>(() => ({ simulated, excluded }), [simulated, excluded]);
  const modified = simulated.length > 0 || excluded.size > 0;

  const currentOverall = useMemo(() => overallAverage(subjects, baseState), [subjects, baseState]);
  const simulatedOverall = useMemo(() => overallAverage(subjects, state), [subjects, state]);

  const reset = useCallback(() => {
    setSimulated([]);
    setExcluded(new Set());
    Haptics.selectionAsync();
  }, []);

  const addGrade = (subject: Subject) => {
    const value = parseNumber(score);
    const max = parseNumber(outOf);
    const coef = parseNumber(coefficient);
    if (!Number.isFinite(max) || max <= 0) {
      Alert.alert("Barème invalide", "Le barème doit être supérieur à 0.");
      return;
    }
    if (!Number.isFinite(value) || value < 0 || value > max) {
      Alert.alert("Note invalide", `Entre une note entre 0 et ${max}.`);
      return;
    }
    if (!Number.isFinite(coef) || coef <= 0) {
      Alert.alert("Coefficient invalide", "Le coefficient doit être supérieur à 0.");
      return;
    }
    setSimulated(prev => [...prev, { id: `sim-${++simId}`, subjectId: subject.id, score: value, outOf: max, coefficient: coef }]);
    setScore("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const toggleExcluded = (key: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(key)) {next.delete(key);} else {next.add(key);}
      return next;
    });
    Haptics.selectionAsync();
  };

  const goal = useMemo(() => {
    const target = parseNumber(goalTarget);
    const coef = parseNumber(goalCoefficient);
    const subject = subjects[goalSubject];
    if (!subject || !Number.isFinite(target) || target <= 0 || target > 20 || !Number.isFinite(coef) || coef <= 0) {
      return null;
    }
    const result = goalMode === 0
      ? requiredForOverall(subjects, subject.id, state, target, 20, coef)
      : requiredForSubject(subject, state, target, 20, coef);
    return describeRequired(result, 20);
  }, [goalTarget, goalCoefficient, goalSubject, goalMode, subjects, state]);

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

  const tint = Platform.OS === "android" ? colors.primary : colors.text;

  return (
    <>
      <ExpoStack.Screen options={{ headerTitle: "Simulateur" }} />
      {modified && (
        Platform.OS === "android" ? null : (
          <ExpoStack.Toolbar placement="right">
            <ExpoStack.Toolbar.Button icon="arrow.counterclockwise" onPress={reset}>
              Réinitialiser
            </ExpoStack.Toolbar.Button>
          </ExpoStack.Toolbar>
        )
      )}
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        contentContainerStyle={{ paddingVertical: 16, width: "100%", maxWidth: 900, alignSelf: "center" }}
        style={{ flex: 1, backgroundColor: colors.overground }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <List.Section>
          <List.SectionTitle>
            <List.Label>{periodName ? `Moyenne générale · ${periodName}` : "Moyenne générale"}</List.Label>
          </List.SectionTitle>
          <List.Item>
            <List.Leading>
              <Icon>
                <Papicons name="Grades" />
              </Icon>
            </List.Leading>
            <Typography variant="title">{modified ? "Avec ta simulation" : "Actuelle"}</Typography>
            <Typography color="textSecondary" numberOfLines={3}>
              {modified
                ? `Actuellement ${formatAverage(currentOverall)}/20`
                : "Ajoute des notes ou retire-en pour voir l'effet. Estimation : moyenne des matières, sans coefficients de bulletin."}
            </Typography>
            <List.Trailing>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <ContainedNumber color={String(tint)} denominator="/20">
                  {formatAverage(simulatedOverall)}
                </ContainedNumber>
                <Delta before={currentOverall} after={simulatedOverall} />
              </View>
            </List.Trailing>
          </List.Item>
        </List.Section>

        <List.Section>
          <List.SectionTitle>
            <List.Label>Objectif</List.Label>
          </List.SectionTitle>
          <View style={{ gap: 10, paddingVertical: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Typography color="textSecondary">Atteindre</Typography>
              <Picker
                options={["Moyenne générale", "Moyenne de la matière"]}
                selectedIndex={goalMode}
                onValueChange={setGoalMode}
              />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Typography color="textSecondary">Avec une note en</Typography>
              <Picker
                options={subjects.map(subject => `${getSubjectEmoji(subject.name)} ${getSubjectName(subject.name)}`)}
                selectedIndex={Math.min(goalSubject, subjects.length - 1)}
                onValueChange={setGoalSubject}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  placeholder="Objectif /20"
                  value={goalTarget}
                  onChangeText={setGoalTarget}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ width: 110 }}>
                <TextInput
                  placeholder="Coef."
                  value={goalCoefficient}
                  onChangeText={setGoalCoefficient}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            {goal && (
              <Typography variant="title" color={goal.color ?? "textPrimary"}>
                {goal.text}
              </Typography>
            )}
          </View>
        </List.Section>

        {subjects.map(subject => {
          const color = getSubjectColor(subject.name);
          const subjectTint = Platform.OS === "android" ? colors.primary : adjust(color, theme.dark ? 0.4 : -0.3);
          const before = subjectAverage(subject, baseState);
          const after = subjectAverage(subject, state);
          const isOpen = expanded === subject.id;
          const sims = simulated.filter(sim => sim.subjectId === subject.id);
          const changed = sims.length > 0 || (subject.grades ?? []).some((grade, index) => excluded.has(gradeKey(grade, index)));

          return (
            <List.Section key={subject.id}>
              <List.Item onPress={() => setExpanded(isOpen ? null : subject.id)}>
                <List.Leading>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: color + "33", alignItems: "center", justifyContent: "center" }}>
                    <Typography>{getSubjectEmoji(subject.name)}</Typography>
                  </View>
                </List.Leading>
                <Typography variant="title" numberOfLines={1}>{getSubjectName(subject.name)}</Typography>
                <Typography color="textSecondary" variant="body2">
                  {changed ? `Actuellement ${formatAverage(before)}/20 · ` : ""}
                  {subject.grades?.length ?? 0} note{(subject.grades?.length ?? 0) > 1 ? "s" : ""}
                  {sims.length > 0 ? ` + ${sims.length} simulée${sims.length > 1 ? "s" : ""}` : ""}
                </Typography>
                <List.Trailing>
                  <View style={{ alignItems: "flex-end", gap: 2 }}>
                    <ContainedNumber color={String(subjectTint)} denominator="/20">
                      {formatAverage(after)}
                    </ContainedNumber>
                    <Delta before={before} after={after} />
                  </View>
                </List.Trailing>
              </List.Item>

              {isOpen && (subject.grades ?? []).map((grade, index) => {
                const key = gradeKey(grade, index);
                const off = excluded.has(key);
                const value = grade.studentScore;
                const usable = value && !value.disabled && typeof value.value === "number";
                return (
                  <List.Item key={key} onPress={usable ? () => toggleExcluded(key) : undefined}>
                    <List.Leading>
                      <Icon opacity={off ? 0.3 : 1}>
                        <Papicons name={off ? "Cross" : "Check"} />
                      </Icon>
                    </List.Leading>
                    <Typography
                      variant="body1"
                      numberOfLines={1}
                      style={off ? { textDecorationLine: "line-through", opacity: 0.45 } : undefined}
                    >
                      {grade.description || "Note"}
                    </Typography>
                    <Typography color="textSecondary" variant="body2" style={off ? { opacity: 0.45 } : undefined}>
                      {grade.givenAt ? new Date(grade.givenAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " · " : ""}
                      coef. {grade.coefficient}
                      {off ? " · retirée du calcul" : ""}
                    </Typography>
                    <List.Trailing>
                      <Typography variant="title" style={off ? { textDecorationLine: "line-through", opacity: 0.45 } : undefined}>
                        {usable ? `${formatAverage(value.value, 2).replace(/,00$/, "")}/${grade.outOf?.value ?? 20}` : value?.status ?? "—"}
                      </Typography>
                    </List.Trailing>
                  </List.Item>
                );
              })}

              {isOpen && sims.map(sim => (
                <List.Item key={sim.id} onPress={() => setSimulated(prev => prev.filter(item => item.id !== sim.id))}>
                  <List.Leading>
                    <Icon>
                      <Papicons name="Sparkles" />
                    </Icon>
                  </List.Leading>
                  <Typography variant="body1">Note simulée</Typography>
                  <Typography color="textSecondary" variant="body2">coef. {sim.coefficient} · touche pour supprimer</Typography>
                  <List.Trailing>
                    <Typography variant="title" color={String(subjectTint)}>
                      {`${formatAverage(sim.score).replace(/,00$/, "")}/${sim.outOf}`}
                    </Typography>
                  </List.Trailing>
                </List.Item>
              ))}

              {isOpen && (
                <View style={{ flexDirection: "row", gap: 8, paddingVertical: 8, alignItems: "center" }}>
                  <View style={{ flex: 1.3 }}>
                    <TextInput placeholder="Note" value={score} onChangeText={setScore} keyboardType="decimal-pad" height={46} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput placeholder="Sur" value={outOf} onChangeText={setOutOf} keyboardType="decimal-pad" height={46} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput placeholder="Coef." value={coefficient} onChangeText={setCoefficient} keyboardType="decimal-pad" height={46} />
                  </View>
                  <AnimatedPressable onPress={() => addGrade(subject)}>
                    <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: String(subjectTint), alignItems: "center", justifyContent: "center" }}>
                      <Papicons name="Plus" size={24} color="#FFFFFF" />
                    </View>
                  </AnimatedPressable>
                </View>
              )}

              {isOpen && (() => {
                const target = parseNumber(goalTarget);
                if (!Number.isFinite(target) || target <= 0 || target > 20) {return null;}
                const result = describeRequired(requiredForSubject(subject, state, target, 20, parseNumber(coefficient) || 1), 20);
                return (
                  <View style={{ paddingBottom: 6 }}>
                    <Typography variant="body2" color={result.color ?? "textSecondary"}>
                      {`Pour ${formatAverage(target)} de moyenne ici (coef. ${parseNumber(coefficient) || 1}) : ${result.text.charAt(0).toLowerCase()}${result.text.slice(1)}`}
                    </Typography>
                  </View>
                );
              })()}
            </List.Section>
          );
        })}

        {modified && (
          <List.Section>
            <View style={{ paddingVertical: 8 }}>
              <Button title="Réinitialiser la simulation" variant="outline" onPress={reset} />
            </View>
          </List.Section>
        )}
      </List>
    </>
  );
}
