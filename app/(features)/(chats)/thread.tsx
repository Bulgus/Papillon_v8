import { Papicons } from "@getpapillon/papicons";
import * as Haptics from "expo-haptics";
import { Stack as ExpoStack, useLocalSearchParams } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getManager } from "@/services/shared";
import { Message } from "@/services/shared/chat";
import { useAccountStore } from "@/stores/account";
import { chatKey, useChatsStore } from "@/stores/chats";
import Avatar from "@/ui/components/Avatar";
import Icon from "@/ui/components/Icon";
import Typography from "@/ui/new/Typography";
import { getProfileColorByName } from "@/utils/chats/colors";
import { getInitials } from "@/utils/chats/initials";
import { formatHTML } from "@/utils/format/html";
import { warn } from "@/utils/logger/logger";

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) {return "Aujourd'hui";}
  if (sameDay(date, yesterday)) {return "Hier";}
  const label = date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function ChatThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const chat = useChatsStore(state => state.chats.find(item => chatKey(item) === id));
  const markRead = useChatsStore(state => state.markRead);
  const refreshChats = useChatsStore(state => state.refresh);

  const account = useAccountStore(state => state.accounts.find(item => item.id === state.lastUsedAccount));
  const myName = `${account?.firstName ?? ""} ${account?.lastName ?? ""}`.trim().toLowerCase();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!chat) {return;}
    const manager = getManager(true);
    if (!manager) {return;}
    try {
      const result = await manager.getChatMessages(chat);
      setMessages([...(result ?? [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
      // Reading the messages marks them as read on Pronote.
      markRead(chatKey(chat));
    } catch (error) {
      warn(`Chat messages: ${String(error)}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [chat, markRead]);

  useEffect(() => {
    load();
    // Only on open: `chat` changes identity when the list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isMine = useCallback(
    (message: Message) => message.isMine ?? (myName.length > 0 && message.author.toLowerCase().includes(myName)),
    [myName]
  );

  const canReply = Boolean(chat?.ref) && !chat?.closed;

  const send = async () => {
    const content = draft.trim();
    if (!chat || !content || sending) {return;}
    setSending(true);
    try {
      await getManager().sendMessageInChat(chat, content);
      setDraft("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Optimistic, then the real thread.
      setMessages(prev => [
        ...prev,
        { id: `local-${Date.now()}`, content, author: "Moi", subject: "", date: new Date(), attachments: [], isMine: true },
      ]);
      await load();
      refreshChats();
    } catch (error) {
      Alert.alert("Message non envoyé", String(error instanceof Error ? error.message : error));
    } finally {
      setSending(false);
    }
  };

  const rows = useMemo(() => {
    const items: Array<{ kind: "day"; key: string; label: string } | { kind: "message"; key: string; message: Message; showAuthor: boolean }> = [];
    let previous: Message | undefined;
    for (const message of messages) {
      const date = new Date(message.date);
      if (!previous || !sameDay(new Date(previous.date), date)) {
        items.push({ kind: "day", key: `day-${date.toDateString()}`, label: dayLabel(date) });
        previous = undefined;
      }
      items.push({
        kind: "message",
        key: message.id || `${date.getTime()}`,
        message,
        showAuthor: !isMine(message) && (!previous || previous.author !== message.author),
      });
      previous = message;
    }
    return items;
  }, [messages, isMine]);

  if (!chat) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: colors.background }}>
        <Typography color="textSecondary" align="center">Discussion introuvable. Reviens à la liste et rafraîchis-la.</Typography>
      </View>
    );
  }

  const accent = String(colors.primary);
  const bubbleOther = dark ? "#2A2A2E" : "#EFEFF2";

  return (
    <>
      <ExpoStack.Screen options={{ headerTitle: chat.subject || "Discussion" }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 16, gap: 6 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          keyboardDismissMode="interactive"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          <View style={{ alignItems: "center", paddingVertical: 8, gap: 2 }}>
            <Typography variant="title" align="center">{chat.subject || "(Sans objet)"}</Typography>
            <Typography variant="caption" color="textSecondary" align="center">
              {[chat.creator, chat.recipient].filter(Boolean).join(" → ")}
            </Typography>
          </View>

          {loading && <ActivityIndicator style={{ marginTop: 24 }} />}

          {!loading && messages.length === 0 && (
            <Typography color="textSecondary" align="center" style={{ marginTop: 24 }}>
              Aucun message à afficher (hors connexion ?).
            </Typography>
          )}

          {rows.map(row => {
            if (row.kind === "day") {
              return (
                <Typography key={row.key} variant="caption" color="textSecondary" align="center" weight="semibold" style={{ marginTop: 12, marginBottom: 4 }}>
                  {row.label}
                </Typography>
              );
            }
            const { message } = row;
            const mine = isMine(message);
            const text = formatHTML(message.content);
            const time = new Date(message.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
            return (
              <View key={row.key} style={{ flexDirection: "row", justifyContent: mine ? "flex-end" : "flex-start", gap: 8, marginTop: row.showAuthor ? 8 : 0 }}>
                {!mine && (
                  <View style={{ width: 30, justifyContent: "flex-end" }}>
                    {row.showAuthor && (
                      <Avatar size={30} color={getProfileColorByName(message.author)} initials={getInitials(message.author)} />
                    )}
                  </View>
                )}
                <View style={{ maxWidth: "80%", gap: 2 }}>
                  {row.showAuthor && (
                    <Typography variant="caption" color="textSecondary" weight="semibold" style={{ marginLeft: 4 }}>
                      {message.author}
                    </Typography>
                  )}
                  <View
                    style={{
                      backgroundColor: mine ? accent : bubbleOther,
                      borderRadius: 20,
                      borderBottomRightRadius: mine ? 6 : 20,
                      borderBottomLeftRadius: mine ? 20 : 6,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      gap: 6,
                    }}
                  >
                    {text.length > 0 && (
                      <Typography selectable variant="body1" color={mine ? "#FFFFFF" : "textPrimary"}>{text}</Typography>
                    )}
                    {message.attachments.map((attachment, index) => (
                      <Pressable
                        key={`${attachment.url}-${index}`}
                        onPress={() => attachment.url && WebBrowser.openBrowserAsync(attachment.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET })}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}
                      >
                        <Icon size={18} fill={mine ? "#FFFFFF" : accent}>
                          <Papicons name="Paper" />
                        </Icon>
                        <Typography variant="body2" weight="semibold" color={mine ? "#FFFFFF" : accent} numberOfLines={1} style={{ flexShrink: 1 }}>
                          {attachment.name || "Pièce jointe"}
                        </Typography>
                      </Pressable>
                    ))}
                    <Typography variant="caption" color={mine ? "#FFFFFFB3" : "textSecondary"} align="right">{time}</Typography>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {canReply ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
              paddingHorizontal: 12,
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 8) + 4,
              borderTopWidth: 1,
              borderTopColor: String(colors.border),
              backgroundColor: colors.background,
            }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Écrire un message…"
              placeholderTextColor={String(colors.text) + "80"}
              multiline
              style={{
                flex: 1,
                maxHeight: 140,
                minHeight: 42,
                borderRadius: 21,
                borderWidth: 1,
                borderColor: String(colors.border),
                backgroundColor: colors.card,
                color: colors.text,
                paddingHorizontal: 16,
                paddingTop: 11,
                paddingBottom: 11,
                fontSize: 16,
              }}
              selectionColor={accent}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim() || sending}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: draft.trim() ? accent : String(colors.text) + "22",
              }}
              accessibilityLabel="Envoyer"
            >
              {sending ? <ActivityIndicator color="#FFFFFF" /> : <Papicons name="ArrowUp" size={22} color="#FFFFFF" />}
            </Pressable>
          </View>
        ) : (
          <View style={{ padding: 14, paddingBottom: Math.max(insets.bottom, 8) + 6, alignItems: "center", borderTopWidth: 1, borderTopColor: String(colors.border) }}>
            <Typography variant="body2" color="textSecondary" align="center">
              {chat.closed ? "Cette discussion est fermée : tu ne peux plus y répondre." : "Réponse indisponible hors connexion."}
            </Typography>
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  );
}
