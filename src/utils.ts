/**
 * Constructs an authorization URL for an upstream service.
 *
 * @param {Object} options
 * @param {string} options.upstream_url - The base URL of the upstream service.
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} options.access_type - The access type of the application.
 * @param {string} options.prompt - The prompt of the application.
 * @param {string} [options.state] - The state parameter.
 *
 * @returns {string} The authorization URL.
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
 * Fetches an authorization token from an upstream service.
 *
 * @param {Object} options
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.client_secret - The client secret of the application.
 * @param {string} options.code - The authorization code.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} options.upstream_url - The token endpoint URL of the upstream service.
 *
 * @returns {Promise<[string, null] | [null, Response]>} A promise that resolves to an array containing the access token or an error response.
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
}): Promise<[string, null] | [null, Response]> {
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
    client_id: client_id.substring(0, 10) + "...", // partial for security
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
    console.error("Google token endpoint error:", {
      status: resp.status,
      body: errorText,
    });
    return [null, new Response(`Failed to fetch access token: ${errorText}`, { status: 500 })];
  }

  const body = await resp.formData();
  const accessToken = body.get("access_token") as string;
  if (!accessToken) {
    return [null, new Response("Missing access token", { status: 400 })];
  }

  return [accessToken, null];
}

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
  gmailAccessToken?: string;
  gmailRefreshToken?: string;
  calendarAccessToken?: string;
  calendarRefreshToken?: string;
  driveAccessToken?: string;
  driveRefreshToken?: string;
  notionAccessToken?: string;
  notionRefreshToken?: string;
  slackAccessToken?: string;
  slackRefreshToken?: string;
  connectedIntegrations: string[];
  workerUrl?: string;
};

/**
 * Refreshes a Google OAuth token using a refresh token
 */
export async function refreshGoogleToken(params: {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}): Promise<string | null> {
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
    console.error("Token refresh failed:", await response.text());
    return null;
  }

  const data = (await response.json()) as Record<string, any>;
  return data.access_token;
}
