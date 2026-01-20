import { z } from "zod";
import { GmailTool } from "./types";
import { SearchEmailsSchema } from "./schemas";

export const searchEmails: GmailTool<z.infer<typeof SearchEmailsSchema>> = async ({ gmail }, args) => {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: args.query,
    maxResults: args.maxResults || 10,
  });

  const messages = response.data.messages || [];
  const results = await Promise.all(
    messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
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
        text: JSON.stringify(results),
      },
    ],
  };
};
