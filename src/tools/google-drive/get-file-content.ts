import { z } from "zod";
import { DriveTool } from "./types";
import { GetDriveFileContentSchema } from "./schemas";

export const getDriveFileContent: DriveTool<z.infer<typeof GetDriveFileContentSchema>> = async ({ drive }, args) => {
  try {
    const res = await drive.files.get(
      {
        fileId: args.fileId,
        alt: "media",
      },
      { responseType: "text" },
    );

    return {
      content: [{ type: "text", text: res.data as string }],
    };
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error downloading content: ${err.message}` }],
    };
  }
};
