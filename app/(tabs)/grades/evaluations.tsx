import { Stack as ExpoStack } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, View } from "react-native";

import PeriodChips from "@/components/reports/PeriodChips";
import { useReportPeriods } from "@/hooks/useReportPeriods";
import { getManager } from "@/services/shared";
import { SkillEvaluation } from "@/services/shared/evaluation";
import { Capabilities } from "@/services/shared/types";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { groupBySubject, LEVELS, skillLevel, summarizeSkills } from "@/utils/evaluations/levels";
import { warn } from "@/utils/logger/logger";
import { getSubjectEmoji } from "@/utils/subjects/emoji";
import { getSubjectName } from "@/utils/subjects/name";

const SCORES = [4, 3, 2, 1] as const;

function LevelPill({ abbreviation, level }: { abbreviation: string; level: string }) {
  const { color } = skillLevel({ abbreviation, level });
  return (
    <View style={{ minWidth: 34, paddingHorizontal: 8, height: 26, borderRadius: 13, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Typography variant="body2" weight="bold" color="#FFFFFF">{abbreviation || "–"}</Typography>
    </View>
  );
}

/** Rows of one evaluation; a function: the List only reads its direct items. */
function evaluationRows(evaluation: SkillEvaluation) {
  const date = new Date(evaluation.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return [
    <List.Item key={`${evaluation.id}-title`}>
      <Typography variant="title">{evaluation.name || "Évaluation"}</Typography>
      <Typography variant="body2" color="textSecondary">
        {[date, evaluation.teacher, evaluation.coefficient && evaluation.coefficient !== 1 ? `coef. ${evaluation.coefficient}` : ""].filter(Boolean).join(" · ")}
      </Typography>
      {evaluation.description ? (
        <Typography variant="body2" color="textSecondary">{evaluation.description}</Typography>
      ) : null}
    </List.Item>,
    ...evaluation.skills.map(skill => (
      <List.Item key={`${evaluation.id}-${skill.id}-${skill.order}`}>
        <List.Leading>
          <LevelPill abbreviation={skill.abbreviation} level={skill.level} />
        </List.Leading>
        <Typography variant="body1">{skill.name}</Typography>
        <Typography variant="caption" color="textSecondary">
          {[skillLevel(skill).label, skill.domain].filter(Boolean).join(" · ")}
        </Typography>
      </List.Item>
    )),
  ];
}

export default function EvaluationsScreen() {
  const { colors } = useTheme();
  const { periods, selected, setSelected, supported, loaded } = useReportPeriods(Capabilities.EVALUATIONS);
  const [evaluations, setEvaluations] = useState<SkillEvaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const manager = getManager(true);
    if (!manager || !selected) {return;}
    setLoading(true);
    try {
      const list = await manager.getEvaluations(selected, selected.createdByAccount);
      setEvaluations(list);
      const failure = manager.getFailures(Capabilities.EVALUATIONS)[0];
      setLoadError(list.length === 0 && failure ? String(failure.reason instanceof Error ? failure.reason.message : failure.reason) : null);
    } catch (error) {
      warn(`Evaluations: ${String(error)}`);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selected]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => summarizeSkills(evaluations), [evaluations]);
  const groups = useMemo(() => groupBySubject(evaluations), [evaluations]);

  return (
    <>
      <ExpoStack.Screen options={{ headerTitle: "Compétences" }} />
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        contentContainerStyle={{ paddingVertical: 12 }}
        style={{ flex: 1, backgroundColor: colors.overground }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={<PeriodChips periods={periods} selected={selected} onSelect={setSelected} />}
      >
        {(loading || !loaded) && evaluations.length === 0 && (
          <View style={{ padding: 40 }}>
            <ActivityIndicator />
          </View>
        )}

        {loaded && !loading && evaluations.length === 0 && (
          <View style={{ padding: 32, alignItems: "center", gap: 6 }}>
            <Typography style={{ fontSize: 40 }}>🎯</Typography>
            <Typography variant="title" align="center">
              {!supported ? "Compétences indisponibles" : loadError ? "Impossible de charger les compétences" : "Aucune compétence évaluée"}
            </Typography>
            <Typography color="textSecondary" align="center">
              {!supported
                ? "Ton établissement n'évalue pas par compétences sur ton service scolaire."
                : loadError ?? "Rien sur cette période pour l'instant."}
            </Typography>
          </View>
        )}

        {summary.assessed > 0 && (
          <List.Section>
            <List.SectionTitle>
              <List.Label>Bilan de la période</List.Label>
            </List.SectionTitle>
            <List.Item>
              <Typography variant="h4">{summary.mastery !== null ? `${summary.mastery} % de maîtrise` : "—"}</Typography>
              <Typography variant="body2" color="textSecondary">{`${summary.assessed} compétence${summary.assessed > 1 ? "s" : ""} évaluée${summary.assessed > 1 ? "s" : ""}`}</Typography>
              <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", marginTop: 8 }}>
                {SCORES.map(score => summary.counts[score] > 0 && (
                  <View key={score} style={{ flex: summary.counts[score], backgroundColor: LEVELS[score].color }} />
                ))}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                {SCORES.map(score => {
                  const level = LEVELS[score];
                  return (
                    <View key={score} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: level.color }} />
                      <Typography variant="caption" color="textSecondary">{`${level.label} · ${summary.counts[score]}`}</Typography>
                    </View>
                  );
                })}
              </View>
            </List.Item>
          </List.Section>
        )}

        {groups.map(group => (
          <List.Section key={group.subject}>
            <List.SectionTitle>
              <List.Label>
                {`${getSubjectEmoji(group.subject)} ${getSubjectName(group.subject)}`}
              </List.Label>
            </List.SectionTitle>
            {group.evaluations.flatMap(evaluationRows)}
          </List.Section>
        ))}
      </List>
    </>
  );
}
