import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@blockshub/pawnote-lts", () => ({
  TabLocation: { Discussions: 131 },
  EntityKind: { Teacher: 3, Personal: 34 },
  discussions: jest.fn(),
  discussionMessages: jest.fn(),
  discussionRecipients: jest.fn(),
  discussionSendMessage: jest.fn(),
  newDiscussion: jest.fn(),
  newDiscussionRecipients: jest.fn(),
}));
jest.mock("@/services/shared", () => ({ getManager: () => null }));
jest.mock("@/utils/logger/logger", () => ({ error: (message: string) => new Error(message), warn: jest.fn() }));

import * as pawnote from "@blockshub/pawnote-lts";

import {
  fetchPronoteChatMessages,
  fetchPronoteChats,
  fetchPronoteRecipients,
} from "@/services/pronote/chat";
import { Chat } from "@/services/shared/chat";
import { chatKey } from "@/stores/chats";

const mocked = pawnote as unknown as Record<string, jest.Mock<(...args: unknown[]) => Promise<unknown>>>;

const session = (authorizations: Record<string, unknown> = {}) =>
  ({
    user: {
      name: "Aimé",
      // Messaging is never in the resource's tabs: checking them was the bug.
      resources: [{ name: "Aimé C", tabs: new Map() }],
      authorizations: { tabs: [131], canReadDiscussions: true, ...authorizations },
    },
  }) as never;

const discussion = { participantsMessageID: "p1", subject: "Sortie", creator: "M. Dupont", recipientName: "Aimé", date: new Date("2026-11-10"), numberOfMessagesUnread: 2, numberOfMessages: 5, closed: false };

beforeEach(() => {
  Object.values(mocked).forEach(mock => typeof mock?.mockReset === "function" && mock.mockReset());
});

describe("Pronote discussions", () => {
  it("lists discussions with unread counts", async () => {
    mocked.discussions.mockResolvedValue({ items: [discussion] });
    const chats = await fetchPronoteChats(session(), "acc");
    expect(chats[0]).toMatchObject({ id: "p1", subject: "Sortie", creator: "M. Dupont", unread: 2, messageCount: 5, closed: false, createdByAccount: "acc" });
  });

  it("loads messages oldest first and marks the user's own", async () => {
    mocked.discussionMessages.mockResolvedValue({
      sents: [
        { id: "2", content: "Réponse", author: undefined, creationDate: new Date("2026-11-10T11:00:00"), files: [] },
        { id: "1", content: "Bonjour", author: { name: "M. Dupont" }, creationDate: new Date("2026-11-10T10:00:00"), files: [{ kind: 1, name: "doc.pdf", url: "https://x/doc.pdf" }] },
      ],
    });
    const chat: Chat = { id: "p1", subject: "Sortie", date: new Date(), ref: discussion as never, createdByAccount: "acc" };
    const messages = await fetchPronoteChatMessages(session(), "acc", chat);
    expect(messages.map(message => [message.id, message.author, message.isMine])).toEqual([
      ["1", "M. Dupont", false],
      ["2", "Aimé C", true],
    ]);
    expect(messages[0].attachments[0]).toMatchObject({ name: "doc.pdf", url: "https://x/doc.pdf" });
  });

  it("refuses when the school disabled messaging", async () => {
    const chat: Chat = { id: "p1", subject: "", date: new Date(), ref: discussion as never, createdByAccount: "acc" };
    await expect(fetchPronoteChatMessages(session({ tabs: [], canReadDiscussions: false }), "acc", chat)).rejects.toThrow("Discussions are not enabled");
  });

  it("merges teachers and staff, keeping one when the other fails", async () => {
    mocked.newDiscussionRecipients.mockImplementation(async (_session: unknown, kind: unknown) => {
      if (kind === 34) {throw new Error("staff refused");}
      return [
        { id: "t1", name: "DUPONT Jean (Mathématiques)" },
        { id: "t1", name: "DUPONT Jean (Mathématiques)" },
        { id: "t2", name: "MARTIN Anne" },
      ];
    });
    const recipients = await fetchPronoteRecipients(session());
    expect(recipients.map(recipient => [recipient.id, recipient.name, recipient.class])).toEqual([
      ["t1", "DUPONT Jean", "Mathématiques"],
      ["t2", "MARTIN Anne", undefined],
    ]);
  });

  it("only asks for the kinds the school allows, and fails when all fail", async () => {
    mocked.newDiscussionRecipients.mockRejectedValue(new Error("refused"));
    await expect(fetchPronoteRecipients(session({ canDiscussWithStaff: false }))).rejects.toThrow("refused");
    expect(mocked.newDiscussionRecipients).toHaveBeenCalledTimes(1);
  });

  it("keys a discussion stably for navigation", () => {
    const chat: Chat = { id: "p1", subject: "Sortie", date: new Date("2026-11-10T10:00:00Z"), createdByAccount: "acc" };
    expect(chatKey(chat)).toBe(`acc:p1:${new Date("2026-11-10T10:00:00Z").getTime()}`);
    expect(chatKey({ ...chat, id: "" })).toContain("acc:Sortie:");
  });
});
