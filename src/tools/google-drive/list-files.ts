import { z } from "zod";
import { DriveTool } from "./types";
import { ListDriveFilesSchema } from "./schemas";

export const listDriveFiles: DriveTool<z.infer<typeof ListDriveFilesSchema>> = async ({ drive }, args) => {
  const { data } = await drive.files.list({
    q: args.query,
    pageSize: args.pageSize,
    fields: "files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink)",
  });

  const files = data.files || [];
  const text = files.length === 0 ? "No files found." : `Found ${files.length} files:\n${JSON.stringify(files, null, 2)}`;

  return {
    content: [{ type: "text", text }],
  };
};
