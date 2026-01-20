import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Octokit } from "octokit";
import { z } from "zod";
import { OAuthHandler } from "./github-handler";
import { OAuth2Client } from "google-auth-library";
import {
  GmailTools,
  SendEmailSchema,
  ReadEmailSchema,
  SearchEmailsSchema,
  ModifyEmailSchema,
  DeleteEmailSchema,
  ListEmailLabelsSchema,
  BatchModifyEmailsSchema,
  BatchDeleteEmailsSchema,
  CreateLabelSchema,
  UpdateLabelSchema,
  DeleteLabelSchema,
  GetOrCreateLabelSchema,
} from "./tools/gmail";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
  gmailAccessToken?: string;
  gmailRefreshToken?: string;
  connectedIntegrations: string[];
  // Store the worker URL for generating auth URLs
  workerUrl?: string;
};

const ALLOWED_USERNAMES = new Set<string>([
  // Add GitHub usernames of users who should have access to the image generation tool
  // For example: 'yourusername', 'coworkerusername'
]);

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Github OAuth Proxy Demo with Gmail",
    version: "1.0.0",
  });

  async init() {
    // List available integrations and their connection status
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
          description: "Send, read, and manage emails",
        },
        imageGeneration: {
          connected: ALLOWED_USERNAMES.has(this.props!.login),
          enabled: ALLOWED_USERNAMES.has(this.props!.login),
          description: "Generate images using AI",
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(integrations, null, 2),
          },
        ],
      };
    });

    // Basic math tool - always available, no auth required
    this.server.tool("add", "Add two numbers the way only MCP can", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ text: String(a + b), type: "text" }],
    }));

    // Register ALL tools, but they'll check permissions when called
    await this.registerGitHubTools();
    await this.registerGmailTools();
  }

  /**
   * Helper to generate authorization URL for a specific provider
   */
  private generateAuthUrl(provider: string, returnContext?: any): string {
    const baseUrl = this.env.SERVER_URL;
    const url = new URL("/authorize", baseUrl);
    url.searchParams.set("provider", provider);

    if (returnContext) {
      url.searchParams.set("context", btoa(JSON.stringify(returnContext)));
    }

    return url.toString();
  }

  /**
   * Helper to create "authorization required" response
   */
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

  private async registerGitHubTools() {
    // GitHub user info tool
    this.server.registerTool(
      "userInfoOctokit",
      {
        title: "userInfoOctokit",
        description: "Get authenticated user information from GitHub using Octokit",
        // Explicitly declare no input parameters
        inputSchema: z.object({}).strict(),
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        if (!this.props?.accessToken) {
          return this.authorizationRequired("github", "GitHub integration is required to get user information", "userInfoOctokit");
        }

        try {
          const octokit = new Octokit({ auth: this.props.accessToken });
          const user = await octokit.rest.users.getAuthenticated();

          return {
            content: [
              {
                text: JSON.stringify(user.data, null, 2),
                type: "text" as const,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching GitHub user info: ${error.message}`,
              },
            ],
          };
        }
      },
    );
  }

  private async registerGmailTools() {
    // Helper to get Gmail client with auth check
    const getGmailClient = (): [OAuth2Client, null] | [null, any] => {
      if (!this.props?.gmailAccessToken) {
        return [null, this.authorizationRequired("gmail", "Gmail integration is required for this action")];
      }

      const oauth2Client = new OAuth2Client();
      oauth2Client.setCredentials({
        access_token: this.props.gmailAccessToken,
        refresh_token: this.props.gmailRefreshToken,
      });

      return [oauth2Client, null];
    };

    // Send email tool
    this.server.registerTool(
      "send_email",
      {
        description: "Sends a new email via Gmail",
        inputSchema: SendEmailSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.sendEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error sending email: ${error.message}` }],
          };
        }
      },
    );

    // Draft email tool
    this.server.registerTool(
      "draft_email",
      {
        description: "Draft a new email in Gmail",
        inputSchema: SendEmailSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.draftEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error creating draft: ${error.message}` }],
          };
        }
      },
    );

    // Read email tool
    this.server.registerTool(
      "read_email",
      {
        description: "Retrieves the content of a specific email from Gmail",
        inputSchema: ReadEmailSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.readEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error reading email: ${error.message}` }],
          };
        }
      },
    );

    // Search emails tool
    this.server.registerTool(
      "search_emails",
      {
        description: "Searches for emails using Gmail search syntax",
        inputSchema: SearchEmailsSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.searchEmails(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error searching emails: ${error.message}` }],
          };
        }
      },
    );

    // Modify email tool
    this.server.registerTool(
      "modify_email",
      {
        description: "Modifies email labels (move to different folders)",
        inputSchema: ModifyEmailSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.modifyEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error modifying email: ${error.message}` }],
          };
        }
      },
    );

    // Delete email tool
    this.server.registerTool(
      "delete_email",
      {
        description: "Permanently deletes an email from Gmail",
        inputSchema: DeleteEmailSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.deleteEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error deleting email: ${error.message}` }],
          };
        }
      },
    );

    // List email labels tool
    this.server.registerTool(
      "list_email_labels",
      {
        description: "Retrieves all available Gmail labels",
        inputSchema: ListEmailLabelsSchema.shape,
      },
      async () => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.listEmailLabels();
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error listing labels: ${error.message}` }],
          };
        }
      },
    );

    // Batch modify emails tool
    this.server.registerTool(
      "batch_modify_emails",
      {
        description: "Modifies labels for multiple emails in batches",
        inputSchema: BatchModifyEmailsSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.batchModifyEmails(args);
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error batch modifying emails: ${error.message}`,
              },
            ],
          };
        }
      },
    );

    // Batch delete emails tool
    this.server.registerTool(
      "batch_delete_emails",
      {
        description: "Permanently deletes multiple emails in batches",
        inputSchema: BatchDeleteEmailsSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.batchDeleteEmails(args);
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error batch deleting emails: ${error.message}`,
              },
            ],
          };
        }
      },
    );

    // Create label tool
    this.server.registerTool(
      "create_label",
      {
        description: "Creates a new Gmail label",
        inputSchema: CreateLabelSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.createLabel(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error creating label: ${error.message}` }],
          };
        }
      },
    );

    // Update label tool
    this.server.registerTool(
      "update_label",
      {
        description: "Updates an existing Gmail label",
        inputSchema: UpdateLabelSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.updateLabel(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error updating label: ${error.message}` }],
          };
        }
      },
    );

    // Delete label tool
    this.server.registerTool(
      "delete_label",
      {
        description: "Deletes a Gmail label",
        inputSchema: DeleteLabelSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.deleteLabel(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error deleting label: ${error.message}` }],
          };
        }
      },
    );

    // Get or create label tool
    this.server.registerTool(
      "get_or_create_label",
      {
        description: "Gets an existing label by name or creates it if it doesn't exist",
        inputSchema: GetOrCreateLabelSchema.shape,
      },
      async (args) => {
        const [client, authError] = getGmailClient();
        if (!client) return authError;

        try {
          const gmailTools = new GmailTools(client);
          return await gmailTools.getOrCreateLabel(args);
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting or creating label: ${error.message}`,
              },
            ],
          };
        }
      },
    );
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
