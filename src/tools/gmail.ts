import { z } from "zod";
import { gmail_v1, google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

// Type definitions for Gmail API responses
interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{
    name: string;
    value: string;
  }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

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

interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

// Schemas
export const SendEmailSchema = z.object({
  to: z.array(z.string()).describe("List of recipient email addresses"),
  subject: z.string().describe("Email subject"),
  body: z.string().describe("Email body content (used for text/plain or when htmlBody not provided)"),
  htmlBody: z.string().optional().describe("HTML version of the email body"),
  mimeType: z.enum(["text/plain", "text/html", "multipart/alternative"]).optional().default("text/plain").describe("Email content type"),
  cc: z.array(z.string()).optional().describe("List of CC recipients"),
  bcc: z.array(z.string()).optional().describe("List of BCC recipients"),
  threadId: z.string().optional().describe("Thread ID to reply to"),
  inReplyTo: z.string().optional().describe("Message ID being replied to"),
});

export const ReadEmailSchema = z.object({
  messageId: z.string().describe("ID of the email message to retrieve"),
});

export const SearchEmailsSchema = z.object({
  query: z.string().describe("Gmail search query (e.g., 'from:example@gmail.com')"),
  maxResults: z.number().optional().describe("Maximum number of results to return"),
});

export const ModifyEmailSchema = z.object({
  messageId: z.string().describe("ID of the email message to modify"),
  labelIds: z.array(z.string()).optional().describe("List of label IDs to apply"),
  addLabelIds: z.array(z.string()).optional().describe("List of label IDs to add to the message"),
  removeLabelIds: z.array(z.string()).optional().describe("List of label IDs to remove from the message"),
});

export const DeleteEmailSchema = z.object({
  messageId: z.string().describe("ID of the email message to delete"),
});

export const ListEmailLabelsSchema = z.object({}).describe("Retrieves all available Gmail labels");

export const CreateLabelSchema = z
  .object({
    name: z.string().describe("Name for the new label"),
    messageListVisibility: z.enum(["show", "hide"]).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z
      .enum(["labelShow", "labelShowIfUnread", "labelHide"])
      .optional()
      .describe("Visibility of the label in the label list"),
  })
  .describe("Creates a new Gmail label");

export const UpdateLabelSchema = z
  .object({
    id: z.string().describe("ID of the label to update"),
    name: z.string().optional().describe("New name for the label"),
    messageListVisibility: z.enum(["show", "hide"]).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z
      .enum(["labelShow", "labelShowIfUnread", "labelHide"])
      .optional()
      .describe("Visibility of the label in the label list"),
  })
  .describe("Updates an existing Gmail label");

export const DeleteLabelSchema = z
  .object({
    id: z.string().describe("ID of the label to delete"),
  })
  .describe("Deletes a Gmail label");

export const GetOrCreateLabelSchema = z
  .object({
    name: z.string().describe("Name of the label to get or create"),
    messageListVisibility: z.enum(["show", "hide"]).optional().describe("Whether to show or hide the label in the message list"),
    labelListVisibility: z
      .enum(["labelShow", "labelShowIfUnread", "labelHide"])
      .optional()
      .describe("Visibility of the label in the label list"),
  })
  .describe("Gets an existing label by name or creates it if it doesn't exist");

export const BatchModifyEmailsSchema = z.object({
  messageIds: z.array(z.string()).describe("List of message IDs to modify"),
  addLabelIds: z.array(z.string()).optional().describe("List of label IDs to add to all messages"),
  removeLabelIds: z.array(z.string()).optional().describe("List of label IDs to remove from all messages"),
  batchSize: z.number().optional().default(50).describe("Number of messages to process in each batch (default: 50)"),
});

export const BatchDeleteEmailsSchema = z.object({
  messageIds: z.array(z.string()).describe("List of message IDs to delete"),
  batchSize: z.number().optional().default(50).describe("Number of messages to process in each batch (default: 50)"),
});

// Helper functions
function extractEmailContent(messagePart: GmailMessagePart): EmailContent {
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
      const { text, html } = extractEmailContent(part);
      if (text) textContent += text;
      if (html) htmlContent += html;
    }
  }

  return { text: textContent, html: htmlContent };
}

