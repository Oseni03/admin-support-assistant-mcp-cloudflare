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

// Store pending multi-auth flows
interface PendingAuth {
  githubToken: string;
  userData: {
    login: string;
    name: string;
    email: string;
  };
  oauthRequest: AuthRequest;
  completedProviders: string[];
  requestedProvider?: string;
  existingProps?: Props; // For incremental auth
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

/**
 * Handle direct provider authorization (when user clicks auth link from tool response)
 */
async function handleDirectProviderAuth(c: any, provider: string, context?: string) {
  // For direct authorization, we need to capture the user's current MCP session
  // so we can merge the new credentials with their existing session

  // Extract the current MCP token from Authorization header if present
  const authHeader = c.req.header("Authorization");
  const currentToken = authHeader?.replace("Bearer ", "");

  if (provider === "gmail") {
    // Create a pending auth entry for Gmail
    const pendingKey = crypto.randomUUID();
    const pendingAuth: PendingAuth = {
      githubToken: "",
      userData: { login: "gmail-user", name: "Gmail User", email: "" },
      oauthRequest: {} as AuthRequest,
      completedProviders: [],
      requestedProvider: "gmail",
      existingProps: currentToken ? ({ currentToken } as any) : undefined,
    };

    await c.env.OAUTH_KV.put(`pending:${pendingKey}`, JSON.stringify(pendingAuth), { expirationTtl: 600 });

    // Redirect directly to Google OAuth for Gmail
    const gmailAuthUrl = getUpstreamAuthorizeUrl({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: new URL("/callback/gmail", c.req.url).href, // Different callback
      scope: "https://www.googleapis.com/auth/gmail.modify",
      state: pendingKey,
      upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
      access_type: "offline",
      prompt: "consent",
    });

    return c.redirect(gmailAuthUrl);
  }

  // ── NEW: Google Calendar support ───────────────────────────────────────
  if (provider === "calendar") {
    const pendingKey = crypto.randomUUID();
    const pendingAuth: PendingAuth = {
      githubToken: "",
      userData: { login: "calendar-user", name: "Calendar User", email: "" },
      oauthRequest: {} as AuthRequest,
      completedProviders: [],
      requestedProvider: "calendar",
      existingProps: currentToken ? ({ currentToken } as any) : undefined,
    };

    await c.env.OAUTH_KV.put(`pending:${pendingKey}`, JSON.stringify(pendingAuth), { expirationTtl: 600 });

    // Redirect directly to Google OAuth for Calendar
    const calendarAuthUrl = getUpstreamAuthorizeUrl({
      client_id: c.env.GOOGLE_CLIENT_ID, // same client ID as Gmail (Google allows multiple scopes)
      redirect_uri: new URL("/callback/calendar", c.req.url).href,
      scope: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events"].join(" "),
      state: pendingKey,
      upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
      access_type: "offline",
      prompt: "consent",
    });

    return c.redirect(calendarAuthUrl);
  }

  return c.text(`Unknown provider: ${provider}`, 400);
}

/**
 * Authorization endpoint - handles both initial auth and incremental auth
 */
app.get("/authorize", async (c) => {
  // Check for specific provider request (incremental auth via direct URL)
  const requestedProvider = c.req.query("provider");
  const context = c.req.query("context");

  // If this is a direct provider authorization (not from MCP OAuth flow)
  if (requestedProvider && !c.req.query("client_id")) {
    return handleDirectProviderAuth(c, requestedProvider, context);
  }

  // Standard MCP OAuth flow
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  // Check if client is already approved
  if (await isClientApproved(c.req.raw, clientId, env.COOKIE_ENCRYPTION_KEY)) {
    // Skip approval dialog but still create secure state and bind to session
    const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    // If specific provider requested, go directly to that provider
    if (requestedProvider === "gmail") {
      return redirectToGmail(c.req.raw, stateToken, oauthReqInfo, { "Set-Cookie": sessionBindingCookie });
    }
    if (requestedProvider === "calendar") {
      return redirectToCalendar(c.req.raw, stateToken, oauthReqInfo, { "Set-Cookie": sessionBindingCookie });
    }

    // Default to GitHub
    return redirectToGithub(c.req.raw, stateToken, { "Set-Cookie": sessionBindingCookie });
  }

  // Generate CSRF protection for the approval form
  const { token: csrfToken, setCookie } = generateCSRFProtection();

  // Parse requested scopes to show what integrations will be connected
  const requestedScopes = oauthReqInfo.scope;
  const integrations = [];

  if (requestedProvider === "gmail") {
    integrations.push("Gmail");
  } else if (requestedProvider === "github") {
    integrations.push("GitHub");
  } else if (requestedProvider === "calendar") {
    integrations.push("Calendar");
  } else {
    // Default flow - GitHub first
    integrations.push("GitHub");
    if (requestedScopes.includes("gmail")) {
      integrations.push("Gmail (after GitHub)");
    }
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
    // Read form data once
    const formData = await c.req.raw.formData();

    // Validate CSRF token
    validateCSRFToken(formData, c.req.raw);

    // Extract state from form data
    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state in form data", 400);
    }

    let state: { oauthReqInfo?: AuthRequest; requestedProvider?: string };
    try {
      state = JSON.parse(atob(encodedState));
    } catch (_e) {
      return c.text("Invalid state data", 400);
    }

    if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
      return c.text("Invalid request", 400);
    }

    // Add client to approved list
    const approvedClientCookie = await addApprovedClient(c.req.raw, state.oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY);

    // Create OAuth state and bind it to this user's session
    const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    // Set both cookies: approved client list + session binding
    const headers = new Headers();
    headers.append("Set-Cookie", approvedClientCookie);
    headers.append("Set-Cookie", sessionBindingCookie);

    // Redirect to the appropriate provider
    if (state.requestedProvider === "gmail") {
      return redirectToGmail(c.req.raw, stateToken, state.oauthReqInfo, Object.fromEntries(headers));
    }
    if (state.requestedProvider === "calendar") {
      return redirectToCalendar(c.req.raw, stateToken, state.oauthReqInfo, Object.fromEntries(headers));
    }

    return redirectToGithub(c.req.raw, stateToken, Object.fromEntries(headers));
  } catch (error: any) {
    console.error("POST /authorize error:", error);
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text(`Internal server error: ${error.message}`, 500);
  }
});

