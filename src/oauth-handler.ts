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

/**
 * Handle direct provider authorization (when user clicks auth link from tool response)
 */
async function handleDirectProviderAuth(c: any, provider: string) {
  const authHeader = c.req.header("Authorization");
  const currentToken = authHeader?.replace("Bearer ", "");

  // For direct auth, create minimal state (no full oauthReqInfo needed)
  const stateData = {
    oauthReqInfo: {} as AuthRequest, // dummy for direct flow
    requestedProvider: provider,
    isDirect: true,
    currentToken, // optional: for future incremental support if needed
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

  // Direct provider authorization (from tool response link)
  if (requestedProvider && !c.req.query("client_id")) {
    return handleDirectProviderAuth(c, requestedProvider);
  }

  // Standard MCP OAuth flow
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  // If client already approved → skip consent screen
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

  // Show consent screen with CSRF protection
  const { token: csrfToken, setCookie } = generateCSRFProtection();

  // Determine which integrations are being requested
  const integrations = [];
  const requestedScopes = oauthReqInfo.scope || [];

  if (requestedProvider) {
    integrations.push(requestedProvider.charAt(0).toUpperCase() + requestedProvider.slice(1));
  } else {
    integrations.push("GitHub");
    if (requestedScopes.includes("gmail")) integrations.push("Gmail");
    if (requestedScopes.includes("calendar")) integrations.push("Google Calendar");
    if (requestedScopes.includes("drive")) integrations.push("Google Drive");
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

/**
 * Unified OAuth Callback Handler for all providers
 */
app.get("/callback/:provider", async (c) => {
  const provider = c.req.param("provider");

  // Supported providers
  const supported = ["github", "gmail", "calendar", "drive"];
  if (!supported.includes(provider)) {
    return c.text(`Unsupported provider: ${provider}`, 400);
  }

  // Validate state (secure, one-time use, session-bound)
  let stateData: any;
  let clearSessionCookie: string;

  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    stateData = result.data; // now contains oauthReqInfo, requestedProvider, isDirect, etc.
    clearSessionCookie = result.clearCookie;
  } catch (error: any) {
    if (error instanceof OAuthError) return error.toResponse();
    return c.text("Internal server error", 500);
  }

  const callbackUrl = new URL(`/callback/${provider}`, c.req.url).href;

  // Exchange code for tokens
  let accessToken: string;
  let refreshToken: string | undefined;

  if (provider === "github") {
    const [token, err] = await fetchUpstreamAuthToken({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code: c.req.query("code"),
      redirect_uri: callbackUrl,
      upstream_url: "https://github.com/login/oauth/access_token",
    });
    if (err) return err;

    accessToken = token;

    // Fetch GitHub user info
    const user = await new Octokit({ auth: accessToken }).rest.users.getAuthenticated();
    const { login, name, email } = user.data;

    return completeAuthorization(c, {
      ...stateData,
      providers: { github: { accessToken } },
      userData: { login, name: name || login, email: email || "" },
      connectedIntegrations: ["github"],
      clearSessionCookie,
    });
  } else {
    // Google providers (gmail, calendar, drive)
    const [tokenResponse, errResponse] = await fetchUpstreamAuthToken({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code: c.req.query("code"),
      redirect_uri: callbackUrl,
      upstream_url: "https://oauth2.googleapis.com/token",
    });

    if (errResponse) return errResponse;

    if (typeof tokenResponse === "string" && tokenResponse.startsWith("{")) {
      const tokenData = JSON.parse(tokenResponse);
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;
    } else {
      accessToken = tokenResponse;
    }

    return completeAuthorization(c, {
      ...stateData,
      providers: {
        ...(stateData.providers || {}),
        [provider]: { accessToken, refreshToken },
      },
      connectedIntegrations: [...(stateData.connectedIntegrations || []), provider],
      clearSessionCookie,
    });
  }
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

  const accessToken = providers.github?.accessToken || "";

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

  return new Response(null, {
    status: 302,
    headers,
  });
}

export { app as OAuthHandler };
