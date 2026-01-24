/**
 * Constructs an authorization URL for an upstream service.
 */
export function getUpstreamAuthorizeUrl(params: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  access_type?: string;
  prompt?: string;
  state: string;
}): string {
  const url = new URL(params.upstream_url);
  url.searchParams.set("client_id", params.client_id);
  url.searchParams.set("redirect_uri", params.redirect_uri);
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("response_type", "code");

  if (params.access_type) {
    url.searchParams.set("access_type", params.access_type);
  }
  if (params.prompt) {
    url.searchParams.set("prompt", params.prompt);
  }

  return url.toString();
}

/**
 * Token response structure
 */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Fetches an authorization token from an upstream service.
 * Returns the full token response object for providers that need refresh tokens.
 */
export async function fetchUpstreamAuthToken({
  client_id,
  client_secret,
  code,
  redirect_uri,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  redirect_uri: string;
  client_id: string;
}): Promise<[TokenResponse, null] | [null, Response]> {
  if (!code) {
    return [null, new Response("Missing code", { status: 400 })];
  }

  const bodyParams = new URLSearchParams({
    client_id,
    client_secret,
    code,
    redirect_uri,
    grant_type: "authorization_code",
  });

  console.log("Token request:", {
    url: upstream_url,
    redirect_uri,
    client_id: client_id.substring(0, 10) + "...",
    code_prefix: code.substring(0, 10) + "...",
  });

  const resp = await fetch(upstream_url, {
    body: bodyParams.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error("Token endpoint error:", {
      status: resp.status,
      statusText: resp.statusText,
      body: errorText,
    });
    return [null, new Response(`Failed to fetch access token: ${errorText}`, { status: 500 })];
  }

  // Parse response based on Content-Type
  const contentType = resp.headers.get("content-type") || "";
  let tokenData: TokenResponse;

  try {
    if (contentType.includes("application/json")) {
      // Google and most modern OAuth providers return JSON
      tokenData = await resp.json();
    } else {
      // GitHub returns form-urlencoded
      const formData = await resp.formData();
      tokenData = {
        access_token: formData.get("access_token") as string,
        refresh_token: formData.get("refresh_token") as string | undefined,
        expires_in: formData.get("expires_in") ? parseInt(formData.get("expires_in") as string) : undefined,
        token_type: formData.get("token_type") as string | undefined,
        scope: formData.get("scope") as string | undefined,
      };
    }
  } catch (parseError: any) {
    console.error("Failed to parse token response:", parseError);
    return [null, new Response("Failed to parse token response", { status: 500 })];
  }

  if (!tokenData.access_token) {
    console.error("Missing access_token in response:", tokenData);
    return [null, new Response("Missing access token in response", { status: 400 })];
  }

  return [tokenData, null];
}

// Context from the auth process, encrypted & stored in the auth token
export interface Props {
  [key: string]: unknown; // Index signature

  // Google base auth (replaces GitHub)
  accessToken: string;
  email: string;
  name: string;

  // Gmail integration
  gmailAccessToken?: string;
  gmailRefreshToken?: string;

  // Calendar integration
  calendarAccessToken?: string;
  calendarRefreshToken?: string;

  // Drive integration
  driveAccessToken?: string;
  driveRefreshToken?: string;

  // Notion integration
  notionAccessToken?: string;
  notionRefreshToken?: string;

  // Slack integration
  slackAccessToken?: string;
  slackRefreshToken?: string;

  // Metadata
  connectedIntegrations: string[];
  workerUrl?: string;
}

/**
 * Refreshes a Google OAuth token using a refresh token
 */
export async function refreshGoogleToken(params: {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}): Promise<string | null> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: params.client_id,
        client_secret: params.client_secret,
        refresh_token: params.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Token refresh failed:", {
        status: response.status,
        body: errorText,
      });
      return null;
    }

    const data = (await response.json()) as Record<string, any>;
    return data.access_token;
  } catch (error: any) {
    console.error("Token refresh error:", error);
    return null;
  }
}
