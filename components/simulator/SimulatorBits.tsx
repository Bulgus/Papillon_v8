import { useTheme } from "expo-router/react-navigation";
import React from "react";
import { Pressable, View } from "react-native";

import Typography from "@/ui/new/Typography";
import { formatAverage, RequiredScore } from "@/utils/grades/simulator";

export const GREEN = "#1A9E5B";
export const RED = "#D60046";

/** "+0,42" / "−0,10" pill, nothing when unchanged. */
export function DeltaPill({ before, after, size = "small" }: { before: number; after: number; size?: "small" | "large" }) {
  if (before < 0 || after < 0) {return null;}
  const diff = after - before;
  if (Math.abs(diff) < 0.005) {return null;}
  const color = diff > 0 ? GREEN : RED;
  return (
    <View
      style={{
        backgroundColor: color + "1F",
        borderRadius: 100,
        paddingHorizontal: size === "large" ? 12 : 8,
        paddingVertical: size === "large" ? 4 : 2,
        alignSelf: "flex-start",
      }}
    >
      <Typography variant={size === "large" ? "title" : "body2"} weight="semibold" color={color}>
        {diff > 0 ? "+" : "−"}{formatAverage(Math.abs(diff))}
      </Typography>
    </View>
  );
}

/** Small selectable pill, used for scales and coefficients. */
export function Chip({ label, selected, onPress, color }: { label: string; selected: boolean; onPress: () => void; color: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 100,
        borderWidth: 1,
        borderColor: selected ? color : String(colors.text) + "22",
        backgroundColor: selected ? color + "22" : "transparent",
      }}
    >
      <Typography variant="body2" weight="semibold" color={selected ? color : "textSecondary"}>
        {label}
      </Typography>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

export function describeRequired(result: RequiredScore, outOf: number): { text: string; color?: string } {
  switch (result.kind) {
    case "reached":
      return { text: "Déjà atteint, même avec 0", color: GREEN };
    case "impossible":
      return { text: `Impossible avec une seule note (au mieux ${formatAverage(result.best)})`, color: RED };
    case "needed":
      return { text: `Il te faut au moins ${formatAverage(result.score).replace(/,00$/, "")}/${outOf}` };
  }
}

/** Big average with its change, for the top of the simulator screens. */
export function AverageHero({
  label,
  before,
  after,
  tint,
  caption,
}: {
  label: string;
  before: number;
  after: number;
  tint: string;
  caption?: string;
}) {
  const changed = before >= 0 && after >= 0 && Math.abs(after - before) >= 0.005;
  return (
    <View style={{ alignItems: "center", gap: 6, paddingVertical: 18 }}>
      <Typography variant="body1" color="textSecondary" weight="semibold">{label}</Typography>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
        <Typography variant="h1" color={tint} style={{ fontSize: 56, lineHeight: 62 }}>
          {formatAverage(after)}
        </Typography>
        <Typography variant="title" color="textSecondary" style={{ marginBottom: 10 }}>/20</Typography>
      </View>
      {changed ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Typography color="textSecondary">au lieu de {formatAverage(before)}</Typography>
          <DeltaPill before={before} after={after} size="large" />
        </View>
      ) : (
        caption ? <Typography color="textSecondary" align="center">{caption}</Typography> : null
      )}
    </View>
  );
}
