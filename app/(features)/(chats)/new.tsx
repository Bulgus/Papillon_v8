import { Papicons } from "@getpapillon/papicons";
import * as Haptics from "expo-haptics";
import { router, Stack as ExpoStack } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, TextInput, View } from "react-native";

import { getManager } from "@/services/shared";
import { Recipient } from "@/services/shared/chat";
import { Capabilities } from "@/services/shared/types";
import { useChatsStore } from "@/stores/chats";
import Avatar from "@/ui/components/Avatar";
import Icon from "@/ui/components/Icon";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { getProfileColorByName } from "@/utils/chats/colors";
import { getInitials } from "@/utils/chats/initials";
import { warn } from "@/utils/logger/logger";

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function NewChat() {
  const { colors } = useTheme();
  const refreshChats = useChatsStore(state => state.refresh);

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getManager(true)
      ?.getRecipientsAvailableForNewChat()
      .then(list => {
        const unique = new Map<string, Recipient>();
        for (const recipient of list ?? []) {unique.set(recipient.id, recipient);}
        setRecipients([...unique.values()].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(error => warn(`Recipients: ${String(error)}`))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    return term ? recipients.filter(recipient => normalize(`${recipient.name} ${recipient.class ?? ""}`).includes(term)) : recipients;
  }, [recipients, search]);

  const chosen = recipients.filter(recipient => selected.includes(recipient.id));
  const canSend = chosen.length > 0 && subject.trim().length > 0 && content.trim().length > 0 && !sending;

  const toggle = (id: string) => {
    Haptics.selectionAsync();
    setSelected(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  };

  const send = async () => {
    if (!canSend) {return;}
    const manager = getManager(true);
    const client = manager?.getAvailableClients(Capabilities.CHAT_CREATE)[0] as { accountId?: string } | undefined;
    if (!manager || !client?.accountId) {
      Alert.alert("Discussions", "La messagerie n'est pas disponible pour le moment.");
      return;
    }
    setSending(true);
    try {
      await manager.createMail(client.accountId, subject.trim(), content.trim(), chosen);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshChats();
      router.back();
    } catch (error) {
      Alert.alert("Message non envoyé", String(error instanceof Error ? error.message : error));
    } finally {
      setSending(false);
    }
  };

  const inputStyle = {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: String(colors.border),
    backgroundColor: colors.card,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  } as const;

  return (
    <>
      <ExpoStack.Screen
        options={{
          headerTitle: "Nouvelle discussion",
          headerRight: () => (
            <Pressable onPress={send} disabled={!canSend} hitSlop={10} accessibilityLabel="Envoyer">
              {sending ? (
                <ActivityIndicator />
              ) : (
                <Typography variant="title" color={canSend ? String(colors.primary) : "textSecondary"}>Envoyer</Typography>
              )}
            </Pressable>
          ),
        }}
      />
      <List
        contentInsetAdjustmentBehavior="automatic"
        safeHorizontalPadding={16}
        contentContainerStyle={{ paddingVertical: 16 }}
        style={{ flex: 1, backgroundColor: colors.overground }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <List.Section>
          <List.SectionTitle>
            <List.Label>Message</List.Label>
          </List.SectionTitle>
          <View style={{ gap: 10, paddingVertical: 4 }}>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Objet"
              placeholderTextColor={String(colors.text) + "80"}
              style={inputStyle}
              selectionColor={String(colors.primary)}
            />
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder="Ton message…"
              placeholderTextColor={String(colors.text) + "80"}
              multiline
              textAlignVertical="top"
              style={{ ...inputStyle, minHeight: 130 }}
              selectionColor={String(colors.primary)}
            />
          </View>
        </List.Section>

        <List.Section>
          <List.SectionTitle>
            <List.Label>{chosen.length ? `Destinataires · ${chosen.length}` : "Destinataires"}</List.Label>
          </List.SectionTitle>
          <View style={{ paddingVertical: 4, gap: 10 }}>
            {chosen.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {chosen.map(recipient => (
                  <Pressable
                    key={recipient.id}
                    onPress={() => toggle(recipient.id)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, backgroundColor: String(colors.primary) + "22" }}
                  >
                    <Typography variant="body2" weight="semibold" color={String(colors.primary)}>{recipient.name}</Typography>
                    <Papicons name="Cross" size={14} color={String(colors.primary)} />
                  </Pressable>
                ))}
              </View>
            )}
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher un professeur, la vie scolaire…"
              placeholderTextColor={String(colors.text) + "80"}
              style={inputStyle}
              autoCorrect={false}
            />
          </View>
        </List.Section>

        <List.Section>
          {loading && (
            <View style={{ padding: 24 }}>
              <ActivityIndicator />
            </View>
          )}
          {!loading && filtered.length === 0 && (
            <List.Item>
              <Typography color="textSecondary">
                {recipients.length === 0 ? "Aucun destinataire disponible (hors connexion ?)." : "Aucun résultat."}
              </Typography>
            </List.Item>
          )}
          {filtered.slice(0, 200).map(recipient => {
            const isSelected = selected.includes(recipient.id);
            return (
              <List.Item key={recipient.id} onPress={() => toggle(recipient.id)}>
                <List.Leading>
                  <Avatar size={36} color={getProfileColorByName(recipient.name)} initials={getInitials(recipient.name)} />
                </List.Leading>
                <Typography variant="title" numberOfLines={1}>{recipient.name}</Typography>
                {recipient.class ? (
                  <Typography variant="body2" color="textSecondary" numberOfLines={1}>{recipient.class}</Typography>
                ) : null}
                <List.Trailing>
                  {isSelected ? (
                    <Icon fill={String(colors.primary)}>
                      <Papicons name="Check" />
                    </Icon>
                  ) : null}
                </List.Trailing>
              </List.Item>
            );
          })}
        </List.Section>
      </List>
    </>
  );
}
