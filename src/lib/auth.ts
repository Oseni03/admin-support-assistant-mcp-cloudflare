import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDbClient } from "../db/client";
import * as schema from "../db/schema";

export function createAuth(env: Env) {
  const db = createDbClient(env.DB);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // Set to true in production
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectURI: `${env.SERVER_URL}/api/auth/callback/google`,
      },
    },
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.SERVER_URL],
  });
}

export type Auth = ReturnType<typeof createAuth>;
