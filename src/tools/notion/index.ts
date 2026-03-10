import { Client } from "@notionhq/client";
import generatedToolsData from "../../../generated-notion-tools.json";

// Type definitions
export interface NotionContext {
  notion: Client;
}

export function createNotionContext(accessToken: string): NotionContext {
  return {
    notion: new Client({ auth: accessToken }),
  };
}

// Extract the generated tools
const generatedTools = generatedToolsData as any;
const { tools, openApiLookup } = generatedTools;

// Create a map of tool name to operation details
const toolOperations: Record<string, any> = {};
for (const method of tools.API.methods) {
  const operationKey = `API-${method.name}`;
  toolOperations[method.name] = {
    ...openApiLookup[operationKey],
    methodName: method.name,
    inputSchema: method.inputSchema,
    returnSchema: method.returnSchema,
  };
}

// ── Export the complete tool registry ──────────────────────────────────
export const notionTools = toolOperations;
