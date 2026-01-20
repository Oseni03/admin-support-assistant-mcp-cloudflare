import { z } from "zod";
import { GmailTool } from "./types";
import { CreateLabelSchema, UpdateLabelSchema, DeleteLabelSchema, GetOrCreateLabelSchema, ListEmailLabelsSchema } from "./schemas";

export const listEmailLabels: GmailTool<z.infer<typeof ListEmailLabelsSchema>> = async ({ gmail }) => {
  const response = await gmail.users.labels.list({
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
};

export const createLabel: GmailTool<z.infer<typeof CreateLabelSchema>> = async ({ gmail }, args) => {
  const res = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: args.name,
      messageListVisibility: "show",
      labelListVisibility: "labelShow",
    },
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(res.data),
      },
    ],
  };
};

export const updateLabel: GmailTool<z.infer<typeof UpdateLabelSchema>> = async ({ gmail }, args) => {
  const updates: any = {};
  if (args.name) updates.name = args.name;
  if (args.messageListVisibility) updates.messageListVisibility = args.messageListVisibility;
  if (args.labelListVisibility) updates.labelListVisibility = args.labelListVisibility;

  const result = await gmail.users.labels.update({
    userId: "me",
    id: args.id,
    requestBody: updates,
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

export const deleteLabel: GmailTool<z.infer<typeof DeleteLabelSchema>> = async ({ gmail }, { id }) => {
  await gmail.users.labels.delete({ userId: "me", id });
  return {
    content: [{ type: "text", text: `Label ${id} deleted successfully` }],
  };
};

export const getOrCreateLabel: GmailTool<z.infer<typeof GetOrCreateLabelSchema>> = async ({ gmail }, args) => {
  // Try to find existing label
  const labels = await gmail.users.labels.list({
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
  const result = await gmail.users.labels.create({
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
};
