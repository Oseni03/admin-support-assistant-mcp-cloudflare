import { z } from "zod";
import { GmailTool } from "./types";
import { createEmailMessage, SendEmailSchema } from "./schemas";

export const draftEmail: GmailTool<z.infer<typeof SendEmailSchema>> = async ({ gmail }, args) => {
  const message = createEmailMessage(args);
  const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const messageRequest = {
    raw: encodedMessage,
    ...(args.threadId && { threadId: args.threadId }),
  };

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: messageRequest,
    },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response.data),
      },
    ],
  };
};
