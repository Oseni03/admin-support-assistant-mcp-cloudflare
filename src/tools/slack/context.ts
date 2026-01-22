import { WebClient } from "@slack/web-api";

export interface SlackContext {
  slack: WebClient;
}

export function createSlackContext(accessToken: string): SlackContext {
  return {
    slack: new WebClient(accessToken),
  };
}
