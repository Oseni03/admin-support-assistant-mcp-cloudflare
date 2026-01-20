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

    // Redirect directly to Google OAuth
    const gmailAuthUrl = getUpstreamAuthorizeUrl({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: new URL("/callback/gmail-direct", c.req.url).href, // Different callback
      scope: "https://www.googleapis.com/auth/gmail.modify",
      state: pendingKey,
      upstream_url: "https://accounts.google.com/o/oauth2/v2/auth",
      access_type: "offline",
      prompt: "consent",
    });

    return c.redirect(gmailAuthUrl);
  }

  if (provider === "github") {
    const pendingKey = crypto.randomUUID();
    const pendingAuth: PendingAuth = {
      githubToken: "",
      userData: { login: "", name: "", email: "" },
      oauthRequest: {} as AuthRequest,
      completedProviders: [],
      requestedProvider: "github",
      existingProps: currentToken ? ({ currentToken } as any) : undefined,
    };

    await c.env.OAUTH_KV.put(`pending:${pendingKey}`, JSON.stringify(pendingAuth), { expirationTtl: 600 });

    const githubAuthUrl = getUpstreamAuthorizeUrl({
      client_id: c.env.GITHUB_CLIENT_ID,
      redirect_uri: new URL("/callback/github-direct", c.req.url).href, // Different callback
      scope: "read:user user:email",
      state: pendingKey,
      upstream_url: "https://github.com/login/oauth/authorize",
    });

    return c.redirect(githubAuthUrl);
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

  // Parse the Gmail token response
  let gmailAccessToken: string;
  let gmailRefreshToken: string | undefined;

  if (typeof gmailTokenResponse === "string" && gmailTokenResponse.startsWith("{")) {
    const tokenData = JSON.parse(gmailTokenResponse);
    gmailAccessToken = tokenData.access_token;
    gmailRefreshToken = tokenData.refresh_token;
  } else {
    gmailAccessToken = gmailTokenResponse;
  }

  // Clean up pending auth
  await c.env.OAUTH_KV.delete(`pending:${pendingKey}`);

  // Check if this is Gmail-only auth (no GitHub)
  const isGmailOnly = !pending.githubToken || pending.requestedProvider === "gmail";

  if (isGmailOnly) {
    // Gmail-only flow: create session with just Gmail
    return completeAuthorization(c, {
      accessToken: "", // No GitHub token
      login: "gmail-user",
      name: "Gmail User",
      email: "",
      gmailAccessToken,
      gmailRefreshToken,
      clearSessionCookie: "",
      oauthReqInfo: pending.oauthRequest,
      connectedIntegrations: ["gmail"],
      workerUrl: new URL(c.req.url).origin,
    });
  }

  // Multi-provider flow: Complete with both GitHub + Gmail
  return completeAuthorization(c, {
    accessToken: pending.githubToken,
    login: pending.userData.login,
    name: pending.userData.name,
    email: pending.userData.email,
    gmailAccessToken,
    gmailRefreshToken,
    clearSessionCookie: "",
    oauthReqInfo: pending.oauthRequest,
    connectedIntegrations: ["github", "gmail"],
    workerUrl: new URL(c.req.url).origin,
  });
});

/**
 * Direct Gmail callback - for when user authorizes Gmail via direct link
 */
app.get("/callback/gmail-direct", async (c) => {
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

  // Exchange Gmail code for access token
  const [gmailTokenResponse, errResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.GOOGLE_CLIENT_ID,
    client_secret: c.env.GOOGLE_CLIENT_SECRET,
    code,
    redirect_uri: new URL("/callback/gmail-direct", c.req.url).href,
    upstream_url: "https://oauth2.googleapis.com/token",
  });
  if (errResponse) return errResponse;

  // Parse tokens
  let gmailAccessToken: string;
  let gmailRefreshToken: string | undefined;

  if (typeof gmailTokenResponse === "string" && gmailTokenResponse.startsWith("{")) {
    const tokenData = JSON.parse(gmailTokenResponse);
    gmailAccessToken = tokenData.access_token;
    gmailRefreshToken = tokenData.refresh_token;
  } else {
    gmailAccessToken = gmailTokenResponse;
  }

  // Clean up pending auth
  await c.env.OAUTH_KV.delete(`pending:${pendingKey}`);

  // Show success page with instructions
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Gmail Authorization Successful</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
            width: 100%;
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
          }
          .checkmark {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: white;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
          }
          h1 { font-size: 24px; margin-bottom: 10px; }
          .subtitle { opacity: 0.9; font-size: 14px; }
          .content {
            padding: 30px;
          }
          .step {
            display: flex;
            margin-bottom: 20px;
            align-items: flex-start;
          }
          .step-number {
            background: #667eea;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            flex-shrink: 0;
            margin-right: 12px;
          }
          .step-text {
            flex: 1;
            padding-top: 4px;
          }
          .token-info {
            background: #f3f4f6;
            border-radius: 8px;
            padding: 15px;
            margin-top: 20px;
            font-size: 13px;
            color: #6b7280;
          }
          .token-value {
            font-family: monospace;
            font-size: 11px;
            background: #e5e7eb;
            padding: 8px;
            border-radius: 4px;
            margin-top: 8px;
            word-break: break-all;
          }
          .close-btn {
            width: 100%;
            background: #667eea;
            color: white;
            border: none;
            padding: 14px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 20px;
            transition: background 0.2s;
          }
          .close-btn:hover {
            background: #5568d3;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="checkmark">✓</div>
            <h1>Gmail Connected!</h1>
            <div class="subtitle">Your Gmail account has been successfully authorized</div>
          </div>
          <div class="content">
            <div class="step">
              <div class="step-number">1</div>
              <div class="step-text">Return to your AI assistant (Claude, ChatGPT, etc.)</div>
            </div>
            <div class="step">
              <div class="step-number">2</div>
              <div class="step-text">Retry the Gmail action you were trying to perform</div>
            </div>
            <div class="step">
              <div class="step-number">3</div>
              <div class="step-text">Your Gmail tools should now work seamlessly!</div>
            </div>
            
            <div class="token-info">
              <strong>📝 For developers:</strong>
              <div class="token-value">Access Token: ${gmailAccessToken.substring(0, 20)}...${gmailAccessToken.substring(gmailAccessToken.length - 10)}</div>
              ${gmailRefreshToken ? `<div class="token-value" style="margin-top:8px">Refresh Token: Available ✓</div>` : ""}
            </div>

            <button class="close-btn" onclick="window.close()">Close This Window</button>
          </div>
        </div>
      </body>
    </html>
  `);
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
