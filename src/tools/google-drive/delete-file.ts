import { z } from "zod";
import { DriveTool } from "./types";
import { DeleteDriveFileSchema } from "./schemas";

export const deleteDriveFile: DriveTool<z.infer<typeof DeleteDriveFileSchema>> = async ({ drive }, args) => {
  await drive.files.delete({
    fileId: args.fileId,
  });

  return {
    content: [{ type: "text", text: "File permanently deleted." }],
  };
};
