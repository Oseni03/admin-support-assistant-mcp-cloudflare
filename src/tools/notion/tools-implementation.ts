// tools/notion/tools-implementation.ts
import { z } from "zod";
import { NotionTool } from "./types";
import {
  SearchPagesSchema,
  GetPageSchema,
  GetDatabaseSchema,
  QueryDatabaseSchema,
  CreatePageSchema,
  UpdatePageSchema,
  AppendBlocksSchema,
  GetBlockChildrenSchema,
  ListDatabasesSchema,
} from "./schemas";

// Helper to convert markdown to Notion blocks (simplified)
function markdownToBlocks(markdown: string): any[] {
  const lines = markdown.split("\n");
  const blocks: any[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Simple heading detection
    if (line.startsWith("# ")) {
      blocks.push({
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      });
    } else if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: line.slice(4) } }],
        },
      });
    } else {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: line } }],
        },
      });
    }
  }

  return blocks;
}

export const searchPages: NotionTool<z.infer<typeof SearchPagesSchema>> = async ({ notion }, args) => {
  const response = await notion.search({
    query: args.query,
    page_size: args.pageSize,
    filter: { property: "object", value: "page" },
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const getPage: NotionTool<z.infer<typeof GetPageSchema>> = async ({ notion }, args) => {
  const response = await notion.pages.retrieve({ page_id: args.pageId });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const getDatabase: NotionTool<z.infer<typeof GetDatabaseSchema>> = async ({ notion }, args) => {
  const response = await notion.databases.retrieve({ database_id: args.databaseId });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const queryDatabase: NotionTool<z.infer<typeof QueryDatabaseSchema>> = async ({ notion }, args) => {
  const queryParams: any = {
    database_id: args.databaseId,
    page_size: args.pageSize,
  };

  if (args.filterBy) {
    try {
      queryParams.filter = JSON.parse(args.filterBy);
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error parsing filter: ${e}` }],
      };
    }
  }

  if (args.sortBy) {
    try {
      queryParams.sorts = JSON.parse(args.sortBy);
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error parsing sorts: ${e}` }],
      };
    }
  }

  const response = await notion.databases.retrieve(queryParams);

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const createPage: NotionTool<z.infer<typeof CreatePageSchema>> = async ({ notion }, args) => {
  if (!args.parentPageId && !args.parentDatabaseId) {
    return {
      content: [{ type: "text", text: "Error: Either parentPageId or parentDatabaseId must be provided" }],
    };
  }

  const parent = args.parentDatabaseId ? { database_id: args.parentDatabaseId } : { page_id: args.parentPageId! };

  const properties: any = {
    title: {
      title: [{ type: "text", text: { content: args.title } }],
    },
  };

  // If creating in a database and properties provided, merge them
  if (args.properties && args.parentDatabaseId) {
    try {
      const customProps = JSON.parse(args.properties);
      Object.assign(properties, customProps);
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error parsing properties: ${e}` }],
      };
    }
  }

  const pageData: any = {
    parent,
    properties,
  };

  // Add content blocks if provided
  if (args.content) {
    pageData.children = markdownToBlocks(args.content);
  }

  const response = await notion.pages.create(pageData);

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const updatePage: NotionTool<z.infer<typeof UpdatePageSchema>> = async ({ notion }, args) => {
  const updateData: any = {
    page_id: args.pageId,
  };

  if (args.title) {
    updateData.properties = {
      title: {
        title: [{ type: "text", text: { content: args.title } }],
      },
    };
  }

  if (args.properties) {
    try {
      const customProps = JSON.parse(args.properties);
      updateData.properties = { ...updateData.properties, ...customProps };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error parsing properties: ${e}` }],
      };
    }
  }

  if (args.archived !== undefined) {
    updateData.archived = args.archived;
  }

  const response = await notion.pages.update(updateData);

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const appendBlocks: NotionTool<z.infer<typeof AppendBlocksSchema>> = async ({ notion }, args) => {
  const blocks = markdownToBlocks(args.content);

  const response = await notion.blocks.children.append({
    block_id: args.pageId,
    children: blocks,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const getBlockChildren: NotionTool<z.infer<typeof GetBlockChildrenSchema>> = async ({ notion }, args) => {
  const response = await notion.blocks.children.list({
    block_id: args.blockId,
    page_size: args.pageSize,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};

export const listDatabases: NotionTool<z.infer<typeof ListDatabasesSchema>> = async ({ notion }, args) => {
  const response = await notion.search({
    page_size: args.pageSize,
    filter: { property: "object", value: "data_source" },
  });

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
};
