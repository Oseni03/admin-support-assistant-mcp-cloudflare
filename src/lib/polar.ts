import { Polar } from "@polar-sh/sdk";

export function createPolarClient(env: Env) {
  return new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
  });
}
