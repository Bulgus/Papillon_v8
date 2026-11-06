import { Papicons } from "@getpapillon/papicons";
import * as Haptics from "expo-haptics";
import { Stack as ExpoStack, useLocalSearchParams } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import React, { useMemo, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";

import { AverageHero, Chip, ChipRow, describeRequired } from "@/components/simulator/SimulatorBits";
import { useSimulatorStore } from "@/stores/simulator";
import Icon from "@/ui/components/Icon";
import NativeSwitch from "@/ui/native/NativeSwitch";
import List from "@/ui/new/List";
import TextInput from "@/ui/new/TextInput";
import Typography from "@/ui/new/Typography";
import adjust from "@/utils/adjustColor";
import {
  formatAverage,
  gradeKey,
  overallAverage,
  parseNumber,
  requiredForSubject,
  SimulationState,
  subjectAverage,
} from "@/utils/grades/simulator";
import { getSubjectColor } from "@/utils/subjects/colors";
import { getSubjectEmoji } from "@/utils/subjects/emoji";
import { getSubjectName } from "@/utils/subjects/name";

const SCALES = [20, 10, 5, 100];
const COEFFICIENTS = [0.5, 1, 2, 3, 4];
const EMPTY: SimulationState = { simulated: [], excluded: new Set() };

const formatScore = (value: number) => formatAverage(value).replace(/,00$/, "");

export default function SimulatorSubject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { colors } = theme;

  const { subjects, anchors, simulated, excluded, add, remove, toggleExcluded, resetSubject } = useSimulatorStore();
  const subject = subjects.find(candidate => candidate.id === id);

  const [score, setScore] = useState("");
  const [scale, setScale] = useState(20);
  const [coefficient, setCoefficient] = useState(1);
  const [target, setTarget] = useState("");

  const state = useMemo<SimulationState>(() => ({ simulated, excluded: new Set(excluded) }), [simulated, excluded]);

  if (!subject) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <Typography color="textSecondary">Matière introuvable.</Typography>
      </View>
    );
  }

  const color = getSubjectColor(subject.name);
  const tint = String(Platform.OS === "android" ? colors.primary : adjust(color, theme.dark ? 0.4 : -0.3));
  const before = subjectAverage(subject, EMPTY, [], anchors);
  const after = subjectAverage(subject, state, [], anchors);
  const overallBefore = overallAverage(subjects, EMPTY, [], anchors);
  const overallAfter = overallAverage(subjects, state, [], anchors);
  const sims = simulated.filter(sim => sim.subjectId === subject.id);
  const keys = (subject.grades ?? []).map((grade, index) => gradeKey(grade, index));
  const changed = sims.length > 0 || keys.some(key => excluded.includes(key));

  const submit = () => {
    const value = parseNumber(score);
    if (!Number.isFinite(value) || value < 0 || value > scale) {
      Alert.alert("Note invalide", `Entre une note entre 0 et ${scale}.`);
      return;
    }
    add({ subjectId: subject.id, score: value, outOf: scale, coefficient });
    setScore("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const targetValue = parseNumber(target);
  const required = Number.isFinite(targetValue) && targetValue > 0 && targetValue <= 20
    ? describeRequired(requiredForSubject(subject, state, targetValue, scale, coefficient, anchors), scale)
    : null;

  return (
    <>
      <ExpoStack.Screen options={{ headerTitle: getSubjectName(subject.name) }} />
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        contentContainerStyle={{ paddingVertical: 8, width: "100%", maxWidth: 900, alignSelf: "center" }}
        style={{ flex: 1, backgroundColor: colors.overground }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View>
            <AverageHero
              label={`${getSubjectEmoji(subject.name)} Moyenne en ${getSubjectName(subject.name)}`}
              before={before}
              after={after}
              tint={tint}
            />
            {Math.abs(overallAfter - overallBefore) >= 0.005 && (
              <Typography color="textSecondary" align="center" style={{ marginTop: -8, marginBottom: 8 }}>
                {`Moyenne générale : ${formatAverage(overallAfter)} (au lieu de ${formatAverage(overallBefore)})`}
              </Typography>
            )}
          </View>
        }
      >
        <List.Section>
          <List.SectionTitle>
            <List.Label>Ajouter une note</List.Label>
          </List.SectionTitle>
          <View style={{ gap: 12, paddingVertical: 6 }}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  placeholder="Note"
                  value={score}
                  onChangeText={setScore}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />
              </View>
              <Typography variant="title" color="textSecondary">/ {scale}</Typography>
              <Pressable onPress={submit}>
                <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: tint, alignItems: "center", justifyContent: "center" }}>
                  <Papicons name="Plus" size={26} color="#FFFFFF" />
                </View>
              </Pressable>
            </View>
            <View style={{ gap: 6 }}>
              <Typography variant="body2" color="textSecondary">Barème</Typography>
              <ChipRow>
                {SCALES.map(value => (
                  <Chip key={value} label={`/${value}`} selected={scale === value} onPress={() => setScale(value)} color={tint} />
                ))}
              </ChipRow>
            </View>
            <View style={{ gap: 6 }}>
              <Typography variant="body2" color="textSecondary">Coefficient</Typography>
              <ChipRow>
                {COEFFICIENTS.map(value => (
                  <Chip
                    key={value}
                    label={`×${String(value).replace(".", ",")}`}
                    selected={coefficient === value}
                    onPress={() => setCoefficient(value)}
                    color={tint}
                  />
                ))}
              </ChipRow>
            </View>
          </View>
        </List.Section>

        <List.Section>
          <List.SectionTitle>
            <List.Label>Objectif dans la matière</List.Label>
          </List.SectionTitle>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 6 }}>
            <View style={{ width: 120 }}>
              <TextInput placeholder="Ex. 16" value={target} onChangeText={setTarget} keyboardType="decimal-pad" />
            </View>
            <Typography color={required?.color ?? "textSecondary"} variant={required ? "title" : "body1"} style={{ flex: 1 }}>
              {required ? required.text : `de moyenne : la note nécessaire (/${scale}, ×${String(coefficient).replace(".", ",")}) s'affiche ici`}
            </Typography>
          </View>
        </List.Section>

        {sims.length > 0 && (
          <List.Section>
            <List.SectionTitle>
              <List.Label>Notes simulées</List.Label>
            </List.SectionTitle>
            {sims.map(sim => (
              <List.Item key={sim.id}>
                <List.Leading>
                  <Icon>
                    <Papicons name="Sparkles" />
                  </Icon>
                </List.Leading>
                <Typography variant="title">{`${formatScore(sim.score)}/${sim.outOf}`}</Typography>
                <Typography color="textSecondary" variant="body2">{`coef. ${String(sim.coefficient).replace(".", ",")}`}</Typography>
                <List.Trailing>
                  <Pressable onPress={() => remove(sim.id)} hitSlop={10}>
                    <Icon opacity={0.6}>
                      <Papicons name="Trash" />
                    </Icon>
                  </Pressable>
                </List.Trailing>
              </List.Item>
            ))}
          </List.Section>
        )}

        <List.Section>
          <List.SectionTitle>
            <List.Label>Tes notes</List.Label>
          </List.SectionTitle>
          {(subject.grades ?? []).map((grade, index) => {
            const key = gradeKey(grade, index);
            const value = grade.studentScore;
            const usable = Boolean(value && !value.disabled && typeof value.value === "number");
            const counted = !excluded.includes(key);
            return (
              <List.Item key={key}>
                <Typography variant="body1" numberOfLines={1} style={counted ? undefined : { opacity: 0.45 }}>
                  {grade.description || "Note"}
                </Typography>
                <Typography color="textSecondary" variant="body2" style={counted ? undefined : { opacity: 0.45 }}>
                  {[
                    usable && value ? `${formatScore(value.value)}/${grade.outOf?.value ?? 20}` : value?.status ?? "—",
                    `coef. ${grade.coefficient}`,
                    grade.givenAt ? new Date(grade.givenAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null,
                  ].filter(Boolean).join(" · ")}
                </Typography>
                <List.Trailing>
                  <NativeSwitch value={counted} disabled={!usable} onValueChange={() => toggleExcluded(key)} />
                </List.Trailing>
              </List.Item>
            );
          })}
        </List.Section>

        {changed && (
          <List.Section>
            <List.Item onPress={() => resetSubject(subject.id, keys)}>
              <List.Leading>
                <Icon>
                  <Papicons name="Cross" />
                </Icon>
              </List.Leading>
              <Typography variant="title">Réinitialiser cette matière</Typography>
            </List.Item>
          </List.Section>
        )}
      </List>
    </>
  );
}
