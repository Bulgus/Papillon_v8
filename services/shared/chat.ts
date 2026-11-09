import { Discussion, NewDiscussionRecipient } from "@blockshub/pawnote-lts";
import { Mail, Recipients } from "skolengojs";

import { Attachment } from "@/services/shared/attachment";
import { GenericInterface } from "@/services/shared/types";

export interface Chat extends GenericInterface {
  id: string;
  subject: string;
  recipient?: string;
  creator?: string;
  date: Date;
  /** Unread messages, when the service says. */
  unread?: number;
  messageCount?: number;
  /** No reply possible (closed by the school). */
  closed?: boolean;
  ref?: Discussion | Mail;
}

export interface Recipient {
  id: string;
  name: string;
  class?: string;
  ref?: NewDiscussionRecipient | Recipients
}

export interface Message {
  id: string;
  content: string;
  author: string;
  subject: string;
  date: Date;
  attachments: Attachment[];
  /** Sent by the user. */
  isMine?: boolean;
}
