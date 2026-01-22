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
import { slackTools } from "./tools/slack";
import { createSlackContext } from "./tools/slack/context";
import { createDriveContext } from "./tools/google-drive/context";
import { driveTools } from "./tools/google-drive";
import { Props } from "./utils";

const ALLOWED_USERNAMES = new Set<string>([
  // Add GitHub usernames allowed to use restricted tools
]);

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Admin Assistant MCP with GitHub, Gmail, Calendar, Drive, Notion & Slack Integrations",
    version: "1.0.0",
  });

  async init() {
    // ── List available integrations ─────────────────────────────────────────
    // Register the integrations resource
    this.server.registerResource(
      "integrations-list",
      "integrations://list",
      {
        title: "Integrations List",
        description: "Interactive view of all available integrations and their connection status",
        mimeType: "text/html",
      },
      async () => {
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
          slack: {
            connected: !!this.props?.slackAccessToken,
            user: this.props?.login || null,
            description: "Send messages and manage Slack workspace",
          },
        };

        const integrationsWithUrls = Object.entries(integrations).map(([name, info]) => ({
          name,
          ...info,
          connectUrl: this.generateAuthUrl(name.toLowerCase()),
        }));

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Integrations</title>
        <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
        <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
        <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f9fafb;
            }
            #root { min-height: 100vh; padding: 20px; }
        </style>
        </head>
        <body>
        <div id="root"></div>
        <script type="text/babel">
            const { useState } = React;
            const IntegrationCard = ({ integration }) => {
            const capitalizedName = integration.name.charAt(0).toUpperCase() + integration.name.slice(1);
            const [isHovered, setIsHovered] = useState(false);
            const cardStyle = {
                background: 'white',
                border: '1px solid #e5e7eb',
                borderLeft: integration.connected ? '4px solid #10b981' : '4px solid #ef4444',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                transition: 'transform 0.2s, box-shadow 0.2s',
                ...(isHovered ? { transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' } : {})
            };
            return (
                <div style={cardStyle} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '18px', marginBottom: '4px', color: '#111827' }}>{capitalizedName}</div>
                    <div style={{ color: '#6b7280', marginBottom: '8px', fontSize: '14px' }}>{integration.description}</div>
                    <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '12px', fontSize: '14px', fontWeight: 500, background: integration.connected ? '#d1fae5' : '#fee2e2', color: integration.connected ? '#065f46' : '#991b1b' }}>
                    {integration.connected ? '✓ Connected' : '✗ Not Connected'}
                    </span>
                    {(integration.user || integration.email) && (
                    <div style={{ color: '#4b5563', fontSize: '13px', marginTop: '6px', fontFamily: 'monospace' }}>Account: {integration.user || integration.email}</div>
                    )}
                </div>
                <div style={{ marginLeft: '16px' }}>
                    {!integration.connected ? (
                    <a href={integration.connectUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 16px', borderRadius: '6px', background: '#0070f3', color: 'white', textDecoration: 'none', fontSize: '14px', fontWeight: 500, display: 'inline-block' }}>Connect</a>
                    ) : (
                    <button onClick={() => alert('To disconnect, reconnect to revoke access.')} style={{ padding: '8px 16px', borderRadius: '6px', background: '#ef4444', color: 'white', border: 'none', fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>Disconnect</button>
                    )}
                </div>
                </div>
            );
            };
            const IntegrationsList = () => {
            const integrations = ${JSON.stringify(integrationsWithUrls)};
            const [filter, setFilter] = useState('all');
            const filteredIntegrations = integrations.filter(i => filter === 'all' || (filter === 'connected' ? i.connected : !i.connected));
            return (
                <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                <div style={{ marginBottom: '24px' }}>
                    <h1 style={{ color: '#111827', marginBottom: '12px', fontSize: '32px', fontWeight: 700 }}>Available Integrations</h1>
                    <div style={{ display: 'flex', gap: '8px' }}>
                    {['all', 'connected', 'disconnected'].map(f => (
                        <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', background: filter === f ? '#0070f3' : 'white', color: filter === f ? 'white' : '#111827', fontSize: '14px', fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
                    ))}
                    </div>
                </div>
                {filteredIntegrations.map(i => <IntegrationCard key={i.name} integration={i} />)}
                {filteredIntegrations.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>No {filter} integrations found.</div>}
                </div>
            );
            };
            ReactDOM.render(<IntegrationsList />, document.getElementById('root'));
        </script>
        </body>
        </html>`;

        return {
          contents: [
            {
              uri: "integrations://list",
              mimeType: "text/html",
              text: html,
            },
          ],
        };
      },
    );

    // Register the tool that returns a ResourceLink
    this.server.registerTool(
      "listIntegrations",
      {
        title: "List Integrations",
        description: "List all available integrations and their connection status",
        inputSchema: z.object({}).strict(),
      },
      async () => {
        return {
          content: [
            {
              type: "text" as const,
              text: "Here's an interactive view of your available integrations:",
            },
            {
              type: "resource_link" as const,
              uri: "integrations://list",
              name: "Integrations Dashboard",
              mimeType: "text/html",
              description: "Interactive view showing connection status and options for all integrations",
            },
          ],
        };
      },
    );

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

    // ── Register Slack tools (NEW - same JIT pattern) ───────────────────────
    await this.registerSlackTools();
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

  // ── NEW: Slack tools registration (same JIT pattern) ────────────────────
  private async registerSlackTools() {
    // Helper: returns [context, null] or [null, authError]
    const getSlackContext = (): [any, null] | [null, any] => {
      if (!this.props?.slackAccessToken) {
        return [null, this.authorizationRequired("slack", "Slack integration is required for this action")];
      }

      return [createSlackContext(this.props.slackAccessToken), null];
    };

    // Register every Slack tool declaratively
    for (const [toolName, toolDef] of Object.entries(slackTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = getSlackContext();
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
