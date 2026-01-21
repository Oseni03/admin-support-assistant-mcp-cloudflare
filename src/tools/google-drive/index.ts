import { listDriveFiles } from "./list-files";
import { createDriveTextFile } from "./create-text-file";
import { getDriveFileMetadata } from "./get-file-metadata";
import { getDriveFileContent } from "./get-file-content";
import { deleteDriveFile } from "./delete-file";
import {
  ListDriveFilesSchema,
  CreateDriveTextFileSchema,
  GetDriveFileMetadataSchema,
  GetDriveFileContentSchema,
  DeleteDriveFileSchema,
} from "./schemas";

export const driveTools = {
  list_drive_files: {
    schema: ListDriveFilesSchema,
    handler: listDriveFiles,
    description: "List files and folders in Google Drive",
  },
  create_drive_text_file: {
    schema: CreateDriveTextFileSchema,
    handler: createDriveTextFile,
    description: "Create a new text file in Google Drive",
  },
  get_drive_file_metadata: {
    schema: GetDriveFileMetadataSchema,
    handler: getDriveFileMetadata,
    description: "Retrieve metadata for a specific Drive file",
  },
  get_drive_file_content: {
    schema: GetDriveFileContentSchema,
    handler: getDriveFileContent,
    description: "Download the text content of a Drive file",
  },
  delete_drive_file: {
    schema: DeleteDriveFileSchema,
    handler: deleteDriveFile,
    description: "Permanently delete a file from Google Drive",
  },
} as const;
