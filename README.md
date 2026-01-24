# Model Context Protocol (MCP) Server + Multi-Integration OAuth

This is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server that supports remote MCP connections, with Google OAuth and multiple service integrations built-in.

You can deploy it to your own Cloudflare account, and after you create your OAuth client apps, you'll have a fully functional remote MCP server with access to Gmail, Google Calendar, Google Drive, Notion, and Slack. Users authenticate with their Google account and can incrementally add additional service integrations.

You can use this as a reference example for how to integrate multiple OAuth providers with an MCP server deployed to Cloudflare, using the [`workers-oauth-provider` library](https://github.com/cloudflare/workers-oauth-provider).

The MCP server (powered by [Cloudflare Workers](https://developers.cloudflare.com/workers/)):

- Acts as OAuth _Server_ to your MCP clients
- Acts as OAuth _Client_ to multiple OAuth providers (Google, Notion, Slack)
- Uses Cloudflare D1 for persistent user data and integration management
- Supports incremental OAuth flows for adding services on-demand

> [!WARNING]
> This is a demo template designed to help you get started quickly. While we have implemented several security controls, **you must implement all preventive and defense-in-depth security measures before deploying to production**. Please review our comprehensive security guide: [Securing MCP Servers](https://github.com/cloudflare/agents/blob/main/docs/securing-mcp-servers.md)

## Features

- 🔐 **Google OAuth Authentication** - Primary authentication using Google accounts
- 📧 **Gmail Integration** - Send, read, search, and manage emails
- 📅 **Google Calendar** - Create, update, and manage calendar events
- 📁 **Google Drive** - Access and manage files in Google Drive
- 📝 **Notion Integration** - Access and manage Notion pages and databases
- 💬 **Slack Integration** - Send messages and manage Slack workspaces
- 🗄️ **D1 Database** - Persistent storage for user data and integrations
- 🔄 **Incremental Auth** - Add integrations as needed, not all at once
- 💳 **Billing Ready** - Database schema supports subscription and usage tracking

## Getting Started

Clone the repo and install dependencies:

```bash
git clone <your-repo-url>
cd <your-repo>
npm install
```

## Setup Instructions

### 1. Create OAuth Applications

#### Google OAuth App

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Google+ API (for user profile)
   - Gmail API
   - Google Calendar API
   - Google Drive API
4. Create OAuth 2.0 credentials:
   - **Application type**: Web application
   - **Authorized redirect URIs**:
     - Development: `http://localhost:8787/callback/google`, `http://localhost:8787/callback/gmail`, `http://localhost:8787/callback/calendar`, `http://localhost:8787/callback/drive`
     - Production: `https://<your-worker>.workers.dev/callback/google`, `https://<your-worker>.workers.dev/callback/gmail`, etc.
5. Note your **Client ID** and **Client Secret**

#### Notion OAuth App

1. Go to [Notion Developers](https://www.notion.so/my-integrations)
2. Create a new integration
3. Set the **Redirect URI** to:
   - Development: `http://localhost:8787/callback/notion`
   - Production: `https://<your-worker>.workers.dev/callback/notion`
4. Note your **OAuth Client ID** and **OAuth Client Secret**

#### Slack OAuth App

1. Go to [Slack API](https://api.slack.com/apps)
2. Create a new app
3. Under **OAuth & Permissions**, add redirect URLs:
   - Development: `http://localhost:8787/callback/slack`
   - Production: `https://<your-worker>.workers.dev/callback/slack`
4. Add the following **Bot Token Scopes**:
   - `channels:read`, `channels:write`, `channels:history`
   - `chat:write`, `files:write`
   - `groups:read`, `groups:write`, `groups:history`
   - `im:read`, `im:write`, `im:history`
   - `mpim:read`, `mpim:write`, `mpim:history`
   - `reactions:write`, `search:read`, `users:read`
5. Note your **Client ID** and **Client Secret**

### 2. Set Up Cloudflare Resources

#### Create KV Namespaces

```bash
# OAuth state storage
wrangler kv namespace create "OAUTH_KV"

# Provider token storage (optional - can use D1 instead)
wrangler kv namespace create "PROVIDERS_KV"
```

Update `wrangler.toml` with the returned IDs.

#### Create D1 Database

```bash
# Create the database
wrangler d1 create my-mcp-database
```

This will output:

```toml
[[d1_databases]]
binding = "DB"
database_name = "my-mcp-database"
database_id = "xxxx-xxxx-xxxx-xxxx"
```

Add this to your `wrangler.toml`.

#### Run Database Migrations

```bash
# Generate migration files
npx drizzle-kit generate

# Apply migrations locally
wrangler d1 migrations apply my-mcp-database --local

# Apply migrations to production (when ready)
wrangler d1 migrations apply my-mcp-database --remote
```

Verify tables were created:

```bash
wrangler d1 execute my-mcp-database --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```

You should see: `user`, `session`, `account`, `verification`, `integration`, `subscription`, `usage`

### 3. Configure Environment Variables

#### For Local Development

Create a `.dev.vars` file:

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Notion OAuth
NOTION_CLIENT_ID=your_notion_client_id
NOTION_CLIENT_SECRET=your_notion_client_secret

# Slack OAuth
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret

# Auth & Encryption
AUTH_SECRET=your_random_secret_minimum_32_chars
COOKIE_ENCRYPTION_KEY=your_cookie_encryption_key

# Server URL
SERVER_URL=http://localhost:8787
```

Generate secure secrets:

```bash
# Generate AUTH_SECRET
openssl rand -hex 32

# Generate COOKIE_ENCRYPTION_KEY
openssl rand -hex 32
```

#### For Production

Set secrets via Wrangler:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put NOTION_CLIENT_ID
wrangler secret put NOTION_CLIENT_SECRET
wrangler secret put SLACK_CLIENT_ID
wrangler secret put SLACK_CLIENT_SECRET
wrangler secret put AUTH_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY
```

Update `SERVER_URL` in `wrangler.toml`:

```toml
[vars]
SERVER_URL = "https://<your-worker-name>.workers.dev"
```

### 4. Update wrangler.toml

Your complete `wrangler.toml` should look like:

```toml
name = "my-mcp-server"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "my-mcp-database"
database_id = "xxxx-xxxx-xxxx-xxxx"

# KV Namespaces
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "your-oauth-kv-id"

[[kv_namespaces]]
binding = "PROVIDERS_KV"
id = "your-providers-kv-id"

# Environment Variables
[vars]
SERVER_URL = "http://localhost:8787"
```

## Development

### Run Locally

```bash
wrangler dev --local
```

The server will be available at `http://localhost:8787`

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

Enter `http://localhost:8787/sse` and hit connect. You'll be redirected to authenticate with Google.

### Test Database Connection

Visit `http://localhost:8787/test-db` to verify database connectivity.

## Deployment

### Deploy to Production

```bash
# Apply database migrations to production
wrangler d1 migrations apply my-mcp-database --remote

# Deploy the worker
wrangler deploy
```

Your MCP server will be available at `https://<your-worker-name>.workers.dev`

### Update OAuth Redirect URIs

After deploying, update all OAuth app redirect URIs to use your production URL:

- Google: `https://<your-worker>.workers.dev/callback/google`, etc.
- Notion: `https://<your-worker>.workers.dev/callback/notion`
- Slack: `https://<your-worker>.workers.dev/callback/slack`

## Using the MCP Server

### With Claude Desktop

Open Claude Desktop settings: Settings → Developer → Edit Config

Add your MCP server:

```json
{
  "mcpServers": {
    "admin-assistant": {
      "command": "npx",
      "args": ["mcp-remote", "https://<your-worker>.workers.dev/sse"]
    }
  }
}
```

Restart Claude Desktop. You'll be prompted to authenticate with Google.

### With Cursor

In Cursor settings:

- **Type**: Command
- **Command**: `npx mcp-remote https://<your-worker>.workers.dev/sse`

Note: Cursor doesn't support authentication flows, so you'll need to use `mcp-remote`.

### Available Tools

After authentication, the following tools are available:

#### Google Integration

- `userInfoGoogle` - Get authenticated user information

#### Gmail Tools

- `send_email` - Send emails
- `read_email` - Read email content
- `search_emails` - Search emails with Gmail query syntax
- `modify_email` - Move to folders, archive, apply labels
- `delete_email` - Permanently delete emails
- `list_email_labels` - List all Gmail labels
- `create_label`, `update_label`, `delete_label` - Label management
- `batch_modify_emails`, `batch_delete_emails` - Bulk operations

#### Google Calendar Tools

- `create_event` - Create calendar events
- `list_events` - List upcoming events
- `update_event` - Update existing events
- `delete_event` - Delete events
- `list_calendars` - List all calendars

#### Google Drive Tools

- `search_files` - Search for files
- `get_file` - Get file metadata
- `download_file` - Download file content
- `upload_file` - Upload new files
- `create_folder` - Create folders
- `delete_file` - Delete files

#### Notion Tools

- `search_notion` - Search pages and databases
- `get_page` - Get page content
- `create_page` - Create new pages
- `update_page` - Update existing pages

#### Slack Tools

- `send_slack_message` - Send messages to channels
- `list_channels` - List workspace channels
- `search_messages` - Search message history

### Incremental Integration Flow

1. **Initial Setup**: User authenticates with Google
2. **View Integrations**: Use `listIntegrations` tool to see available services
3. **Add Services**: Click "Connect" links to authorize additional services
4. **Use Tools**: Once connected, service-specific tools become available

Example conversation with Claude:

```
You: "List my available integrations"
Claude: [Shows integration dashboard]

You: "I need to send an email"
Claude: "You'll need to connect Gmail first. Please visit [auth link]"

[After connecting Gmail]
You: "Send an email to john@example.com"
Claude: [Uses send_email tool successfully]
```

## Database Schema

The server uses Cloudflare D1 with the following tables:

- **user** - User profiles from Google OAuth
- **session** - Active user sessions
- **account** - OAuth account connections
- **integration** - Service integrations (Gmail, Calendar, etc.)
- **subscription** - User subscription plans (ready for billing)
- **usage** - Usage tracking per user/month

## Security Features

- ✅ CSRF protection with one-time tokens
- ✅ State binding to prevent session fixation
- ✅ Secure cookie handling with HttpOnly and Secure flags
- ✅ OAuth state validation
- ✅ Token encryption in database
- ✅ Email verification via Google OAuth

## Troubleshooting

### "D1 Database binding 'DB' not found"

- Verify `wrangler.toml` has the `[[d1_databases]]` section
- Restart `wrangler dev` after changing `wrangler.toml`
- Check binding name is exactly `"DB"` (case-sensitive)

### "Cannot read properties of undefined (reading 'prepare')"

- Run migrations: `wrangler d1 migrations apply my-mcp-database --local`
- Verify tables exist: `wrangler d1 execute my-mcp-database --local --command "SELECT name FROM sqlite_master WHERE type='table'"`

### "User not found"

- Authenticate with Google first before adding other integrations
- Check database for user: `wrangler d1 execute my-mcp-database --local --command "SELECT * FROM user"`

### "Database locked"

```bash
pkill wrangler
rm -rf .wrangler/state/v3/d1
wrangler dev --local
```

## Project Structure

```
.
├── src/
│   ├── index.ts                 # MCP server and tool registration
│   ├── oauth-handler.ts         # OAuth flow handling
│   ├── workers-oauth-utils.ts   # OAuth utilities
│   ├── db/
│   │   ├── schema.ts           # Database schema
│   │   └── client.ts           # D1 client wrapper
│   ├── services/
│   │   ├── integrations.ts     # Integration management
│   │   └── billing.ts          # Subscription & usage tracking
│   └── tools/
│       ├── gmail/              # Gmail tools
│       ├── google-calendar/    # Calendar tools
│       ├── google-drive/       # Drive tools
│       ├── notion/             # Notion tools
│       └── slack/              # Slack tools
├── drizzle/
│   └── migrations/             # Database migrations
├── wrangler.toml               # Cloudflare configuration
├── drizzle.config.ts           # Drizzle ORM configuration
└── package.json
```

## How Does It Work?

### OAuth Provider

The OAuth Provider library serves as a complete OAuth 2.1 server implementation for Cloudflare Workers. It handles:

- Authenticating MCP clients
- Managing connections to multiple OAuth providers (Google, Notion, Slack)
- Token issuance, validation, and refresh
- Secure token storage in D1 database

### Database Storage

User data and OAuth tokens are persisted in Cloudflare D1:

- **User records** created on Google authentication
- **Integration tokens** stored per user per service
- **Subscriptions** for billing management
- **Usage metrics** for rate limiting and analytics

### Incremental OAuth

Users start with Google authentication, then add services on-demand:

1. Initial Google auth creates user record
2. Additional services added via "Connect" links
3. Each integration saved separately in database
4. Tools become available as integrations are added

### Durable MCP

Extends MCP with Cloudflare's Durable Objects:

- Persistent state management
- Authenticated user context via `this.props`
- Conditional tool availability based on integrations
- Secure communication between clients and server

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

- Open an issue on GitHub
- Check existing issues for solutions
- Review the troubleshooting section above

## Roadmap

- [ ] Add Polar integration for billing
- [ ] Implement rate limiting based on subscription tier
- [ ] Add frontend
- [ ] Implement token refresh automation
