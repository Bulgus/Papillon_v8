import {
  discussionMessages,
  discussionRecipients,
  discussions,
  discussionSendMessage,
  EntityKind,
  newDiscussion,
  NewDiscussionRecipient,
  newDiscussionRecipients,
  SessionHandle,
  TabLocation,
} from "@blockshub/pawnote-lts";

import { Chat, Message, Recipient } from "@/services/shared/chat";
import { error } from "@/utils/logger/logger";

/**
 * Messaging is an account-level tab: it is listed in the user's
 * authorizations, never in a resource's `tabs` (those only hold the tabs with
 * periods, like grades). Checking `resources[0].tabs` always failed, so
 * messages, replies and recipients never loaded.
 */
function assertDiscussionsAvailable(session: SessionHandle) {
  const authorizations = session.user?.authorizations;
  if (authorizations && !authorizations.tabs.includes(TabLocation.Discussions) && !authorizations.canReadDiscussions) {
    throw error("Discussions are not enabled for this account", "assertDiscussionsAvailable");
  }
}

export async function fetchPronoteChats(
  session: SessionHandle,
  accountId: string
): Promise<Chat[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteChats");
  }

  const chats = await discussions(session);
  return chats.items.map(chat => ({
    id: chat.participantsMessageID,
    subject: chat.subject,
    creator: chat.creator,
    recipient: chat.recipientName,
    date: chat.date,
    unread: chat.numberOfMessagesUnread,
    messageCount: chat.numberOfMessages,
    closed: chat.closed,
    ref: chat,
    createdByAccount: accountId,
  }));
}

export async function fetchPronoteChatRecipients(
  session: SessionHandle,
  chat: Chat
): Promise<Recipient[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteChatRecipients");
  }

  assertDiscussionsAvailable(session);

  if (!chat.ref) {
    throw error("Chat reference is undefined", "fetchPronoteChatRecipients");
  }

  if (!('participantsMessageID' in chat.ref)) {
    throw error("Chat reference is not a Discussion type", "fetchPronoteChatRecipients");
  }

  const recipients = await discussionRecipients(session, chat.ref);
  return recipients.map((recipient) => {
    const [namePart, classPart] = recipient.name.split("(");

    return {
      id: recipient.id,
      name: namePart.trim(),
      class: classPart ? classPart.replace(")", "").trim() : undefined
    };
  });
}

export async function fetchPronoteChatMessages(
  session: SessionHandle,
  accountId: string,
  chat: Chat
): Promise<Message[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteChatMessages");
  }

  assertDiscussionsAvailable(session);

  if (!chat.ref) {
    throw error("Chat reference is undefined", "fetchPronoteChatMessages");
  }

  if (!('participantsMessageID' in chat.ref)) {
    throw error("Chat reference is not a Discussion type", "fetchPronoteChatRecipients");
  }

  const messages = await discussionMessages(session, chat.ref, true)
  const studentName = session.user.resources[0].name;

  return messages.sents.map((message) => {
    return {
      id: message.id,
      subject: "",
      content: message.content,
      author: message.author?.name ?? studentName,
      // No author: the user wrote it.
      isMine: !message.author,
      date: message.creationDate,
      attachments: message.files.map((attachment) => ({
        type: attachment.kind,
        name: attachment.name,
        url: attachment.url,
        createdByAccount: accountId,
      }))
    };
  }).sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function sendPronoteMessageInChat(
  session: SessionHandle,
  chat: Chat,
  content: string
): Promise<void> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteChatMessages");
  }

  assertDiscussionsAvailable(session);

  if (!chat.ref) {
    throw error("Chat reference is undefined", "fetchPronoteChatMessages");
  }

  if (!('participantsMessageID' in chat.ref)) {
    throw error("Chat reference is not a Discussion type", "fetchPronoteChatRecipients");
  }

  await discussionSendMessage(session, chat.ref, content)
}

export async function fetchPronoteRecipients(
  session: SessionHandle,
): Promise<Recipient[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteChatMessages");
  }

  assertDiscussionsAvailable(session);

  // Teachers and school staff are fetched separately: the school may allow
  // one and not the other, and one refusal must not empty the whole list.
  const authorizations = session.user?.authorizations;
  const kinds = [
    ...(authorizations?.canDiscussWithTeachers === false ? [] : [EntityKind.Teacher]),
    ...(authorizations?.canDiscussWithStaff === false ? [] : [EntityKind.Personal]),
  ];
  const settled = await Promise.allSettled(kinds.map(kind => newDiscussionRecipients(session, kind)));
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length === settled.length && failures.length > 0) {
    throw failures[0].reason;
  }
  const seen = new Set<string>();
  const recipients = settled
    .flatMap(result => (result.status === "fulfilled" ? result.value : []))
    .filter(recipient => (seen.has(recipient.id) ? false : (seen.add(recipient.id), true)));

  return recipients.map((recipient) => {
    const [namePart, classPart] = recipient.name.split("(");

    return {
      id: recipient.id,
      name: namePart.trim(),
      class: classPart ? classPart.replace(")", "").trim() : undefined,
      ref: recipient
    };
  });
}

export async function createPronoteMail(session: SessionHandle, accountId: string, subject: string, content: string, recipients: Recipient[]): Promise<Chat> {
  await newDiscussion(session, subject, content, sharedToPronoteRecipient(recipients))
  return {
    id: "",
    subject: subject,
    recipient: recipients.map(r => r.name).join(", "),
    creator: session.user.name,
    date: new Date(),
    createdByAccount: accountId
  }
}

function sharedToPronoteRecipient(recipients: Recipient[]): NewDiscussionRecipient[] {
  return recipients.map(recipient => recipient.ref).filter((ref): ref is NewDiscussionRecipient => ref !== undefined);
}