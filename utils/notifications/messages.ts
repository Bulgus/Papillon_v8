import type { Chat } from "@/services/shared/chat";

/**
 * Identity of a discussion's state across sessions: Pronote ids change at
 * each login, but a new message raises the count (or moves the date).
 */
export const chatNotificationKey = (chat: Chat) =>
  [chat.subject, chat.creator ?? "", chat.messageCount ?? new Date(chat.date).getTime()].join("|");

/** Discussions with unread messages that were not notified yet. */
export function freshUnreadChats(chats: Chat[], seen: Iterable<string>): Chat[] {
  const known = new Set(seen);
  return chats.filter(chat => (chat.unread ?? 0) > 0 && !known.has(chatNotificationKey(chat)));
}

export function messageNotification(fresh: Chat[]): { title: string; body: string } | null {
  if (fresh.length === 0) {return null;}
  if (fresh.length === 1) {
    const chat = fresh[0];
    const count = chat.unread ?? 1;
    return {
      title: `${count > 1 ? `${count} nouveaux messages` : "Nouveau message"}${chat.creator ? ` de ${chat.creator}` : ""}`,
      body: chat.subject || "(Sans objet)",
    };
  }
  const total = fresh.reduce((sum, chat) => sum + (chat.unread ?? 1), 0);
  const people = [...new Set(fresh.map(chat => chat.creator).filter(Boolean))];
  return {
    title: `${total} nouveaux messages`,
    body: people.length ? people.slice(0, 3).join(", ") + (people.length > 3 ? "…" : "") : `${fresh.length} discussions`,
  };
}
