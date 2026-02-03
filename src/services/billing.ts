import { eq } from "drizzle-orm";
import { DbClient } from "../db/client";
import { user } from "../db/schema";
import { Polar } from "@polar-sh/sdk";
import { PLANS, PlanTier } from "../lib/plans";

export class BillingService {
  constructor(
    private db: DbClient,
    private polar: Polar,
  ) {}

  // Get user's current plan
  async getUserPlan(userId: string): Promise<PlanTier> {
    const result = await this.db.select().from(user).where(eq(user.id, userId)).limit(1);

    if (!result[0]) return "free";
    return (result[0].plan || "free") as PlanTier;
  }

  // Check if user can use a specific tool
  canUseTool(plan: PlanTier, toolName: string): boolean {
    const planConfig = PLANS[plan];

    // Enterprise has access to all tools
    if (planConfig.allowedTools === "*") {
      return true;
    }

    return planConfig.allowedTools.includes(toolName as any);
  }

  // Check if user can connect a provider
  canConnectProvider(
    plan: PlanTier,
    provider: string,
    currentIntegrationCount: number,
  ): {
    allowed: boolean;
    reason?: string;
  } {
    const planConfig = PLANS[plan];

    // Check provider is allowed for this tier
    if (!planConfig.allowedProviders.includes(provider as any)) {
      return {
        allowed: false,
        reason: `${provider} is only available on Enterprise plan`,
      };
    }

    // Check integration limit
    if (currentIntegrationCount >= planConfig.features.maxIntegrations) {
      return {
        allowed: false,
        reason: `You've reached the maximum of ${planConfig.features.maxIntegrations} integration(s) for ${plan} plan`,
      };
    }

    return { allowed: true };
  }

  // Create checkout URL for upgrade
  async createCheckoutUrl(userId: string, userEmail: string, targetPlan: "pro" | "enterprise", successUrl: string) {
    const planConfig = PLANS[targetPlan];

    if (!planConfig.polarPriceId) {
      throw new Error(`No Polar price ID configured for ${targetPlan} plan`);
    }

    try {
      const checkout = await this.polar.checkouts.create({
        products: [planConfig.polarPriceId],
        customerEmail: userEmail,
        metadata: {
          userId,
          plan: targetPlan,
        },
        successUrl,
      });

      return checkout.url;
    } catch (error: any) {
      console.error("Error creating Polar checkout:", error);
      throw error;
    }
  }

  // Activate paid subscription
  async activateSubscription(params: { userId: string; plan: "pro" | "enterprise"; polarCustomerId: string; polarSubscriptionId: string }) {
    await this.db
      .update(user)
      .set({
        plan: params.plan,
        polarCustomerId: params.polarCustomerId,
        polarSubscriptionId: params.polarSubscriptionId,
        subscriptionStatus: "active",
        updatedAt: new Date(),
      })
      .where(eq(user.id, params.userId));

    console.log(`✅ Activated ${params.plan} subscription for user ${params.userId}`);
  }

  // Cancel subscription (revert to free)
  async cancelSubscription(userId: string) {
    const result = await this.db.select().from(user).where(eq(user.id, userId)).limit(1);

    const currentUser = result[0];
    if (!currentUser?.polarSubscriptionId) {
      throw new Error("No active subscription found");
    }

    // Cancel in Polar
    await this.polar.subscriptions.revoke({
      id: currentUser.polarSubscriptionId,
    });

    // Update database
    await this.db
      .update(user)
      .set({
        plan: "free",
        subscriptionStatus: "canceled",
        subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Grace period
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId));

    console.log(`✅ Canceled subscription for user ${userId}`);
  }

  // Get upgrade prompt message
  getUpgradeMessage(currentPlan: PlanTier, requiredPlan: PlanTier, serverUrl: string): string {
    if (requiredPlan === "pro") {
      return `⚠️ This feature requires Pro plan ($10/month)\n\nUpgrade at: ${serverUrl}/billing/checkout?plan=pro`;
    } else if (requiredPlan === "enterprise") {
      return `⚠️ This feature requires Enterprise plan ($30/month)\n\nUpgrade at: ${serverUrl}/billing/checkout?plan=enterprise`;
    }
    return "Feature not available on your current plan";
  }
}
