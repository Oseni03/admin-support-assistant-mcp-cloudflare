// tools/gmail/context.ts
import { google, gmail_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export interface GmailContext {
  gmail: gmail_v1.Gmail;
}

export function createGmailContext(oauth: OAuth2Client): GmailContext {
  return {
    gmail: google.gmail({ version: "v1", auth: oauth }),
  };
}
