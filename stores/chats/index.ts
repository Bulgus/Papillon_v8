import { create } from "zustand";

import { getManager } from "@/services/shared";
import { Chat } from "@/services/shared/chat";
import { Capabilities } from "@/services/shared/types";
import { warn } from "@/utils/logger/logger";

/**
 * Discussions of the current account. Kept in memory because a Pronote
 * discussion carries a live reference (needed to read and reply) that can
 * not go through navigation params or the database.
 */
interface ChatsState {
  chats: Chat[];
  loading: boolean;
  loaded: boolean;
  supported: boolean;
  error?: string;
  refresh: () => Promise<void>;
  markRead: (id: string) => void;
}

export const chatKey = (chat: Chat) => `${chat.createdByAccount}:${chat.id || chat.subject}:${new Date(chat.date).getTime()}`;

export const useChatsStore = create<ChatsState>()((set, get) => ({
  chats: [],
  loading: false,
  loaded: false,
  supported: true,

  refresh: async () => {
    if (get().loading) {return;}
    const manager = getManager(true);
    if (!manager) {return;}
    set({ loading: true });
    try {
      const supported = manager.getAvailableClients(Capabilities.CHAT_READ).length > 0;
      const chats = await manager.getChats();
      set({
        chats: [...(chats ?? [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        loaded: true,
        supported: supported || (chats?.length ?? 0) > 0,
        error: undefined,
      });
    } catch (error) {
      warn(`Chats refresh failed: ${String(error)}`);
      set({ error: error instanceof Error ? error.message : String(error), loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  markRead: id =>
    set(state => ({
      chats: state.chats.map(chat => (chatKey(chat) === id ? { ...chat, unread: 0 } : chat)),
    })),
}));

export const unreadChatsCount = (chats: Chat[]) => chats.reduce((total, chat) => total + (chat.unread ? 1 : 0), 0);
