import { z } from "zod";
import { GmailTool } from "./types";
import { ModifyEmailSchema } from "./schemas";

export const modifyEmail: GmailTool<z.infer<typeof ModifyEmailSchema>> = async ({ gmail }, args) => {
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

  await gmail.users.messages.modify({
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
};
