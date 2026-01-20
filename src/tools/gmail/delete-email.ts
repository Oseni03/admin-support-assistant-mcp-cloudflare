import { z } from "zod";
import { GmailTool } from "./types";
import { DeleteEmailSchema } from "./schemas";

export const deleteEmail: GmailTool<z.infer<typeof DeleteEmailSchema>> = async ({ gmail }, { messageId }) => {
  await gmail.users.messages.delete({
    userId: "me",
    id: messageId,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `Email ${messageId} deleted successfully`,
      },
    ],
  };
};