function createEmailMessage(args: any): string {
  const headers = [`To: ${args.to.join(", ")}`, `Subject: ${args.subject}`];

  if (args.cc && args.cc.length > 0) {
    headers.push(`Cc: ${args.cc.join(", ")}`);
  }

  if (args.bcc && args.bcc.length > 0) {
    headers.push(`Bcc: ${args.bcc.join(", ")}`);
  }

  if (args.inReplyTo) {
    headers.push(`In-Reply-To: ${args.inReplyTo}`);
  }

  const contentType = args.mimeType || "text/plain";
  headers.push(`Content-Type: ${contentType}; charset=utf-8`);

  const body = args.htmlBody || args.body;
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

async function processBatches<T, U>(
  items: T[],
  batchSize: number,
  processFn: (batch: T[]) => Promise<U[]>,
): Promise<{ successes: U[]; failures: { item: T; error: Error }[] }> {
  const successes: U[] = [];
  const failures: { item: T; error: Error }[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    try {
      const results = await processFn(batch);
      successes.push(...results);
    } catch (error) {
      for (const item of batch) {
        try {
          const result = await processFn([item]);
          successes.push(...result);
        } catch (itemError) {
          failures.push({ item, error: itemError as Error });
        }
      }
    }
  }

  return { successes, failures };
}

// Gmail tool implementations
export class GmailTools {
  private gmail: gmail_v1.Gmail;

  constructor(oauth2Client: OAuth2Client) {
    this.gmail = google.gmail({ version: "v1", auth: oauth2Client });
  }

  async sendEmail(args: z.infer<typeof SendEmailSchema>) {
    const message = createEmailMessage(args);
    const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const result = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        ...(args.threadId && { threadId: args.threadId }),
      },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Email sent successfully with ID: ${result.data.id}`,
        },
      ],
    };
  }

  async draftEmail(args: z.infer<typeof SendEmailSchema>) {
    const message = createEmailMessage(args);
    const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const messageRequest = {
      raw: encodedMessage,
      ...(args.threadId && { threadId: args.threadId }),
    };

    const response = await this.gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: messageRequest,
      },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Email draft created successfully with ID: ${response.data.id}`,
        },
      ],
    };
  }

  async readEmail(args: z.infer<typeof ReadEmailSchema>) {
    const response = await this.gmail.users.messages.get({
      userId: "me",
      id: args.messageId,
      format: "full",
    });

    const headers = response.data.payload?.headers || [];
    const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
    const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
    const to = headers.find((h) => h.name?.toLowerCase() === "to")?.value || "";
    const date = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";
    const threadId = response.data.threadId || "";

    const { text, html } = extractEmailContent((response.data.payload as GmailMessagePart) || {});
    let body = text || html || "";
    const contentTypeNote = !text && html ? "[Note: This email is HTML-formatted. Plain text version not available.]\n\n" : "";

    const attachments: EmailAttachment[] = [];
    const processAttachmentParts = (part: GmailMessagePart) => {
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
        part.parts.forEach((subpart: GmailMessagePart) => processAttachmentParts(subpart));
      }
    };

    if (response.data.payload) {
      processAttachmentParts(response.data.payload as GmailMessagePart);
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
  }

  async searchEmails(args: z.infer<typeof SearchEmailsSchema>) {
    const response = await this.gmail.users.messages.list({
      userId: "me",
      q: args.query,
      maxResults: args.maxResults || 10,
    });

    const messages = response.data.messages || [];
    const results = await Promise.all(
      messages.map(async (msg) => {
        const detail = await this.gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        });
        const headers = detail.data.payload?.headers || [];
        return {
          id: msg.id,
          subject: headers.find((h) => h.name === "Subject")?.value || "",
          from: headers.find((h) => h.name === "From")?.value || "",
          date: headers.find((h) => h.name === "Date")?.value || "",
        };
      }),
    );

    return {
      content: [
        {
          type: "text" as const,
          text: results.map((r) => `ID: ${r.id}\nSubject: ${r.subject}\nFrom: ${r.from}\nDate: ${r.date}\n`).join("\n"),
        },
      ],
    };
  }

  async modifyEmail(args: z.infer<typeof ModifyEmailSchema>) {
    const requestBody: any = {};

    if (args.labelIds) {
      requestBody.addLabelIds = args.labelIds;
    }

    if (args.addLabelIds) {
      requestBody.addLabelIds = args.addLabelIds;
    }

    if (args.removeLabelIds) {
      requestBody.removeLabelIds = args.removeLabelIds;
    }

    await this.gmail.users.messages.modify({
      userId: "me",
      id: args.messageId,
      requestBody: requestBody,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Email ${args.messageId} labels updated successfully`,
        },
      ],
    };
  }

  async deleteEmail(args: z.infer<typeof DeleteEmailSchema>) {
    await this.gmail.users.messages.delete({
      userId: "me",
      id: args.messageId,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Email ${args.messageId} deleted successfully`,
        },
      ],
    };
  }

  async listEmailLabels() {
    const response = await this.gmail.users.labels.list({
      userId: "me",
    });

    const labels = response.data.labels || [];
    const systemLabels = labels.filter((l) => l.type === "system");
    const userLabels = labels.filter((l) => l.type === "user");

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Found ${labels.length} labels (${systemLabels.length} system, ${userLabels.length} user):\n\n` +
            "System Labels:\n" +
            systemLabels.map((l) => `ID: ${l.id || "N/A"}\nName: ${l.name || "N/A"}\n`).join("\n") +
            "\nUser Labels:\n" +
            userLabels.map((l) => `ID: ${l.id || "N/A"}\nName: ${l.name || "N/A"}\n`).join("\n"),
        },
      ],
    };
  }

  async batchModifyEmails(args: z.infer<typeof BatchModifyEmailsSchema>) {
    const messageIds = args.messageIds;
    const batchSize = args.batchSize || 50;

    const requestBody: any = {};

    if (args.addLabelIds) {
      requestBody.addLabelIds = args.addLabelIds;
    }

    if (args.removeLabelIds) {
      requestBody.removeLabelIds = args.removeLabelIds;
    }

    const { successes, failures } = await processBatches(messageIds, batchSize, async (batch) => {
      const results = await Promise.all(
        batch.map(async (messageId) => {
          await this.gmail.users.messages.modify({
            userId: "me",
            id: messageId,
            requestBody: requestBody,
          });
          return { messageId, success: true };
        }),
      );
      return results;
    });

    const successCount = successes.length;
    const failureCount = failures.length;

    let resultText = `Batch label modification complete.\n`;
    resultText += `Successfully processed: ${successCount} messages\n`;

    if (failureCount > 0) {
      resultText += `Failed to process: ${failureCount} messages\n\n`;
      resultText += `Failed message IDs:\n`;
      resultText += failures.map((f) => `- ${(f.item as string).substring(0, 16)}... (${f.error.message})`).join("\n");
    }

    return {
      content: [
        {
          type: "text" as const,
          text: resultText,
        },
      ],
    };
  }

  async batchDeleteEmails(args: z.infer<typeof BatchDeleteEmailsSchema>) {
    const messageIds = args.messageIds;
    const batchSize = args.batchSize || 50;

    const { successes, failures } = await processBatches(messageIds, batchSize, async (batch) => {
      const results = await Promise.all(
        batch.map(async (messageId) => {
          await this.gmail.users.messages.delete({
            userId: "me",
            id: messageId,
          });
          return { messageId, success: true };
        }),
      );
      return results;
    });

    const successCount = successes.length;
    const failureCount = failures.length;

    let resultText = `Batch delete operation complete.\n`;
    resultText += `Successfully deleted: ${successCount} messages\n`;

    if (failureCount > 0) {
      resultText += `Failed to delete: ${failureCount} messages\n\n`;
      resultText += `Failed message IDs:\n`;
      resultText += failures.map((f) => `- ${(f.item as string).substring(0, 16)}... (${f.error.message})`).join("\n");
    }

    return {
      content: [
        {
          type: "text" as const,
          text: resultText,
        },
      ],
    };
  }

  async createLabel(args: z.infer<typeof CreateLabelSchema>) {
    const result = await this.gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: args.name,
        messageListVisibility: args.messageListVisibility,
        labelListVisibility: args.labelListVisibility,
      },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Label created successfully:\nID: ${result.data.id}\nName: ${result.data.name}\nType: ${result.data.type}`,
        },
      ],
    };
  }

  async updateLabel(args: z.infer<typeof UpdateLabelSchema>) {
    const updates: any = {};
    if (args.name) updates.name = args.name;
    if (args.messageListVisibility) updates.messageListVisibility = args.messageListVisibility;
    if (args.labelListVisibility) updates.labelListVisibility = args.labelListVisibility;

    const result = await this.gmail.users.labels.update({
      userId: "me",
      id: args.id,
      requestBody: updates,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Label updated successfully:\nID: ${result.data.id}\nName: ${result.data.name}\nType: ${result.data.type}`,
        },
      ],
    };
  }

  async deleteLabel(args: z.infer<typeof DeleteLabelSchema>) {
    await this.gmail.users.labels.delete({
      userId: "me",
      id: args.id,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Label ${args.id} deleted successfully`,
        },
      ],
    };
  }

  async getOrCreateLabel(args: z.infer<typeof GetOrCreateLabelSchema>) {
    // First, try to find existing label
    const labels = await this.gmail.users.labels.list({
      userId: "me",
    });

    const existingLabel = labels.data.labels?.find((l) => l.name === args.name);

    if (existingLabel) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully found existing label:\nID: ${existingLabel.id}\nName: ${existingLabel.name}\nType: ${existingLabel.type}`,
          },
        ],
      };
    }

    // Create new label if not found
    const result = await this.gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: args.name,
        messageListVisibility: args.messageListVisibility,
        labelListVisibility: args.labelListVisibility,
      },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully created new label:\nID: ${result.data.id}\nName: ${result.data.name}\nType: ${result.data.type}`,
        },
      ],
    };
  }
}
