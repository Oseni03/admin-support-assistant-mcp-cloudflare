import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils";
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from "./workers-oauth-utils";
import { createDbClient, type DbClient } from "./db/client";
import { IntegrationService } from "./services/integrations";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

interface NotionTokenResponse {
  access_token: string;
  refresh_token: string;
  bot_id: string;
  workspace_name: string;
  workspace_icon: string;
  workspace_id: string;
  owner?: {
    type: string;
    name?: any;
    person?: { email: string };
  };
}

/**
 * Handle direct provider authorization (when user clicks auth link from tool response)
 */
async function handleDirectProviderAuth(c: any, provider: string) {
  const googleEmail = c.req.query("user"); // Read from URL parameter (now email)

  console.log("=== DIRECT AUTH DEBUG ===");
  console.log("Provider:", provider);
  console.log("Google email from URL:", googleEmail);
  console.log("DB binding exists:", !!c.env.DB);

  let existingProps: Props | null = null;

  if (googleEmail) {
    try {
      // Check if D1 binding exists
      if (!c.env.DB) {
        console.error("❌ D1 Database binding 'DB' not found in environment");
        console.error("Make sure wrangler.toml has:");
        console.error("[[d1_databases]]");
        console.error('binding = "DB"');
        console.error('database_name = "your-database-name"');
        console.error('database_id = "xxxx-xxxx-xxxx"');

        // Fall back to creating minimal props
        existingProps = {
          email: googleEmail,
          name: googleEmail,
          accessToken: "",
          connectedIntegrations: [],
        } as Props;
      } else {
        const db = createDbClient(c.env.DB);
        const integrationService = new IntegrationService(db);

        // Get user from database
        const user = await db.query.user.findFirst({
          where: eq(schema.user.email, googleEmail),
        });

        if (user) {
          console.log("✅ Found existing user in database:", user.id);

          // Get all user integrations
          const integrations = await integrationService.getUserIntegrations(user.id);

          existingProps = {
            email: user.email,
            name: user.name,
            accessToken: "",
            connectedIntegrations: integrations.map((i) => i.provider),
          } as Props;

          // Map integrations to Props structure
          for (const integration of integrations) {
            if (integration.provider === "google") {
              existingProps.accessToken = integration.accessToken;
            } else if (integration.provider === "gmail") {
              existingProps.gmailAccessToken = integration.accessToken;
              existingProps.gmailRefreshToken = integration.refreshToken || undefined;
            } else if (integration.provider === "calendar") {
              existingProps.calendarAccessToken = integration.accessToken;
              existingProps.calendarRefreshToken = integration.refreshToken || undefined;
            } else if (integration.provider === "drive") {
              existingProps.driveAccessToken = integration.accessToken;
              existingProps.driveRefreshToken = integration.refreshToken || undefined;
            } else if (integration.provider === "notion") {
              existingProps.notionAccessToken = integration.accessToken;
            } else if (integration.provider === "slack") {
              existingProps.slackAccessToken = integration.accessToken;
            }
          }

          console.log("Loaded existing integrations:", existingProps.connectedIntegrations);
        } else {
          console.log("⚠️ No existing user found in database");
          console.log("User should authenticate with Google first");

          existingProps = {
            email: googleEmail,
            name: googleEmail,
            accessToken: "",
            connectedIntegrations: [],
          } as Props;
        }
      }
    } catch (err: any) {
      console.error("❌ Failed to load from database:", err);
      console.error("Error details:", {
        message: err.message,
        stack: err.stack,
        name: err.name,
      });

      // Create fallback props
      existingProps = {
        email: googleEmail,
        name: googleEmail,
        accessToken: "",
        connectedIntegrations: [],
      } as Props;
    }
  } else {
    console.error("❌ No Google email in URL - cannot proceed with incremental auth");
    console.error("User must have authenticated with Google first");
  }

  console.log("Final existingProps:", existingProps);
  console.log("======================");

  const stateData = {
    oauthReqInfo: {} as AuthRequest,
    requestedProvider: provider,
    isDirect: true,
    existingProps,
  };

  const { stateToken } = await createOAuthState(stateData, c.env.OAUTH_KV);
  const { setCookie } = await bindStateToSession(stateToken);

  return redirectToProvider(c.req.raw, stateToken, provider, { "Set-Cookie": setCookie });
}

/**
 * Authorization endpoint - handles both standard MCP OAuth and direct provider auth
 */
