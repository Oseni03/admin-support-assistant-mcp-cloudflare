import { z } from "zod";

export const ListDriveFilesSchema = z.object({
  query: z.string().optional().describe("Optional search query (GDrive query syntax)"),
  pageSize: z.number().optional().default(20).describe("Number of files to return"),
});

export const CreateDriveTextFileSchema = z.object({
  name: z.string().describe("Name of the new file"),
  content: z.string().describe("Text content of the file"),
  parentId: z.string().optional().describe("Optional parent folder ID"),
});

export const GetDriveFileMetadataSchema = z.object({
  fileId: z.string().describe("ID of the file"),
});

export const GetDriveFileContentSchema = z.object({
  fileId: z.string().describe("ID of the file (text-compatible files only)"),
});

export const DeleteDriveFileSchema = z.object({
  fileId: z.string().describe("ID of the file to delete"),
});
