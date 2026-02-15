import { createDbClient } from "../db/client";
import { createPolarClient } from "../lib/polar";
import { BillingService } from "../services/billing";
import { IntegrationService } from "../services/integrations";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";

export async function checkAccess(
  env: Env,
  userEmail: string,
): Promise<{ allowed: boolean; message?: string; status?: string; daysRemaining?: number }> {
  try {
    const db = createDbClient(env.DB);
    const user = await db.query.user.findFirst({
      where: eq(schema.user.email, userEmail),
    });

    if (!user) {
      return { allowed: false, message: "User not found" };
    }

    const polar = createPolarClient(env);
    const billingService = new BillingService(db, polar);

    const access = await billingService.hasActiveAccess(user.id);

    if (!access.hasAccess) {
      const upgradeUrl = `${env.SERVER_URL}/billing/checkout?plan=${user.plan}`;

      return {
        allowed: false,
        status: access.status,
        message: `${access.reason}\n\nStart your subscription: ${upgradeUrl}`,
      };
    }

    return {
      allowed: true,
      status: access.status,
      daysRemaining: access.daysRemaining,
    };
  } catch (error: any) {
    console.error("Error checking access:", error);
    // Fail closed for security
    return {
      allowed: false,
      message: "Unable to verify subscription status. Please try again.",
    };
  }
}

export async function checkToolAccess(env: Env, userEmail: string, toolName: string): Promise<{ allowed: boolean; message?: string }> {
  try {
    // First check if user has any access at all
    const baseAccess = await checkAccess(env, userEmail);
    if (!baseAccess.allowed) {
      return baseAccess;
    }

    const db = createDbClient(env.DB);
    const user = await db.query.user.findFirst({
      where: eq(schema.user.email, userEmail),
    });

    if (!user) {
      return { allowed: false, message: "User not found" };
    }

    const polar = createPolarClient(env);
    const billingService = new BillingService(db, polar);

    const currentPlan = await billingService.getUserPlan(user.id);
    const canUse = billingService.canUseTool(currentPlan, toolName);

    if (!canUse) {
      const upgradeUrl = `${env.SERVER_URL}/billing/checkout?plan=enterprise`;
      return {
        allowed: false,
        message: `This tool requires Enterprise plan.\n\nUpgrade: ${upgradeUrl}`,
      };
    }

    return { allowed: true };
  } catch (error: any) {
    console.error("Error checking tool access:", error);
    return {
      allowed: false,
      message: "Unable to verify tool access. Please try again.",
    };
  }
}

export async function checkIntegrationAccess(
  env: Env,
  userEmail: string,
  provider: string,
): Promise<{ allowed: boolean; message?: string }> {
  try {
    // First check if user has any access at all
    const baseAccess = await checkAccess(env, userEmail);
    if (!baseAccess.allowed) {
      return baseAccess;
    }

    const db = createDbClient(env.DB);
    const user = await db.query.user.findFirst({
      where: eq(schema.user.email, userEmail),
    });

    if (!user) {
      return { allowed: false, message: "User not found" };
    }

    const polar = createPolarClient(env);
    const billingService = new BillingService(db, polar);
    const integrationService = new IntegrationService(db);

    const currentPlan = await billingService.getUserPlan(user.id);
    const integrations = await integrationService.getUserIntegrations(user.id);

    const check = billingService.canConnectProvider(currentPlan, provider, integrations.length);

    if (!check.allowed) {
      const requiredPlan = provider === "notion" || provider === "slack" ? "enterprise" : "pro";
      const upgradeUrl = `${env.SERVER_URL}/billing/checkout?plan=${requiredPlan}`;

      return {
        allowed: false,
        message: `${check.reason}\n\nUpgrade: ${upgradeUrl}`,
      };
    }

    return { allowed: true };
  } catch (error: any) {
    console.error("Error checking integration access:", error);
    return {
      allowed: false,
      message: "Unable to verify integration access. Please try again.",
    };
  }
}