app.get("/authorize", async (c) => {
  const requestedProvider = c.req.query("provider");

  if (requestedProvider && !c.req.query("client_id")) {
    return handleDirectProviderAuth(c, requestedProvider);
  }

  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  if (await isClientApproved(c.req.raw, clientId, env.COOKIE_ENCRYPTION_KEY)) {
    const stateData = {
      oauthReqInfo,
      requestedProvider: requestedProvider || "google",
    };
    const { stateToken } = await createOAuthState(stateData, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    return redirectToProvider(c.req.raw, stateToken, requestedProvider || "google", {
      "Set-Cookie": sessionBindingCookie,
    });
  }

  const { token: csrfToken, setCookie } = generateCSRFProtection();

  const integrations = [];
  const requestedScopes = oauthReqInfo.scope || [];

  if (requestedProvider) {
    integrations.push(requestedProvider.charAt(0).toUpperCase() + requestedProvider.slice(1));
  } else {
    integrations.push("Google");
    if (requestedScopes.includes("gmail")) integrations.push("Gmail");
    if (requestedScopes.includes("calendar")) integrations.push("Google Calendar");
    if (requestedScopes.includes("drive")) integrations.push("Google Drive");
    if (requestedScopes.includes("notion")) integrations.push("Notion");
    if (requestedScopes.includes("slack")) integrations.push("Slack");
  }

  const description = requestedProvider
    ? `Connect your ${requestedProvider.charAt(0).toUpperCase() + requestedProvider.slice(1)} account to use additional features.`
    : `This MCP Server will connect to: ${integrations.join(", ")}`;

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: {
      description,
      name: "Multi-Integration MCP Server",
    },
    setCookie,
    state: { oauthReqInfo, requestedProvider },
  });
});

app.post("/authorize", async (c) => {
  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);

    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state in form data", 400);
    }

    let state: { oauthReqInfo?: AuthRequest; requestedProvider?: string };
    try {
      state = JSON.parse(atob(encodedState));
    } catch {
      return c.text("Invalid state data", 400);
    }

    if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
      return c.text("Invalid request", 400);
    }

    const approvedClientCookie = await addApprovedClient(c.req.raw, state.oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY);

    const stateData = {
      oauthReqInfo: state.oauthReqInfo,
      requestedProvider: state.requestedProvider || "google",
    };
    const { stateToken } = await createOAuthState(stateData, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    const headers = new Headers();
    headers.append("Set-Cookie", approvedClientCookie);
    headers.append("Set-Cookie", sessionBindingCookie);

    return redirectToProvider(c.req.raw, stateToken, stateData.requestedProvider, Object.fromEntries(headers));
  } catch (error: any) {
    console.error("POST /authorize error:", error);
    if (error instanceof OAuthError) return error.toResponse();
    return c.text(`Internal server error: ${error.message}`, 500);
  }
});

/**
 * Unified redirect helper to any provider's authorization URL
 */
async function redirectToProvider(request: Request, stateToken: string, provider: string, headers: Record<string, string> = {}) {
  let authUrl: string;

  switch (provider) {
    case "google":
      authUrl = getUpstreamAuthorizeUrl({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: new URL("/callback/google", request.url).href,
        scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        state: stateToken,
        upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
        access_type: "offline",
        prompt: "consent",
      });
      break;

    case "gmail":
      authUrl = getUpstreamAuthorizeUrl({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: new URL("/callback/gmail", request.url).href,
        scope: "https://www.googleapis.com/auth/gmail.modify",
        state: stateToken,
        upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
        access_type: "offline",
        prompt: "consent",
      });
      break;

    case "calendar":
      authUrl = getUpstreamAuthorizeUrl({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: new URL("/callback/calendar", request.url).href,
        scope: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events"].join(" "),
        state: stateToken,
        upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
        access_type: "offline",
        prompt: "consent",
      });
      break;

    case "drive":
      authUrl = getUpstreamAuthorizeUrl({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: new URL("/callback/drive", request.url).href,
        scope: "https://www.googleapis.com/auth/drive",
        state: stateToken,
        upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
        access_type: "offline",
        prompt: "consent",
      });
      break;

    case "notion":
      authUrl = getUpstreamAuthorizeUrl({
        client_id: env.NOTION_CLIENT_ID,
        redirect_uri: new URL("/callback/notion", request.url).href,
        scope: "", // Notion doesn't use scope parameter in the same way
        state: stateToken,
        upstream_url: "https://api.notion.com/v1/oauth/authorize",
      });
      break;

    case "slack":
      authUrl = getUpstreamAuthorizeUrl({
        client_id: env.SLACK_CLIENT_ID,
        redirect_uri: new URL("/callback/slack", request.url).href,
        scope: [
          "channels:read",
          "channels:write",
          "channels:history",
          "chat:write",
          "files:write",
          "groups:read",
          "groups:write",
          "groups:history",
          "im:history",
          "im:read",
          "im:write",
          "mpim:history",
          "mpim:read",
          "mpim:write",
          "reactions:write",
          "search:read",
          "users:read",
        ].join(","),
        state: stateToken,
        upstream_url: "https://slack.com/oauth/v2/authorize",
      });
      break;

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      Location: authUrl,
    },
  });
}

