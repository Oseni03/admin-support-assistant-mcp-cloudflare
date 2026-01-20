import { z } from "zod";
import { GmailTool } from "./types";
import { createEmailMessage, SendEmailSchema } from "./schemas";

export const sendEmail: GmailTool<z.infer<typeof SendEmailSchema>> = async ({ gmail }, args) => {
  const message = createEmailMessage(args);
  const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const result = await gmail.users.messages.send({
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
        text: JSON.stringify(result.data),
      },
    ],
  };
};
