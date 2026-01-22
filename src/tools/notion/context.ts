import { Client } from "@notionhq/client";

export interface NotionContext {
  notion: Client;
}

export function createNotionContext(accessToken: string): NotionContext {
  return {
    notion: new Client({ auth: accessToken }),
  };
}
