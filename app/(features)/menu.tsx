import { Papicons } from "@getpapillon/papicons";
import { Stack as ExpoStack } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";

import { getManager } from "@/services/shared";
import { CanteenMenu, Food, Meal } from "@/services/shared/canteen";
import { Capabilities } from "@/services/shared/types";
import { useManagerSubscription } from "@/hooks/useManagerSubscription";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import Icon from "@/ui/components/Icon";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { warn } from "@/utils/logger/logger";

const CATEGORIES: Array<{ key: keyof Meal; label: string; emoji: string }> = [
  { key: "entry", label: "Entrée", emoji: "🥗" },
  { key: "main", label: "Plat", emoji: "🍽️" },
  { key: "side", label: "Accompagnement", emoji: "🥔" },
  { key: "cheese", label: "Fromage", emoji: "🧀" },
  { key: "dessert", label: "Dessert", emoji: "🍰" },
  { key: "drink", label: "Boisson", emoji: "🥤" },
];

/** Monday of the week; on Saturday and Sunday, next week's. */
function weekStart(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  const offset = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  result.setDate(result.getDate() + offset);
  return result;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const hasFood = (meal?: Meal) => Boolean(meal && CATEGORIES.some(category => (meal[category.key]?.length ?? 0) > 0));

/** Rows of a meal; a function, not a component: the List only reads its direct items. */
function mealRows(meal: Meal, prefix: string) {
  return CATEGORIES.filter(category => (meal[category.key]?.length ?? 0) > 0).map(category => {
        const foods = meal[category.key] as Food[];
        const allergens = [...new Set(foods.flatMap(food => food.allergens ?? []))];
        return (
          <List.Item key={`${prefix}-${category.key}`}>
            <List.Leading>
              <Typography style={{ fontSize: 22 }}>{category.emoji}</Typography>
            </List.Leading>
            <Typography variant="body2" color="textSecondary">{category.label}</Typography>
            <Typography variant="title">{foods.map(food => food.name).join("\n")}</Typography>
            {allergens.length > 0 && (
              <Typography variant="caption" color="textSecondary">{`Allergènes : ${allergens.join(", ")}`}</Typography>
            )}
          </List.Item>
        );
  });
}

export default function CanteenMenuScreen() {
  const { colors } = useTheme();
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [menus, setMenus] = useState<CanteenMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [supported, setSupported] = useState(true);
  const [managerVersion, setManagerVersion] = useState(0);

  useManagerSubscription(useCallback(() => setManagerVersion(value => value + 1), []));

  const load = useCallback(async (isRefresh = false) => {
    const manager = getManager(true);
    if (!manager) {return;}
    if (isRefresh) {setRefreshing(true);} else {setLoading(true);}
    try {
      setSupported(manager.getAvailableClients(Capabilities.CANTEEN_MENU).length > 0);
      const result = await manager.getWeeklyCanteenMenu(start);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      setMenus(
        (result ?? [])
          .filter(menu => {
            const date = new Date(menu.date);
            return date >= start && date < end;
          })
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      );
    } catch (error) {
      warn(`Canteen menu: ${String(error)}`);
      setMenus([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [start]);

  useEffect(() => {
    load();
  }, [load, managerVersion]);

  const shift = (weeks: number) => {
    const next = new Date(start);
    next.setDate(next.getDate() + 7 * weeks);
    setStart(next);
  };

  const days = useMemo(() => menus.filter(menu => hasFood(menu.lunch) || hasFood(menu.dinner)), [menus]);
  const today = new Date();
  const friday = new Date(start);
  friday.setDate(friday.getDate() + 4);
  const weekLabel = `Du ${start.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} au ${friday.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;

  return (
    <>
      <ExpoStack.Screen options={{ headerTitle: "Menu de la cantine" }} />
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        contentContainerStyle={{ paddingVertical: 12 }}
        style={{ flex: 1, backgroundColor: colors.overground }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        ListHeaderComponent={
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8 }}>
            <Pressable onPress={() => shift(-1)} hitSlop={12} accessibilityLabel="Semaine précédente">
              <Icon>
                <Papicons name="ChevronLeft" />
              </Icon>
            </Pressable>
            <Typography variant="title" align="center">{weekLabel}</Typography>
            <Pressable onPress={() => shift(1)} hitSlop={12} accessibilityLabel="Semaine suivante">
              <Icon>
                <Papicons name="ChevronRight" />
              </Icon>
            </Pressable>
          </View>
        }
      >
        {loading && (
          <View style={{ padding: 40 }}>
            <ActivityIndicator />
          </View>
        )}

        {!loading && days.length === 0 && (
          <View style={{ padding: 32, alignItems: "center", gap: 6 }}>
            <Typography style={{ fontSize: 40 }}>🍽️</Typography>
            <Typography variant="title" align="center">
              {supported ? "Pas de menu cette semaine" : "Menu indisponible"}
            </Typography>
            <Typography color="textSecondary" align="center">
              {supported
                ? "Ton établissement n'a pas (encore) publié le menu de cette semaine."
                : "Ton établissement ne publie pas le menu de la cantine sur ton service scolaire."}
            </Typography>
          </View>
        )}

        {days.map(menu => {
          const date = new Date(menu.date);
          const isToday = sameDay(date, today);
          const title = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
          return (
            <List.Section key={date.toISOString()}>
              <List.SectionTitle>
                <List.Label>{isToday ? `Aujourd'hui · ${title}` : title.charAt(0).toUpperCase() + title.slice(1)}</List.Label>
              </List.SectionTitle>
              {hasFood(menu.lunch) && menu.lunch && mealRows(menu.lunch, "lunch")}
              {hasFood(menu.dinner) && menu.dinner && (
                <List.Item key="dinner-title">
                  <Typography variant="body2" color="textSecondary" weight="semibold">Dîner</Typography>
                </List.Item>
              )}
              {hasFood(menu.dinner) && menu.dinner && mealRows(menu.dinner, "dinner")}
            </List.Section>
          );
        })}
      </List>
    </>
  );
}
