import { Papicons } from "@getpapillon/papicons";
import { router } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useManagerSubscription } from "@/hooks/useManagerSubscription";
import { chatKey, useChatsStore } from "@/stores/chats";
import Avatar from "@/ui/components/Avatar";
import ChipButton from "@/ui/components/ChipButton";
import Icon from "@/ui/components/Icon";
import MainTabErrorBoundary from "@/ui/components/MainTabErrorBoundary";
import SafeHorizontalView from "@/ui/components/SafeHorizontalView";
import Search from "@/ui/components/Search";
import Stack from "@/ui/components/Stack";
import TabHeader from "@/ui/components/TabHeader";
import TabHeaderTitle from "@/ui/components/TabHeaderTitle";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { getProfileColorByName } from "@/utils/chats/colors";
import { getInitials } from "@/utils/chats/initials";

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Today: 14:32 · this week: "mar." · older: 12 oct. */
export function formatChatDate(input: Date): string {
  const date = new Date(input);
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (date >= startOfToday) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  const days = (startOfToday.getTime() - date.getTime()) / 86400000;
  if (days < 6) {
    return date.toLocaleDateString("fr-FR", { weekday: "short" });
  }
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

const ChatsView = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [search, setSearch] = useState("");
  const [manualRefresh, setManualRefresh] = useState(false);

  const { chats, loading, loaded, supported, error, refresh } = useChatsStore();

  useManagerSubscription(useCallback(() => {
    refresh();
  }, [refresh]));

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    if (!term) {return chats;}
    return chats.filter(chat =>
      [chat.subject, chat.creator, chat.recipient].some(value => value && normalize(value).includes(term))
    );
  }, [chats, search]);

  const unread = chats.filter(chat => (chat.unread ?? 0) > 0).length;

  return (
    <>
      <TabHeader
        showAndroidBackButton
        modal
        onHeightChanged={setHeaderHeight}
        title={
          <TabHeaderTitle
            color={String(colors.primary)}
            leading="Discussions"
            subtitle={unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : undefined}
            chevron={false}
            loading={loading}
          />
        }
        bottom={<Search placeholder="Rechercher une discussion" color="#7A4DD6" onTextChange={setSearch} />}
        trailing={
          <Stack direction="horizontal" gap={8}>
            {supported && (
              <ChipButton single icon="pen" onPress={() => router.push("/(features)/(chats)/new")} />
            )}
            {Platform.OS === "ios" && <ChipButton single icon="cross" onPress={() => router.dismiss()} />}
          </Stack>
        }
      />

      <List
        style={{ flex: 1, backgroundColor: colors.overground }}
        safeHorizontalPadding={16}
        contentContainerStyle={{
          paddingTop: headerHeight,
          paddingBottom: insets.bottom + 16,
        }}
        scrollIndicatorInsets={{ top: headerHeight - insets.top }}
        refreshControl={
          <RefreshControl
            refreshing={manualRefresh}
            progressViewOffset={headerHeight}
            onRefresh={async () => {
              setManualRefresh(true);
              await refresh();
              setManualRefresh(false);
            }}
          />
        }
        ListEmptyComponent={
          loaded ? (
            <SafeHorizontalView base={16} style={{ width: "100%" }}>
              <Stack hAlign="center" vAlign="center" flex style={{ width: "100%", marginTop: 24, gap: 4 }}>
                <Icon opacity={0.5} size={32}>
                  <Papicons name={search ? "Search" : "TextBubble"} />
                </Icon>
                <Typography variant="h4" align="center">
                  {search ? "Aucun résultat" : supported ? "Aucune discussion" : "Discussions indisponibles"}
                </Typography>
                <Typography variant="body2" color="textSecondary" align="center">
                  {search
                    ? "Aucune discussion ne correspond à ta recherche."
                    : supported
                      ? error ?? "Tes échanges avec tes professeurs et la vie scolaire apparaîtront ici."
                      : "Ton établissement n'a pas activé la messagerie sur ton service scolaire."}
                </Typography>
              </Stack>
            </SafeHorizontalView>
          ) : null
        }
      >
        {filtered.length > 0 && (
          <List.Section>
            {filtered.map(chat => {
              const person = chat.creator || chat.recipient || "Discussion";
              const hasUnread = (chat.unread ?? 0) > 0;
              const key = chatKey(chat);
              return (
                <List.Item
                  key={key}
                  id={key}
                  onPress={() => router.push({ pathname: "/(features)/(chats)/thread", params: { id: key } })}
                >
                  <List.Leading>
                    <Avatar size={40} color={getProfileColorByName(person)} initials={getInitials(person)} />
                  </List.Leading>
                  <Typography variant="title" weight={hasUnread ? "bold" : undefined} numberOfLines={2}>
                    {chat.subject || "(Sans objet)"}
                  </Typography>
                  <Typography variant="body1" color="textSecondary" numberOfLines={1}>
                    {[chat.creator, chat.recipient].filter(Boolean).join(" → ") || "—"}
                  </Typography>
                  <List.Trailing>
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      <Typography variant="caption" color={hasUnread ? colors.primary : "textSecondary"} weight="medium">
                        {formatChatDate(chat.date)}
                      </Typography>
                      {hasUnread ? (
                        <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: String(colors.primary), alignItems: "center", justifyContent: "center" }}>
                          <Typography variant="caption" color="#FFFFFF" weight="bold">{String(chat.unread)}</Typography>
                        </View>
                      ) : chat.closed ? (
                        <Icon size={16} opacity={0.4}>
                          <Papicons name="Lock" />
                        </Icon>
                      ) : null}
                    </View>
                  </List.Trailing>
                </List.Item>
              );
            })}
          </List.Section>
        )}
      </List>
    </>
  );
};

export default function ChatsScreen() {
  return (
    <MainTabErrorBoundary>
      <ChatsView />
    </MainTabErrorBoundary>
  );
}
