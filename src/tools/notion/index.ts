import {
  searchPages,
  getPage,
  getDatabase,
  queryDatabase,
  createPage,
  updatePage,
  appendBlocks,
  getBlockChildren,
  listDatabases,
} from "./tools-implementation";
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

// ── Export the complete tool registry ──────────────────────────────────
export const notionTools = {
  search_pages: {
    schema: SearchPagesSchema,
    handler: searchPages,
    description: "Search for pages in Notion workspace",
  },
  get_page: {
    schema: GetPageSchema,
    handler: getPage,
    description: "Retrieve a specific Notion page by ID",
  },
  get_database: {
    schema: GetDatabaseSchema,
    handler: getDatabase,
    description: "Retrieve a specific Notion database by ID",
  },
  query_database: {
    schema: QueryDatabaseSchema,
    handler: queryDatabase,
    description: "Query a Notion database with optional filters and sorting",
  },
  create_page: {
    schema: CreatePageSchema,
    handler: createPage,
    description: "Create a new page in Notion (in a page or database)",
  },
  update_page: {
    schema: UpdatePageSchema,
    handler: updatePage,
    description: "Update an existing Notion page",
  },
  append_blocks: {
    schema: AppendBlocksSchema,
    handler: appendBlocks,
    description: "Append content blocks to an existing Notion page",
  },
  get_block_children: {
    schema: GetBlockChildrenSchema,
    handler: getBlockChildren,
    description: "Get child blocks of a page or block",
  },
  list_databases: {
    schema: ListDatabasesSchema,
    handler: listDatabases,
    description: "List all databases in the Notion workspace",
  },
} as const;
