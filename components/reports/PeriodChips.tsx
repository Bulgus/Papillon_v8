import * as Haptics from "expo-haptics";
import { useTheme } from "expo-router/react-navigation";
import React from "react";
import { Pressable, ScrollView } from "react-native";

import { Period } from "@/services/shared/grade";
import Typography from "@/ui/new/Typography";

export const periodId = (period: Period) => `${period.createdByAccount}:${period.id ?? period.name}`;

export default function PeriodChips({
  periods,
  selected,
  onSelect,
}: {
  periods: Period[];
  selected?: Period;
  onSelect: (period: Period) => void;
}) {
  const { colors } = useTheme();
  if (periods.length < 2) {return null;}
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
      {periods.map(period => {
        const active = selected && periodId(selected) === periodId(period);
        return (
          <Pressable
            key={periodId(period)}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(period);
            }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 100,
              backgroundColor: active ? String(colors.primary) : String(colors.text) + "12",
            }}
          >
            <Typography variant="body2" weight="semibold" color={active ? "#FFFFFF" : "textPrimary"}>
              {period.name}
            </Typography>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
