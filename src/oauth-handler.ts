import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { Octokit } from "octokit";
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
  const authHeader = c.req.header("Authorization");
  const currentToken = authHeader?.replace("Bearer ", "");

  let existingProps: Props | null = null;
  if (currentToken) {
    try {
      const decoded = await c.env.OAUTH_PROVIDER.verifyToken(currentToken);
      existingProps = decoded.props as Props;
    } catch (err) {
      console.error("Failed to decode existing token:", err);
    }
  }

  const stateData = {
    oauthReqInfo: {} as AuthRequest,
    requestedProvider: provider,
    isDirect: true,
    currentToken,
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
      requestedProvider: requestedProvider || "github",
    };
    const { stateToken } = await createOAuthState(stateData, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    return redirectToProvider(c.req.raw, stateToken, requestedProvider || "github", {
      "Set-Cookie": sessionBindingCookie,
    });
  }

  const { token: csrfToken, setCookie } = generateCSRFProtection();

  const integrations = [];
  const requestedScopes = oauthReqInfo.scope || [];

  if (requestedProvider) {
    integrations.push(requestedProvider.charAt(0).toUpperCase() + requestedProvider.slice(1));
  } else {
    integrations.push("GitHub");
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
      logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
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
      requestedProvider: state.requestedProvider || "github",
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
    case "github":
      authUrl = getUpstreamAuthorizeUrl({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: new URL("/callback/github", request.url).href,
        scope: "read:user user:email",
        state: stateToken,
        upstream_url: "https://github.com/login/oauth/authorize",
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

function resolveGitHubIdentity(userData: { login: string; name: string; email: string }, existingProps?: Props) {
  if ((!userData.login || userData.login === "unknown-user") && existingProps?.login) {
    return {
      login: existingProps.login,
      name: existingProps.name || userData.name,
      email: existingProps.email || userData.email,
    };
  }
  return userData;
}

/**
 * Unified OAuth Callback Handler for all providers
 */
app.get("/callback/:provider", async (c) => {
  const provider = c.req.param("provider") as "github" | "gmail" | "calendar" | "drive" | "notion" | "slack";

  const supported = ["github", "gmail", "calendar", "drive", "notion", "slack"] as const;
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

  // Start with GitHub identity if present
  let userData = existingProps
    ? {
        login: existingProps.login,
        name: existingProps.name,
        email: existingProps.email || "",
      }
    : {
        login: "unknown-user",
        name: "Unknown User",
        email: "",
      };

  // Start with existing providers
  const mergedProviders: Record<string, { accessToken: string; refreshToken?: string }> = {};

  if (existingProps) {
    if (existingProps.accessToken) {
      mergedProviders.github = { accessToken: existingProps.accessToken };
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

  // =====================================================
  // Provider-specific token exchange
  // =====================================================
  try {
    if (provider === "github") {
      const [tokenResult, err] = await fetchUpstreamAuthToken({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code: c.req.query("code"),
        redirect_uri: callbackUrl,
        upstream_url: "https://github.com/login/oauth/access_token",
      });

      if (err) {
        console.error("GitHub token exchange failed:", err);
        return err;
      }

      const accessToken = tokenResult.access_token;

      const octokit = new Octokit({ auth: accessToken });
      const { data: ghUser } = await octokit.rest.users.getAuthenticated();

      userData = {
        login: ghUser.login,
        name: ghUser.name || ghUser.login,
        email: ghUser.email || "",
      };

      mergedProviders.github = { accessToken };
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

      const data = (await res.json()) as any;
      if (!data.ok) {
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

  // Enforce GitHub identity anchor
  userData = resolveGitHubIdentity(userData, existingProps);

  // Persist providers ONLY when GitHub exists
  if (userData.login && userData.login !== "unknown-user") {
    try {
      const key = `user-providers::${userData.login}`;
      const existing = await c.env.PROVIDERS_KV.get(key);

      let providersToSave = { ...mergedProviders };
      let integrationsToSave = [...(existingProps?.connectedIntegrations || []), provider];

      if (existing) {
        const parsed = JSON.parse(existing);
        providersToSave = {
          ...(parsed.providers || {}),
          ...mergedProviders, // NEW TOKENS WIN
        };
        integrationsToSave = [...(parsed.connectedIntegrations || []), provider];
      }

      await c.env.PROVIDERS_KV.put(
        key,
        JSON.stringify({
          providers: providersToSave,
          connectedIntegrations: Array.from(new Set(integrationsToSave)),
          userData,
          updatedAt: new Date().toISOString(),
        }),
        { expirationTtl: 7776000 }, // 90 days
      );
    } catch (kvError: any) {
      console.error("Failed to persist providers to KV:", kvError);
      // Continue anyway - token is still valid for this session
    }
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
    userData?: { login: string; name: string; email: string };
    connectedIntegrations: string[];
    clearSessionCookie?: string;
    isDirect?: boolean;
  },
) {
  const {
    oauthReqInfo = {} as AuthRequest,
    providers,
    userData = { login: "user", name: "User", email: "" },
    connectedIntegrations,
    clearSessionCookie,
    isDirect = false,
  } = params;

  // ───────────────────────────────────────────────────────────────
  // Load persisted providers if this is a standard GitHub flow
  // ───────────────────────────────────────────────────────────────
  if (!isDirect && userData.login) {
    const saved = await c.env.PROVIDERS_KV.get(`user-providers::${userData.login}`);

    if (saved) {
      const parsed = JSON.parse(saved);

      // Saved providers first, current flow overwrites
      Object.assign(parsed.providers || {}, providers);
      Object.assign(providers, parsed.providers || {});

      const merged = new Set([...connectedIntegrations, ...(parsed.connectedIntegrations || [])]);

      connectedIntegrations.length = 0;
      connectedIntegrations.push(...merged);

      if (!userData.email && parsed.userData?.email) {
        userData.email = parsed.userData.email;
      }
    }
  }

  const accessToken = providers.github?.accessToken || "";

  if (isDirect && !oauthReqInfo.redirectUri) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
            .card { background: white; padding: 3rem; border-radius: 8px; box-shadow: 0 8px 36px 8px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
            h1 { color: #10b981; margin: 0 0 1rem 0; }
            p { color: #555; line-height: 1.6; }
            strong { color: #111; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✓ Authorization Successful</h1>
            <p>You have successfully connected <strong>${connectedIntegrations.join(", ")}</strong>.</p>
            <p><strong>Important:</strong> To use this integration, please <strong>re-authorize your MCP client</strong> (refresh your connection in the MCP app). This will update your session with all connected services.</p>
            <p>You can now close this window.</p>
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
      login: userData.login,
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
    userId: userData.login,
  });

  const headers = new Headers({ Location: redirectTo });
  if (clearSessionCookie) {
    headers.set("Set-Cookie", clearSessionCookie);
  }

  return new Response(null, { status: 302, headers });
}

export { app as OAuthHandler };
