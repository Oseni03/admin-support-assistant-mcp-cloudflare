import { z } from "zod";

export const SearchPagesSchema = z.object({
  query: z.string().describe("Search query to find pages"),
  pageSize: z.number().optional().default(10).describe("Number of results to return (max 100)"),
});

export const GetPageSchema = z.object({
  pageId: z.string().describe("ID of the Notion page to retrieve"),
});

export const GetDatabaseSchema = z.object({
  databaseId: z.string().describe("ID of the Notion database to retrieve"),
});

export const QueryDatabaseSchema = z.object({
  databaseId: z.string().describe("ID of the Notion database to query"),
  pageSize: z.number().optional().default(10).describe("Number of results to return (max 100)"),
  filterBy: z.string().optional().describe("JSON string of filter object (Notion API format)"),
  sortBy: z.string().optional().describe("JSON string of sort array (Notion API format)"),
});

export const CreatePageSchema = z.object({
  parentPageId: z.string().optional().describe("ID of parent page (use this OR parentDatabaseId)"),
  parentDatabaseId: z.string().optional().describe("ID of parent database (use this OR parentPageId)"),
  title: z.string().describe("Title of the new page"),
  content: z.string().optional().describe("Markdown content for the page body"),
  properties: z.string().optional().describe("JSON string of database properties (for database pages)"),
});

export const UpdatePageSchema = z.object({
  pageId: z.string().describe("ID of the page to update"),
  title: z.string().optional().describe("New title for the page"),
  properties: z.string().optional().describe("JSON string of properties to update (for database pages)"),
  archived: z.boolean().optional().describe("Whether to archive the page"),
});

export const AppendBlocksSchema = z.object({
  pageId: z.string().describe("ID of the page to append blocks to"),
  content: z.string().describe("Markdown content to append"),
});

export const GetBlockChildrenSchema = z.object({
  blockId: z.string().describe("ID of the block to get children from"),
  pageSize: z.number().optional().default(10).describe("Number of results to return (max 100)"),
});

export const ListDatabasesSchema = z.object({
  pageSize: z.number().optional().default(10).describe("Number of results to return (max 100)"),
});