async function redirectToGithub(request: Request, stateToken: string, headers: Record<string, string> = {}) {
  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: new URL("/callback", request.url).href,
        scope: "read:user user:email",
        state: stateToken,
        upstream_url: "https://github.com/login/oauth/authorize",
      }),
    },
    status: 302,
  });
}

async function redirectToGmail(request: Request, stateToken: string, oauthReqInfo: AuthRequest, headers: Record<string, string> = {}) {
  // Store the OAuth request info for Gmail-only flow
  const pendingKey = crypto.randomUUID();
  const pendingAuth: PendingAuth = {
    githubToken: "", // Empty for Gmail-only flow
    userData: { login: "gmail-user", name: "Gmail User", email: "" },
    oauthRequest: oauthReqInfo,
    completedProviders: [],
    requestedProvider: "gmail",
  };

  // Store in KV with the pendingKey (not stateToken)
  await env.OAUTH_KV.put(`pending:${pendingKey}`, JSON.stringify(pendingAuth), { expirationTtl: 600 });

  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: new URL("/callback/gmail", request.url).href,
        scope: "https://www.googleapis.com/auth/gmail.modify",
        state: pendingKey, // Use pendingKey as state for Gmail OAuth
        upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
        access_type: "offline",
        prompt: "consent",
      }),
    },
    status: 302,
  });
}

/**
 * Redirect to Google Calendar OAuth consent screen
 * Used when the user needs to authorize Calendar (either standalone or after GitHub)
 */
async function redirectToCalendar(request: Request, stateToken: string, oauthReqInfo: AuthRequest, headers: Record<string, string> = {}) {
  // Store the OAuth request info for Calendar-only or incremental flow
  const pendingKey = crypto.randomUUID();
  const pendingAuth: PendingAuth = {
    githubToken: "", // Empty for Calendar-only flow
    userData: { login: "calendar-user", name: "Calendar User", email: "" },
    oauthRequest: oauthReqInfo,
    completedProviders: [],
    requestedProvider: "calendar",
  };

  // Store in KV using the pendingKey (not stateToken)
  await env.OAUTH_KV.put(`pending:${pendingKey}`, JSON.stringify(pendingAuth), { expirationTtl: 600 });

  return new Response(null, {
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: new URL("/callback/calendar", request.url).href, // ← Main Calendar callback
        scope: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events"].join(" "),
        state: pendingKey, // Use pendingKey as state for Google OAuth
        upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
        access_type: "offline",
        prompt: "consent",
      }),
    },
    status: 302,
  });
}

