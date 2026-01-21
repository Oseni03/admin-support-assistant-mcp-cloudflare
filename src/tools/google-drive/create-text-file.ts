import { z } from "zod";
import { DriveTool } from "./types";
import { CreateDriveTextFileSchema } from "./schemas";

export const createDriveTextFile: DriveTool<z.infer<typeof CreateDriveTextFileSchema>> = async ({ drive }, args) => {
  const fileMetadata = {
    name: args.name,
    mimeType: "text/plain",
    parents: args.parentId ? [args.parentId] : undefined,
  };

  const media = {
    mimeType: "text/plain",
    body: args.content,
  };

  const { data } = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: "id, name, webViewLink",
  });

  return {
    content: [
      {
        type: "text",
        text: `Created file "${data.name}" (ID: ${data.id})\nView link: ${data.webViewLink || "N/A"}`,
      },
    ],
  };
};
