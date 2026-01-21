import { z } from "zod";
import { DriveTool } from "./types";
import { GetDriveFileMetadataSchema } from "./schemas";

export const getDriveFileMetadata: DriveTool<z.infer<typeof GetDriveFileMetadataSchema>> = async ({ drive }, args) => {
  const { data } = await drive.files.get({
    fileId: args.fileId,
    fields: "id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, webContentLink",
  });

  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
};
