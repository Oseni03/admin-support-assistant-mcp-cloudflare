import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
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

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Admin Assistant MCP with Google, Gmail, Calendar, Drive, Notion & Slack Integrations",
    version: "1.0.0",
  });

  async init() {
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
        const userEmail = this.props?.email || null;

        let integrations = {
          google: {
            connected: !!this.props?.accessToken,
            email: userEmail,
            description: "Base Google authentication for user profile",
          },
          gmail: {
            connected: false,
            email: userEmail,
            description: "Send, read, and manage Google emails",
          },
          calendar: {
            connected: false,
            email: userEmail,
            description: "Manage Google Calendar events and calendars",
          },
          drive: {
            connected: false,
            email: userEmail,
            description: "Read, write, and manage files in Google Drive",
          },
          notion: {
            connected: false,
            user: userEmail,
            description: "Access and manage Notion pages and databases",
          },
          slack: {
            connected: false,
            user: userEmail,
            description: "Send messages and manage Slack workspace",
          },
        };

        // Load from KV for non-Google-base integrations
        if (userEmail) {
          const key = `user-providers::${userEmail}`;
          const stored = await this.env.PROVIDERS_KV.get(key);
          if (stored) {
            const data = JSON.parse(stored);
            integrations = {
              ...integrations,
              gmail: {
                ...integrations.gmail,
                connected: !!data.providers?.gmail?.accessToken,
              },
              calendar: {
                ...integrations.calendar,
                connected: !!data.providers?.calendar?.accessToken,
              },
              drive: {
                ...integrations.drive,
                connected: !!data.providers?.drive?.accessToken,
              },
              notion: {
                ...integrations.notion,
                connected: !!data.providers?.notion?.accessToken,
              },
              slack: {
                ...integrations.slack,
                connected: !!data.providers?.slack?.accessToken,
              },
            };
          }
        }

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

    // Register the listIntegrations tool
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

    // Register Google base auth tool
    await this.registerGoogleTools();

    // Register other tools
    await this.registerGmailTools();
    await this.registerCalendarTools();
    await this.registerDriveTools();
    await this.registerNotionTools();
    await this.registerSlackTools();
  }

  // Google base auth
  private async registerGoogleTools() {
    this.server.registerTool(
      "userInfoGoogle",
      {
        title: "userInfoGoogle",
        description: "Get authenticated user information from Google",
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        if (!this.props?.accessToken) {
          return this.authorizationRequired("google", "Google integration is required", "userInfoGoogle");
        }

        try {
          const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: {
              Authorization: `Bearer ${this.props.accessToken}`,
            },
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch user info: ${response.statusText}`);
          }

          const user = await response.json();
          return {
            content: [{ type: "text", text: JSON.stringify(user, null, 2) }],
          };
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
          };
        }
      },
    );
  }

  // ── Gmail tools registration ────────────────────────────────
  private async registerGmailTools() {
    for (const [toolName, toolDef] of Object.entries(gmailTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = await this.getGmailContext();
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

  // ── Calendar tools registration ─────────────────────
  private async registerCalendarTools() {
    for (const [toolName, toolDef] of Object.entries(calendarTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = await this.getCalendarContext();
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
    for (const [toolName, toolDef] of Object.entries(driveTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = await this.getDriveContext();
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

  // ── Notion tools registration ───────────────────
  private async registerNotionTools() {
    for (const [toolName, toolDef] of Object.entries(notionTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = await this.getNotionContext();
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

  // ── Slack tools registration ────────────────────
  private async registerSlackTools() {
    for (const [toolName, toolDef] of Object.entries(slackTools)) {
      this.server.registerTool(
        toolName,
        {
          description: toolDef.description,
          inputSchema: toolDef.schema.shape ?? {},
        },
        async (args: z.infer<typeof toolDef.schema>) => {
          const [ctx, authError] = await this.getSlackContext();
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

  // ── Helpers ─────────────────────────────────────────────────
  private generateAuthUrl(provider: string, returnContext?: any): string {
    const baseUrl = this.env.SERVER_URL;
    const url = new URL("/authorize", baseUrl);
    url.searchParams.set("provider", provider);

    // Include Google email in URL
    if (this.props?.email) {
      url.searchParams.set("user", this.props.email);
    }

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

  // Fixed context getters that check KV FIRST, then fall back to props

  private async getGmailContext(): Promise<[any, null] | [null, any]> {
    const userEmail = this.props?.email;
    if (!userEmail) {
      return [null, this.authorizationRequired("gmail", "No Google user found.")];
    }

    const key = `user-providers::${userEmail}`;
    let stored;
    try {
      stored = await this.env.PROVIDERS_KV.get(key);
    } catch (error: any) {
      console.error("Failed to read from KV:", error);
    }

    let gmail;

    if (stored) {
      try {
        const data = JSON.parse(stored);
        gmail = data.providers?.gmail;
      } catch (error: any) {
        console.error("Failed to parse KV data:", error);
      }
    }

    if (!gmail && this.props?.gmailAccessToken) {
      gmail = {
        accessToken: this.props.gmailAccessToken,
        refreshToken: this.props.gmailRefreshToken,
      };
    }

    if (!gmail?.accessToken) {
      return [null, this.authorizationRequired("gmail", "Gmail not connected. Please authorize Gmail integration.")];
    }

    const oauth = new OAuth2Client();
    oauth.setCredentials({
      access_token: gmail.accessToken,
      refresh_token: gmail.refreshToken,
    });

    return [createGmailContext(oauth), null];
  }

  // Similar updates for other context getters...
  private async getCalendarContext(): Promise<[any, null] | [null, any]> {
    const userEmail = this.props?.email;
    if (!userEmail) {
      return [null, this.authorizationRequired("calendar", "No Google user found.")];
    }

    const key = `user-providers::${userEmail}`;
    let stored;
    try {
      stored = await this.env.PROVIDERS_KV.get(key);
    } catch (error: any) {
      console.error("Failed to read from KV:", error);
    }

    let calendar;

    if (stored) {
      try {
        const data = JSON.parse(stored);
        calendar = data.providers?.calendar;
      } catch (error: any) {
        console.error("Failed to parse KV data:", error);
      }
    }

    if (!calendar && this.props?.calendarAccessToken) {
      calendar = {
        accessToken: this.props.calendarAccessToken,
        refreshToken: this.props.calendarRefreshToken,
      };
    }

    if (!calendar?.accessToken) {
      return [null, this.authorizationRequired("calendar", "Google Calendar not connected. Please authorize Calendar integration.")];
    }

    const oauth = new OAuth2Client();
    oauth.setCredentials({
      access_token: calendar.accessToken,
      refresh_token: calendar.refreshToken,
    });

    return [createCalendarContext(oauth), null];
  }

  private async getDriveContext(): Promise<[any, null] | [null, any]> {
    const userEmail = this.props?.email;
    if (!userEmail) {
      return [null, this.authorizationRequired("calendar", "No Google user found.")];
    }

    const key = `user-providers::${userEmail}`;
    let stored;
    try {
      stored = await this.env.PROVIDERS_KV.get(key);
    } catch (error: any) {
      console.error("Failed to read from KV:", error);
    }

    let drive;

    if (stored) {
      try {
        const data = JSON.parse(stored);
        drive = data.providers?.drive;
      } catch (error: any) {
        console.error("Failed to parse KV data:", error);
      }
    }

    if (!drive && this.props?.driveAccessToken) {
      drive = {
        accessToken: this.props.driveAccessToken,
        refreshToken: this.props.driveRefreshToken,
      };
    }

    if (!drive?.accessToken) {
      return [null, this.authorizationRequired("drive", "Google Drive not connected. Please authorize Drive integration.")];
    }

    const oauth = new OAuth2Client();
    oauth.setCredentials({
      access_token: drive.accessToken,
      refresh_token: drive.refreshToken,
    });

    return [createDriveContext(oauth), null];
  }

  private async getNotionContext(): Promise<[any, null] | [null, any]> {
    const userEmail = this.props?.email;
    if (!userEmail) {
      return [null, this.authorizationRequired("calendar", "No Google user found.")];
    }

    const key = `user-providers::${userEmail}`;
    let stored;
    try {
      stored = await this.env.PROVIDERS_KV.get(key);
    } catch (error: any) {
      console.error("Failed to read from KV:", error);
    }

    let notion;

    if (stored) {
      try {
        const data = JSON.parse(stored);
        notion = data.providers?.notion;
      } catch (error: any) {
        console.error("Failed to parse KV data:", error);
      }
    }

    if (!notion && this.props?.notionAccessToken) {
      notion = {
        accessToken: this.props.notionAccessToken,
        refreshToken: this.props.notionRefreshToken,
      };
    }

    if (!notion?.accessToken) {
      return [null, this.authorizationRequired("notion", "Notion not connected. Please authorize Notion integration.")];
    }

    return [createNotionContext(notion.accessToken), null];
  }

  private async getSlackContext(): Promise<[any, null] | [null, any]> {
    const userEmail = this.props?.email;
    if (!userEmail) {
      return [null, this.authorizationRequired("calendar", "No Google user found.")];
    }

    const key = `user-providers::${userEmail}`;
    let stored;
    try {
      stored = await this.env.PROVIDERS_KV.get(key);
    } catch (error: any) {
      console.error("Failed to read from KV:", error);
    }

    let slack;

    if (stored) {
      try {
        const data = JSON.parse(stored);
        slack = data.providers?.slack;
      } catch (error: any) {
        console.error("Failed to parse KV data:", error);
      }
    }

    if (!slack && this.props?.slackAccessToken) {
      slack = {
        accessToken: this.props.slackAccessToken,
        refreshToken: this.props.slackRefreshToken,
      };
    }

    if (!slack?.accessToken) {
      return [null, this.authorizationRequired("slack", "Slack not connected. Please authorize Slack integration.")];
    }

    return [createSlackContext(slack.accessToken), null];
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