/**
 * OAuth Callback Endpoint - Step 1: GitHub Authentication
 */
app.get("/callback", async (c) => {
  // Validate OAuth state with session binding
  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;

  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error: any) {
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text("Internal server error", 500);
  }

  if (!oauthReqInfo.clientId) {
    return c.text("Invalid OAuth request data", 400);
  }

  // Exchange the code for a GitHub access token
  const [accessToken, errResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.GITHUB_CLIENT_ID,
    client_secret: c.env.GITHUB_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
    upstream_url: "https://github.com/login/oauth/access_token",
  });
  if (errResponse) return errResponse;

  // Fetch the user info from GitHub
  const user = await new Octokit({ auth: accessToken }).rest.users.getAuthenticated();
  const { login, name, email } = user.data;

  // Check if Gmail integration is requested in scopes
  const requestedScopes = oauthReqInfo.scope;
  const needsGmail = requestedScopes.includes("gmail");

  if (needsGmail) {
    // Store GitHub auth data temporarily and redirect to Gmail
    const pendingKey = crypto.randomUUID();
    const pendingAuth: PendingAuth = {
      githubToken: accessToken,
      userData: { login, name: name || login, email: email || "" },
      oauthRequest: oauthReqInfo,
      completedProviders: ["github"],
    };

    await c.env.OAUTH_KV.put(`pending:${pendingKey}`, JSON.stringify(pendingAuth), { expirationTtl: 600 });

    // Redirect to Gmail OAuth
    const gmailAuthUrl = getUpstreamAuthorizeUrl({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: new URL("/callback/gmail", c.req.url).href,
      scope: "https://www.googleapis.com/auth/gmail.modify",
      state: pendingKey,
      upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
      access_type: "offline",
      prompt: "consent",
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: gmailAuthUrl,
        ...(clearSessionCookie ? { "Set-Cookie": clearSessionCookie } : {}),
      },
    });
  }

  // No additional providers needed, complete authorization with GitHub only
  return completeAuthorization(c, {
    accessToken,
    login,
    name: name || login,
    email: email || "",
    clearSessionCookie,
    oauthReqInfo,
    connectedIntegrations: ["github"],
    workerUrl: new URL(c.req.url).origin,
  });
});

/**
 * Gmail OAuth Callback - Handles both incremental auth and initial multi-provider flow
 */
/**
 * Unified Google Callback Handler
 * Handles callbacks for Gmail, Calendar, Drive, etc.
 * Supports both:
 *   - Standalone / direct auth
 *   - Chained multi-provider flow (GitHub → Google provider)
 */