function resolveGoogleIdentity(userData: { email: string; name: string }, existingProps?: Props) {
  if ((!userData.email || userData.email === "unknown-user@example.com") && existingProps?.email) {
    return {
      name: existingProps.name || userData.name,
      email: existingProps.email,
    };
  }
  return userData;
}

/**
 * Unified OAuth Callback Handler for all providers
 */
app.get("/callback/:provider", async (c) => {
  const provider = c.req.param("provider") as "google" | "gmail" | "calendar" | "drive" | "notion" | "slack";

  const supported = ["google", "gmail", "calendar", "drive", "notion", "slack"] as const;
  if (!supported.includes(provider)) {
    return c.text(`Unsupported provider: ${provider}`, 400);
  }

  let stateData: any;
  let clearSessionCookie: string;

  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    stateData = result.data;
    clearSessionCookie = result.clearCookie;
  } catch (err: any) {
    console.error("State validation error:", err);
    if (err instanceof OAuthError) return err.toResponse();
    return c.text("Invalid OAuth state", 400);
  }

  const callbackUrl = new URL(`/callback/${provider}`, c.req.url).href;
  const existingProps = stateData.existingProps as Props | undefined;

  console.log("=== CALLBACK DEBUG ===");
  console.log("Provider:", provider);
  console.log("existingProps:", existingProps ? "exists" : "null");
  console.log("existingProps.email:", existingProps?.email);
  console.log("===================");

  // Start with Google identity if present
  let userData = existingProps
    ? {
        email: existingProps.email,
        name: existingProps.name,
      }
    : {
        email: "unknown-user@example.com",
        name: "Unknown User",
      };

  // Start with existing providers
  const mergedProviders: Record<string, { accessToken: string; refreshToken?: string }> = {};

  if (existingProps) {
    if (existingProps.accessToken) {
      mergedProviders.google = { accessToken: existingProps.accessToken };
    }
    if (existingProps.gmailAccessToken) {
      mergedProviders.gmail = {
        accessToken: existingProps.gmailAccessToken,
        refreshToken: existingProps.gmailRefreshToken,
      };
    }
    if (existingProps.calendarAccessToken) {
      mergedProviders.calendar = {
        accessToken: existingProps.calendarAccessToken,
        refreshToken: existingProps.calendarRefreshToken,
      };
    }
    if (existingProps.driveAccessToken) {
      mergedProviders.drive = {
        accessToken: existingProps.driveAccessToken,
        refreshToken: existingProps.driveRefreshToken,
      };
    }
    if (existingProps.notionAccessToken) {
      mergedProviders.notion = {
        accessToken: existingProps.notionAccessToken,
        refreshToken: existingProps.notionRefreshToken,
      };
    }
    if (existingProps.slackAccessToken) {
      mergedProviders.slack = {
        accessToken: existingProps.slackAccessToken,
        refreshToken: existingProps.slackRefreshToken,
      };
    }
  }

  // Provider-specific token exchange
  try {
    if (provider === "google") {
      const [tokenResult, err] = await fetchUpstreamAuthToken({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code: c.req.query("code"),
        redirect_uri: callbackUrl,
        upstream_url: "https://oauth2.googleapis.com/token",
      });

      if (err) {
        console.error("Google token exchange failed:", err);
        return err;
      }

      const accessToken = tokenResult.access_token;

      const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!userInfoResponse.ok) {
        console.error("Failed to fetch Google user info");
        return c.text("Failed to fetch user information", 500);
      }

      const userInfo = (await userInfoResponse.json()) as any;

      userData = {
        email: userInfo.email,
        name: userInfo.name || userInfo.email,
      };

      mergedProviders.google = {
        accessToken,
        refreshToken: tokenResult.refresh_token,
      };

      // ============================================================
      // CRITICAL: Create user immediately upon Google authentication
      // ============================================================
      console.log("=== GOOGLE AUTH - CREATING USER ===");
      try {
        const db = createDbClient(c.env.DB);

        // Check if user exists
        let user = await db.query.user.findFirst({
          where: eq(schema.user.email, userData.email),
        });

        if (!user) {
          console.log("Creating new user for:", userData.email);
          const userId = crypto.randomUUID();

          await db.insert(schema.user).values({
            id: userId,
            email: userData.email,
            name: userData.name,
            emailVerified: true, // Google has already verified the email
            image: userInfo.picture || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          console.log("✅ User created successfully:", userId);

          // Fetch the newly created user
          user = await db.query.user.findFirst({
            where: eq(schema.user.email, userData.email),
          });
        } else {
          console.log("User already exists:", user.id);

          // Update user info if changed
          await db
            .update(schema.user)
            .set({
              name: userData.name,
              image: userInfo.picture || user.image,
              emailVerified: true,
              updatedAt: new Date(),
            })
            .where(eq(schema.user.id, user.id));

          console.log("✅ User updated successfully");
        }

        // Save Google integration immediately
        if (user) {
          const integrationService = new IntegrationService(db);

          await integrationService.saveIntegration({
            userId: user.id,
            provider: "google",
            accessToken: accessToken,
            refreshToken: tokenResult.refresh_token,
            scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
          });

          console.log("✅ Google integration saved");
        }
      } catch (dbError: any) {
        console.error("❌ Failed to create user during Google auth:", dbError);
        // Don't fail the auth flow, but log the error
      }
      console.log("=================================");
    } else if (provider === "slack") {
      const res = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: c.env.SLACK_CLIENT_ID,
          client_secret: c.env.SLACK_CLIENT_SECRET,
          code: c.req.query("code") || "",
          redirect_uri: callbackUrl,
        }),
      });

      if (!res.ok) {
        console.error("Slack token exchange HTTP error:", res.status, res.statusText);
        return c.text(`Slack OAuth error: ${res.statusText}`, 500);
      }

      const data = (await res.json()) as any;

      if (!data.ok) {
        console.error("Slack OAuth API error:", data);
        return c.text(`Slack OAuth error: ${data.error}`, 500);
      }

      mergedProviders.slack = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      };
    } else if (provider === "notion") {
      const res = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${c.env.NOTION_CLIENT_ID}:${c.env.NOTION_CLIENT_SECRET}`)}`,
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: c.req.query("code"),
          redirect_uri: callbackUrl,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Notion token exchange failed:", res.status, errorText);
        return c.text(`Notion OAuth error: ${errorText}`, 500);
      }

      const data = (await res.json()) as any;

      if (!data.access_token) {
        console.error("Notion response missing access_token:", data);
        return c.text("Notion OAuth error: missing access token", 500);
      }

      mergedProviders.notion = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      };
    } else {
      // Google providers (gmail / calendar / drive)
      const [tokenData, err] = await fetchUpstreamAuthToken({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code: c.req.query("code"),
        redirect_uri: callbackUrl,
        upstream_url: "https://oauth2.googleapis.com/token",
      });

      if (err) {
        console.error(`${provider} token exchange failed:`, err);
        return err;
      }

      mergedProviders[provider] = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      };
    }
  } catch (error: any) {
    console.error(`Error during ${provider} token exchange:`, error);
    return c.text(`Internal server error during ${provider} authorization: ${error.message}`, 500);
  }

  // Enforce Google identity anchor
  userData = resolveGoogleIdentity(userData, existingProps);

  console.log("=== DATABASE SAVE DEBUG ===");
  console.log("Provider:", provider);
  console.log("userData.email:", userData.email);
  console.log("mergedProviders:", JSON.stringify(mergedProviders, null, 2));
  console.log("===================");

  // Persist to database (for non-Google providers)
  // Google provider already saved the user and integration above
  if (userData.email && userData.email !== "unknown-user@example.com" && provider !== "google") {
    try {
      const db = createDbClient(c.env.DB);
      const integrationService = new IntegrationService(db);

      // Find user (should exist from Google auth)
      let user = await db.query.user.findFirst({
        where: eq(schema.user.email, userData.email),
      });

      if (!user) {
        console.warn("⚠️ User not found for incremental auth. This shouldn't happen!");
        console.warn("Creating user as fallback...");

        const userId = crypto.randomUUID();
        await db.insert(schema.user).values({
          id: userId,
          email: userData.email,
          name: userData.name,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        user = await db.query.user.findFirst({
          where: eq(schema.user.email, userData.email),
        });
      }

      if (!user) {
        throw new Error("Failed to create or retrieve user");
      }

      console.log("Saving integration for user:", user.id);

      // Save the current provider's integration
      const currentProvider = mergedProviders[provider];
      if (currentProvider) {
        await integrationService.saveIntegration({
          userId: user.id,
          provider: provider,
          accessToken: currentProvider.accessToken,
          refreshToken: currentProvider.refreshToken,
          scope: undefined, // Provider-specific scope if needed
        });

        console.log(`✅ ${provider} integration saved`);
      }

      // Verify save
      const savedIntegrations = await integrationService.getUserIntegrations(user.id);
      console.log(
        "Verified integrations:",
        savedIntegrations.map((i) => i.provider),
      );
    } catch (dbError: any) {
      console.error("❌ Failed to persist to database:", dbError);
      console.error("Error details:", {
        message: dbError.message,
        stack: dbError.stack,
        name: dbError.name,
      });
      // Don't fail the auth flow, but log the error
    }
  } else if (provider === "google") {
    console.log("ℹ️ Google provider - user already created and saved above");
  } else {
    console.error("❌ Cannot save to database - invalid user email:", userData.email);
  }

  return completeAuthorization(c, {
    ...stateData,
    providers: Object.fromEntries(Object.entries(mergedProviders).filter(([, v]) => v)),
    userData,
    connectedIntegrations: Array.from(new Set([...(existingProps?.connectedIntegrations || []), provider])),
    clearSessionCookie,
  });
});

