import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Octokit } from "octokit";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
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
  gmailAccessToken?: string; // Optional Gmail token if using separate auth
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
    // Hello, world!
    this.server.tool("add", "Add two numbers the way only MCP can", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ text: String(a + b), type: "text" }],
    }));

    // Use the upstream access token to facilitate tools
    this.server.tool("userInfoOctokit", "Get user info from GitHub, via Octokit", {}, async () => {
      const octokit = new Octokit({ auth: this.props!.accessToken });
      return {
        content: [
          {
            text: JSON.stringify(await octokit.rest.users.getAuthenticated()),
            type: "text",
          },
        ],
      };
    });

    // Dynamically add tools based on the user's login. In this case, I want to limit
    // access to my Image Generation tool to just me
    if (ALLOWED_USERNAMES.has(this.props!.login)) {
      this.server.tool(
        "generateImage",
        "Generate an image using the `flux-1-schnell` model. Works best with 8 steps.",
        {
          prompt: z.string().describe("A text description of the image you want to generate."),
          steps: z
            .number()
            .min(4)
            .max(8)
            .default(4)
            .describe(
              "The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive.",
            ),
        },
        async ({ prompt, steps }) => {
          const response = await this.env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
            prompt,
            steps,
          });

          return {
            content: [{ data: response.image!, mimeType: "image/jpeg", type: "image" }],
          };
        },
      );
    }

    // Initialize Gmail tools if access token is available
    if (this.props!.gmailAccessToken) {
      await this.registerGmailTools();
    }
  }

  private async registerGmailTools() {
    // Initialize OAuth2 client for Gmail
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({
      access_token: this.props!.gmailAccessToken,
    });

    const gmailTools = new GmailTools(oauth2Client);

    // Register send_email tool
    this.server.registerTool(
      "send_email",
      {
        description: "Sends a new email",
        inputSchema: SendEmailSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.sendEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error sending email: ${error.message}` }],
          };
        }
      },
    );

    // Register draft_email tool
    this.server.registerTool(
      "draft_email",
      {
        description: "Draft a new email",
        inputSchema: SendEmailSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.draftEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error creating draft: ${error.message}` }],
          };
        }
      },
    );

    // Register read_email tool
    this.server.registerTool(
      "read_email",
      {
        description: "Retrieves the content of a specific email",
        inputSchema: ReadEmailSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.readEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error reading email: ${error.message}` }],
          };
        }
      },
    );

    // Register search_emails tool
    this.server.registerTool(
      "search_emails",
      {
        description: "Searches for emails using Gmail search syntax",
        inputSchema: SearchEmailsSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.searchEmails(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error searching emails: ${error.message}` }],
          };
        }
      },
    );

    // Register modify_email tool
    this.server.registerTool(
      "modify_email",
      {
        description: "Modifies email labels (move to different folders)",
        inputSchema: ModifyEmailSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.modifyEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error modifying email: ${error.message}` }],
          };
        }
      },
    );

    // Register delete_email tool
    this.server.registerTool(
      "delete_email",
      {
        description: "Permanently deletes an email",
        inputSchema: DeleteEmailSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.deleteEmail(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error deleting email: ${error.message}` }],
          };
        }
      },
    );

    // Register list_email_labels tool
    this.server.registerTool(
      "list_email_labels",
      {
        description: "Retrieves all available Gmail labels",
        inputSchema: ListEmailLabelsSchema.shape,
      },
      async () => {
        try {
          return await gmailTools.listEmailLabels();
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error listing labels: ${error.message}` }],
          };
        }
      },
    );

    // Register batch_modify_emails tool
    this.server.registerTool(
      "batch_modify_emails",
      {
        description: "Modifies labels for multiple emails in batches",
        inputSchema: BatchModifyEmailsSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.batchModifyEmails(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error batch modifying emails: ${error.message}` }],
          };
        }
      },
    );

    // Register batch_delete_emails tool
    this.server.registerTool(
      "batch_delete_emails",
      {
        description: "Permanently deletes multiple emails in batches",
        inputSchema: BatchDeleteEmailsSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.batchDeleteEmails(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error batch deleting emails: ${error.message}` }],
          };
        }
      },
    );

    // Register create_label tool
    this.server.registerTool(
      "create_label",
      {
        description: "Creates a new Gmail label",
        inputSchema: CreateLabelSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.createLabel(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error creating label: ${error.message}` }],
          };
        }
      },
    );

    // Register update_label tool
    this.server.registerTool(
      "update_label",
      {
        description: "Updates an existing Gmail label",
        inputSchema: UpdateLabelSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.updateLabel(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error updating label: ${error.message}` }],
          };
        }
      },
    );

    // Register delete_label tool
    this.server.registerTool(
      "delete_label",
      {
        description: "Deletes a Gmail label",
        inputSchema: DeleteLabelSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.deleteLabel(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error deleting label: ${error.message}` }],
          };
        }
      },
    );

    // Register get_or_create_label tool
    this.server.registerTool(
      "get_or_create_label",
      {
        description: "Gets an existing label by name or creates it if it doesn't exist",
        inputSchema: GetOrCreateLabelSchema.shape,
      },
      async (args) => {
        try {
          return await gmailTools.getOrCreateLabel(args);
        } catch (error: any) {
          return {
            content: [{ type: "text", text: `Error getting or creating label: ${error.message}` }],
          };
        }
      },
    );
  }
}

export default new OAuthProvider({
  // NOTE - during the summer 2025, the SSE protocol was deprecated and replaced by the Streamable-HTTP protocol
  // https://developers.cloudflare.com/agents/model-context-protocol/transport/#mcp-server-with-authentication
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"), // deprecated SSE protocol - use /mcp instead
    "/mcp": MyMCP.serve("/mcp"), // Streamable-HTTP protocol
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});
