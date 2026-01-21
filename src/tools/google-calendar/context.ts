import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

export interface CalendarContext {
  calendar: ReturnType<typeof google.calendar>;
}

export function createCalendarContext(oauth2Client: OAuth2Client): CalendarContext {
  return {
    calendar: google.calendar({ version: "v3", auth: oauth2Client }),
  };
}