app.get("/callback/:provider", async (c) => {
  const provider = c.req.param("provider"); // "gmail", "calendar", "drive", etc.

  // Validate supported providers
  const supportedProviders = ["gmail", "calendar", "drive"];
  if (!supportedProviders.includes(provider)) {
    return c.text(`Unsupported provider: ${provider}`, 400);
  }

  const pendingKey = c.req.query("state");
  const code = c.req.query("code");

  if (!pendingKey || !code) {
    return c.text("Missing state or code parameter", 400);
  }

  // Retrieve pending auth data
  const pendingData = await c.env.OAUTH_KV.get(`pending:${pendingKey}`);
  if (!pendingData) {
    return c.text("Invalid or expired authorization state", 400);
  }

  const pending: PendingAuth = JSON.parse(pendingData);

  // Determine the scopes and token variable names based on provider
  let scopeName: string;
  let accessTokenVar: keyof Props;
  let refreshTokenVar: keyof Props;
  let providerDisplayName: string;

  switch (provider) {
    case "gmail":
      scopeName = "gmail";
      accessTokenVar = "gmailAccessToken";
      refreshTokenVar = "gmailRefreshToken";
      providerDisplayName = "Gmail";
      break;
    case "calendar":
      scopeName = "calendar";
      accessTokenVar = "calendarAccessToken";
      refreshTokenVar = "calendarRefreshToken";
      providerDisplayName = "Google Calendar";
      break;
    // case "drive":
    //   scopeName = "drive";
    //   accessTokenVar = "driveAccessToken";
    //   refreshTokenVar = "driveRefreshToken";
    //   providerDisplayName = "Google Drive";
    //   break;
    default:
      return c.text("Internal provider configuration error", 500);
  }

  const callbackUrl = new URL(`/callback/${provider}`, c.req.url).href;
  console.log("Callback URI used:", callbackUrl);

  // Exchange code for tokens
  const [tokenResponse, errResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.GOOGLE_CLIENT_ID,
    client_secret: c.env.GOOGLE_CLIENT_SECRET,
    code,
    redirect_uri: callbackUrl,
    upstream_url: "https://oauth2.googleapis.com/token",
  });

  console.log("Token exchange response:", tokenResponse);

  if (errResponse) {
    // Log the full error for debugging
    const errorText = await errResponse.text();
    console.error("Token exchange failed:", errorText);
    return errResponse;
  }

  // Parse tokens
  let accessToken: string;
  let refreshToken: string | undefined;

  if (typeof tokenResponse === "string" && tokenResponse.startsWith("{")) {
    const tokenData = JSON.parse(tokenResponse);
    accessToken = tokenData.access_token;
    refreshToken = tokenData.refresh_token;
  } else {
    accessToken = tokenResponse;
  }

  // Clean up pending auth
  await c.env.OAUTH_KV.delete(`pending:${pendingKey}`);

  // Determine if this is standalone (direct) auth or chained
  const isStandalone = !pending.githubToken || pending.requestedProvider === scopeName;

  if (isStandalone) {
    // Standalone flow: create session with just this Google provider
    const props: Partial<Props> = {
      [accessTokenVar]: accessToken,
      [refreshTokenVar]: refreshToken,
      connectedIntegrations: [scopeName],
      workerUrl: new URL(c.req.url).origin,
    };

    return completeAuthorization(c, {
      accessToken: "", // No GitHub token
      login: `${scopeName}-user`,
      name: `${providerDisplayName} User`,
      email: "",
      clearSessionCookie: "",
      oauthReqInfo: pending.oauthRequest || ({} as AuthRequest),
      connectedIntegrations: [scopeName],
      workerUrl: new URL(c.req.url).origin,
      ...props,
    });
  }

  // Chained flow: complete with GitHub + this Google provider
  const props: Partial<Props> = {
    [accessTokenVar]: accessToken,
    [refreshTokenVar]: refreshToken,
    connectedIntegrations: ["github", scopeName],
  };

  return completeAuthorization(c, {
    accessToken: pending.githubToken,
    login: pending.userData.login,
    name: pending.userData.name,
    email: pending.userData.email,
    clearSessionCookie: "",
    oauthReqInfo: pending.oauthRequest,
    connectedIntegrations: ["github", scopeName],
    workerUrl: new URL(c.req.url).origin,
    ...props,
  });
});

/**
 * Complete standard authorization flow
 */
async function completeAuthorization(
  c: any,
  params: {
    accessToken: string;
    login: string;
    name: string;
    email: string;
    gmailAccessToken?: string;
    gmailRefreshToken?: string;
    calendarAccessToken?: string;
    calendarRefreshToken?: string;
    clearSessionCookie: string;
    oauthReqInfo: AuthRequest;
    connectedIntegrations: string[];
    workerUrl: string;
  },
) {
  const {
    accessToken,
    login,
    name,
    email,
    gmailAccessToken,
    gmailRefreshToken,
    calendarAccessToken,
    calendarRefreshToken,
    clearSessionCookie,
    oauthReqInfo,
    connectedIntegrations,
    workerUrl,
  } = params;

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: {
      label: `${name} (${connectedIntegrations.join(", ")})`,
    },
    props: {
      accessToken,
      email,
      login,
      name,
      gmailAccessToken,
      gmailRefreshToken,
      calendarAccessToken,
      calendarRefreshToken,
      connectedIntegrations,
      workerUrl,
    } as Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: login,
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
