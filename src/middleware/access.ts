import { createDbClient } from "../db/client";
import { createPolarClient } from "../lib/polar";
import { BillingService } from "../services/billing";
import { IntegrationService } from "../services/integrations";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";

export async function checkToolAccess(env: Env, userEmail: string, toolName: string): Promise<{ allowed: boolean; message?: string }> {
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

    const currentPlan = await billingService.getUserPlan(user.id);
    const canUse = billingService.canUseTool(currentPlan, toolName);

    if (!canUse) {
      // Determine required plan
      let requiredPlan: "pro" | "enterprise" = "pro";

      // Check if it's an enterprise-only tool
      const enterpriseTools = ["batch_modify_emails", "batch_delete_emails"];
      const notionSlackTools = toolName.startsWith("notion_") || toolName.startsWith("slack_");

      if (enterpriseTools.includes(toolName) || notionSlackTools) {
        requiredPlan = "enterprise";
      }

      const upgradeUrl = `${env.SERVER_URL}/billing/checkout?email=${encodeURIComponent(userEmail)}&plan=${requiredPlan}`;
      const upgradeMessage = `This tool requires the ${requiredPlan.toUpperCase()} plan.\n\nUpgrade at: ${upgradeUrl}`;

      return { allowed: false, message: upgradeMessage };
    }

    return { allowed: true };
  } catch (error: any) {
    console.error("Error checking tool access:", error);
    // Fail open in case of errors
    return { allowed: true };
  }
}

export async function checkIntegrationAccess(
  env: Env,
  userEmail: string,
  provider: string,
): Promise<{ allowed: boolean; message?: string }> {
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
    const integrationService = new IntegrationService(db);

    const currentPlan = await billingService.getUserPlan(user.id);
    const integrations = await integrationService.getUserIntegrations(user.id);

    const check = billingService.canConnectProvider(currentPlan, provider, integrations.length);

    if (!check.allowed) {
      const requiredPlan = provider === "notion" || provider === "slack" ? "enterprise" : "pro";
      const upgradeUrl = `${env.SERVER_URL}/billing/checkout?email=${encodeURIComponent(userEmail)}&plan=${requiredPlan}`;

      return {
        allowed: false,
        message: `${check.reason}\n\nUpgrade at: ${upgradeUrl}`,
      };
    }

    return { allowed: true };
  } catch (error: any) {
    console.error("Error checking integration access:", error);
    return { allowed: true }; // Fail open
  }
}