/**
 * Finalize authorization and issue MCP token
 */
async function completeAuthorization(
  c: any,
  params: {
    oauthReqInfo?: AuthRequest;
    providers: Record<string, any>;
    userData?: { email: string; name: string };
    connectedIntegrations: string[];
    clearSessionCookie?: string;
    isDirect?: boolean;
  },
) {
  const {
    oauthReqInfo = {} as AuthRequest,
    providers,
    userData = { email: "user@example.com", name: "User" },
    connectedIntegrations,
    clearSessionCookie,
    isDirect = false,
  } = params;

  // Load persisted providers from database if standard Google flow
  if (!isDirect && userData.email) {
    try {
      const db = createDbClient(c.env.DB);
      const integrationService = new IntegrationService(db);

      const user = await db.query.user.findFirst({
        where: eq(schema.user.email, userData.email),
      });

      if (user) {
        const savedIntegrations = await integrationService.getUserIntegrations(user.id);

        // Merge saved integrations with current ones
        for (const integration of savedIntegrations) {
          if (!providers[integration.provider]) {
            providers[integration.provider] = {
              accessToken: integration.accessToken,
              refreshToken: integration.refreshToken,
            };
          }
        }

        // Update connected integrations list
        const allIntegrations = new Set([...connectedIntegrations, ...savedIntegrations.map((i) => i.provider)]);

        connectedIntegrations.length = 0;
        connectedIntegrations.push(...allIntegrations);
      }
    } catch (error: any) {
      console.error("Error loading from database:", error);
    }
  }

  const accessToken = providers.google?.accessToken || "";

  if (isDirect && !oauthReqInfo.redirectUri) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fff; color: #000; }
            .card { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
            h1 { color: #000; margin: 0 0 1rem 0; }
            p { line-height: 1.5; margin-bottom: 1rem; }
            strong { font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Authorization Successful</h1>
            <p>You have successfully connected <strong>${connectedIntegrations.join(", ")}</strong>.</p>
            <p>You can now return to the application to continue.</p>
          </div>
        </body>
      </html>
    `;

    const headers = new Headers({ "Content-Type": "text/html" });
    if (clearSessionCookie) headers.set("Set-Cookie", clearSessionCookie);

    return new Response(html, { status: 200, headers });
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: {
      label: `${userData.name} (${connectedIntegrations.join(", ")})`,
    },
    props: {
      accessToken,
      email: userData.email,
      name: userData.name,
      gmailAccessToken: providers.gmail?.accessToken,
      gmailRefreshToken: providers.gmail?.refreshToken,
      calendarAccessToken: providers.calendar?.accessToken,
      calendarRefreshToken: providers.calendar?.refreshToken,
      driveAccessToken: providers.drive?.accessToken,
      driveRefreshToken: providers.drive?.refreshToken,
      notionAccessToken: providers.notion?.accessToken,
      slackAccessToken: providers.slack?.accessToken,
      slackRefreshToken: providers.slack?.refreshToken,
      connectedIntegrations,
      workerUrl: new URL(c.req.url).origin,
    } as Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope || [],
    userId: userData.email,
  });

  const headers = new Headers({ Location: redirectTo });
  if (clearSessionCookie) {
    headers.set("Set-Cookie", clearSessionCookie);
  }

  return new Response(null, { status: 302, headers });
}

export { app as OAuthHandler };
