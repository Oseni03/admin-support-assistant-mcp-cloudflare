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
  requestedScopes: string[];
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/authorize", async (c) => {
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
    return redirectToGithub(c.req.raw, stateToken, { "Set-Cookie": sessionBindingCookie });
  }

  // Generate CSRF protection for the approval form
  const { token: csrfToken, setCookie } = generateCSRFProtection();

  // Parse requested scopes to show what integrations will be connected
  const requestedScopes = oauthReqInfo.scope;
  const integrations = [];

  if (requestedScopes.includes("github") || requestedScopes.length === 0) {
    integrations.push("GitHub");
  }
  if (requestedScopes.includes("gmail")) {
    integrations.push("Gmail");
  }

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: {
      description: `This MCP Server will connect to: ${integrations.join(", ")}`,
      logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
      name: "Multi-Integration MCP Server",
    },
    setCookie,
    state: { oauthReqInfo },
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

    let state: { oauthReqInfo?: AuthRequest };
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

    return redirectToGithub(c.req.raw, stateToken, Object.fromEntries(headers));
  } catch (error: any) {
    console.error("POST /authorize error:", error);
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    // Unexpected non-OAuth error
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
        scope: "read:user",
        state: stateToken,
        upstream_url: "https://github.com/login/oauth/authorize",
      }),
    },
    status: 302,
  });
}

/**
 * OAuth Callback Endpoint - Step 1: GitHub Authentication
 *
 * This route handles the callback from GitHub after user authentication.
 * It checks if additional OAuth providers are needed and either:
 * 1. Redirects to the next provider (e.g., Gmail)
 * 2. Completes the authorization flow with all tokens
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

  // Check if Gmail integration is requested
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
      requestedScopes,
    };

    // Store for 10 minutes
    await c.env.OAUTH_KV.put(`pending:${pendingKey}`, JSON.stringify(pendingAuth), { expirationTtl: 600 });

    // Redirect to Gmail OAuth
    const gmailAuthUrl = getUpstreamAuthorizeUrl({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: new URL("/callback/gmail", c.req.url).href,
      scope: "https://www.googleapis.com/auth/gmail.modify",
      state: pendingKey,
      upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
      // Request offline access to get refresh token
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

  // No additional providers needed, complete authorization
  return completeAuthorization(c, {
    accessToken,
    login,
    name: name || login,
    email: email || "",
    clearSessionCookie,
    oauthReqInfo,
    connectedIntegrations: ["github"],
  });
});

/**
 * Gmail OAuth Callback - Step 2: Gmail Authentication
 *
 * This handles the callback from Google after Gmail authorization.
 * It retrieves the stored GitHub data and completes the full authorization.
 */
app.get("/callback/gmail", async (c) => {
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

  // Exchange Gmail code for access token
  const [gmailTokenResponse, errResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.GOOGLE_CLIENT_ID,
    client_secret: c.env.GOOGLE_CLIENT_SECRET,
    code,
    redirect_uri: new URL("/callback/gmail", c.req.url).href,
    upstream_url: "https://oauth2.googleapis.com/token",
  });
  if (errResponse) return errResponse;

  // Parse the Gmail token response (it includes refresh_token)
  let gmailAccessToken: string;
  let gmailRefreshToken: string | undefined;

  if (typeof gmailTokenResponse === "string") {
    // Parse the response to extract tokens
    const tokenData = JSON.parse(gmailTokenResponse);
    gmailAccessToken = tokenData.access_token;
    gmailRefreshToken = tokenData.refresh_token;
  } else {
    gmailAccessToken = gmailTokenResponse;
  }

  // Clean up pending auth
  await c.env.OAUTH_KV.delete(`pending:${pendingKey}`);

  // Complete authorization with both GitHub and Gmail tokens
  return completeAuthorization(c, {
    accessToken: pending.githubToken,
    login: pending.userData.login,
    name: pending.userData.name,
    email: pending.userData.email,
    gmailAccessToken,
    gmailRefreshToken,
    clearSessionCookie: "", // Already cleared in first callback
    oauthReqInfo: pending.oauthRequest,
    connectedIntegrations: ["github", "gmail"],
  });
});

/**
 * Helper function to complete the OAuth authorization flow
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
    clearSessionCookie: string;
    oauthReqInfo: AuthRequest;
    connectedIntegrations: string[];
  },
) {
  const { accessToken, login, name, email, gmailAccessToken, gmailRefreshToken, clearSessionCookie, oauthReqInfo, connectedIntegrations } =
    params;

  // Return back to the MCP client a new token with all auth data
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    metadata: {
      label: `${name} (${connectedIntegrations.join(", ")})`,
    },
    // This will be available on this.props inside MyMCP
    props: {
      accessToken,
      email,
      login,
      name,
      gmailAccessToken,
      gmailRefreshToken,
      connectedIntegrations,
    } as Props,
    request: oauthReqInfo,
    scope: oauthReqInfo.scope,
    userId: login,
  });

  // Clear the session binding cookie (one-time use)
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
