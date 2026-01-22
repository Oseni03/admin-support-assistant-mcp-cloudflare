import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Octokit } from "octokit";
import { z } from "zod";
import { OAuthHandler } from "./oauth-handler";
import { OAuth2Client } from "google-auth-library";
import { gmailTools } from "./tools/gmail";
import { createGmailContext } from "./tools/gmail/context";
import { calendarTools } from "./tools/google-calendar";
import { createCalendarContext } from "./tools/google-calendar/context";
import { notionTools } from "./tools/notion";
import { createNotionContext } from "./tools/notion/context";
import { Props } from "./utils";
import { createDriveContext } from "./tools/google-drive/context";
import { driveTools } from "./tools/google-drive";

const ALLOWED_USERNAMES = new Set<string>([
  // Add GitHub usernames allowed to use restricted tools
]);

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Admin Assistant",
    version: "1.0.0",
  });

  async init() {
    // ── List available integrations ─────────────────────────────────────────
    this.server.tool("listIntegrations", "List all available integrations and their connection status", {}, async () => {
      const integrations = {
        github: {
          connected: !!this.props?.accessToken,
          user: this.props?.login || null,
          description: "Access GitHub repositories and user information",
        },
        gmail: {
          connected: !!this.props?.gmailAccessToken,
          email: this.props?.email || null,
          description: "Send, read, and manage Google emails",
        },
        calendar: {
          connected: !!this.props?.calendarAccessToken,
          email: this.props?.email || null,
          description: "Manage Google Calendar events and calendars",
        },
        drive: {
          connected: !!this.props?.driveAccessToken,
          email: this.props?.email || null,
          description: "Read, write, and manage files in Google Drive",
        },
        notion: {
          connected: !!this.props?.notionAccessToken,
          user: this.props?.login || null,
          description: "Access and manage Notion pages and databases",
        },
        imageGeneration: {
          connected: ALLOWED_USERNAMES.has(this.props!.login),
          enabled: ALLOWED_USERNAMES.has(this.props!.login),
          description: "Generate images using AI",
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(integrations, null, 2) }],
      };
    });

    // ── Always-available basic math tool ────────────────────────────────────
    this.server.tool("add", "Add two numbers", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }));

    // ── Register GitHub tools ───────────────────────────────────────────────
    await this.registerGitHubTools();

    // ── Register Gmail tools (JIT auth preserved!) ──────────────────────────
    await this.registerGmailTools();

    // ── Register Calendar tools (same JIT pattern) ──────────────────────────
    await this.registerCalendarTools();

    // ── Google Drive tools (JIT auth) ─────────────────────────────────────
    await this.registerDriveTools();

    // ── Register Notion tools (NEW - same JIT pattern) ──────────────────────
    await this.registerNotionTools();
  }

  // ── GitHub tools registration (unchanged) ───────────────────────────────
  private async registerGitHubTools() {
    this.server.registerTool(
      "userInfoOctokit",
      {
        title: "userInfoOctokit",
        description: "Get authenticated user information from GitHub using Octokit",
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        if (!this.props?.accessToken) {
          return this.authorizationRequired("github", "GitHub integration is required", "userInfoOctokit");
        }

        try {
          const octokit = new Octokit({ auth: this.props.accessToken });
          const user = await octokit.rest.users.getAuthenticated();
          return {
            content: [{ type: "text", text: JSON.stringify(user.data, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
          };
        }
      },
    );
  }

  // ── Gmail tools registration (unchanged) ────────────────────────────────
  private async registerGmailTools() {
    const getGmailContext = (): [any, null] | [null, any] => {
      if (!this.props?.gmailAccessToken) {
        return [null, this.authorizationRequired("gmail", "Gmail integration is required for this action")];
      }

      const oauth = new OAuth2Client();
      oauth.setCredentials({
        access_token: this.props.gmailAccessToken,
        refresh_token: this.props.gmailRefreshToken,
      });

      return [createGmailContext(oauth), null];
    };

    for (const [toolName, toolDef] of Object.entries(gmailTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = getGmailContext();
          if (!ctx) return authError;

          try {
            return await toolDef.handler(ctx, args as any);
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `Error: ${err.message}` }],
            };
          }
        },
      );
    }
  }

  // ── Calendar tools registration (identical pattern) ─────────────────────
  private async registerCalendarTools() {
    // Helper: returns [context, null] or [null, authError]
    const getCalendarContext = (): [any, null] | [null, any] => {
      if (!this.props?.calendarAccessToken) {
        return [null, this.authorizationRequired("calendar", "Google Calendar integration is required for this action")];
      }

      const oauth = new OAuth2Client();
      oauth.setCredentials({
        access_token: this.props.calendarAccessToken,
        refresh_token: this.props.calendarRefreshToken,
      });

      return [createCalendarContext(oauth), null];
    };

    // Register every Calendar tool declaratively
    for (const [toolName, toolDef] of Object.entries(calendarTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = getCalendarContext();
          if (!ctx) return authError;

          try {
            return await toolDef.handler(ctx, args as any);
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `Error: ${err.message}` }],
            };
          }
        },
      );
    }
  }

  private async registerDriveTools() {
    const getDriveContext = (): [any, null] | [null, any] => {
      if (!this.props?.driveAccessToken) {
        return [null, this.authorizationRequired("drive", "Google Drive integration is required for this action")];
      }

      const oauth = new OAuth2Client();
      oauth.setCredentials({
        access_token: this.props.driveAccessToken,
        refresh_token: this.props.driveRefreshToken,
      });

      return [createDriveContext(oauth), null];
    };

    for (const [toolName, toolDef] of Object.entries(driveTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = getDriveContext();
          if (!ctx) return authError;

          try {
            return await toolDef.handler(ctx, args as any);
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `Error: ${err.message}` }],
            };
          }
        },
      );
    }
  }

  // ── NEW: Notion tools registration (same JIT pattern) ───────────────────
  private async registerNotionTools() {
    // Helper: returns [context, null] or [null, authError]
    const getNotionContext = (): [any, null] | [null, any] => {
      if (!this.props?.notionAccessToken) {
        return [null, this.authorizationRequired("notion", "Notion integration is required for this action")];
      }

      return [createNotionContext(this.props.notionAccessToken), null];
    };

    // Register every Notion tool declaratively
    for (const [toolName, toolDef] of Object.entries(notionTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = getNotionContext();
          if (!ctx) return authError;

          try {
            return await toolDef.handler(ctx, args as any);
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `Error: ${err.message}` }],
            };
          }
        },
      );
    }
  }

  // ── Helpers (unchanged) ─────────────────────────────────────────────────
  private generateAuthUrl(provider: string, returnContext?: any): string {
    const baseUrl = this.env.SERVER_URL;
    const url = new URL("/authorize", baseUrl);
    url.searchParams.set("provider", provider);
    if (returnContext) {
      url.searchParams.set("context", btoa(JSON.stringify(returnContext)));
    }
    return url.toString();
  }

  private authorizationRequired(provider: string, message: string, toolName?: string) {
    const authUrl = this.generateAuthUrl(provider, {
      returnTool: toolName,
      timestamp: Date.now(),
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: "authorization_required",
              provider,
              message,
              authorizationUrl: authUrl,
              instructions: `Please visit the authorization URL to connect ${provider}, then retry this action.`,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"),
    "/mcp": MyMCP.serve("/mcp"),
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: OAuthHandler as any,
  tokenEndpoint: "/token",
});
