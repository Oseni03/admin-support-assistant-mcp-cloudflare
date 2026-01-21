import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export interface DriveContext {
  drive: ReturnType<typeof google.drive>;
}

export function createDriveContext(oauth: OAuth2Client): DriveContext {
  return {
    drive: google.drive({ version: "v3", auth: oauth }),
  };
}
