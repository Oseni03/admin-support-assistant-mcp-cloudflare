import { z } from "zod";
import { gmail_v1 } from "googleapis";
import { GmailTool } from "./types";
import { ReadEmailSchema } from "./schemas";

interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface EmailContent {
  text: string;
  html: string;
}

function extractContent(messagePart: gmail_v1.Schema$MessagePart): EmailContent {
  let textContent = "";
  let htmlContent = "";

  if (messagePart.body && messagePart.body.data) {
    const content = Buffer.from(messagePart.body.data, "base64").toString("utf8");

    if (messagePart.mimeType === "text/plain") {
      textContent = content;
    } else if (messagePart.mimeType === "text/html") {
      htmlContent = content;
    }
  }

  if (messagePart.parts && messagePart.parts.length > 0) {
    for (const part of messagePart.parts) {
      const { text, html } = extractContent(part);
      if (text) textContent += text;
      if (html) htmlContent += html;
    }
  }

  return { text: textContent, html: htmlContent };
}

export const readEmail: GmailTool<z.infer<typeof ReadEmailSchema>> = async ({ gmail }, { messageId }) => {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = response.data.payload?.headers || [];
  const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
  const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
  const to = headers.find((h) => h.name?.toLowerCase() === "to")?.value || "";
  const date = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";
  const threadId = response.data.threadId || "";

  const { text, html } = extractContent((response.data.payload as gmail_v1.Schema$MessagePart) || {});
  let body = text || html || "";
  const contentTypeNote = !text && html ? "[Note: This email is HTML-formatted. Plain text version not available.]\n\n" : "";

  const attachments: EmailAttachment[] = [];
  const processAttachmentParts = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;
    if (part.body && part.body.attachmentId) {
      const filename = part.filename || `attachment-${part.body.attachmentId}`;
      attachments.push({
        id: part.body.attachmentId,
        filename: filename,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
      });
    }

    if (part.parts) {
      part.parts.forEach((subpart: gmail_v1.Schema$MessagePart) => processAttachmentParts(subpart));
    }
  };

  if (response.data.payload) {
    processAttachmentParts(response.data.payload as gmail_v1.Schema$MessagePart);
  }

  const attachmentInfo =
    attachments.length > 0
      ? `\n\nAttachments (${attachments.length}):\n` +
        attachments.map((a) => `- ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)} KB, ID: ${a.id})`).join("\n")
      : "";

  return {
    content: [
      {
        type: "text" as const,
        text: `Thread ID: ${threadId}\nSubject: ${subject}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${contentTypeNote}${body}${attachmentInfo}`,
      },
    ],
  };
};
