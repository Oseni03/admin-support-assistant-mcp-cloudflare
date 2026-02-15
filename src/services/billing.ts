import { DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { Polar } from "@polar-sh/sdk";
import { PLANS, PlanTier, getTrialStatus } from "../lib/plans";

export class BillingService {
  constructor(
    private db: DrizzleD1Database<typeof schema>,
    private polar: Polar,
  ) {}

  /**
   * Check if user has active access (trial or paid)
   */
  async hasActiveAccess(userId: string): Promise<{
    hasAccess: boolean;
    status: "trial" | "active" | "expired" | "cancelled";
    daysRemaining?: number;
    reason?: string;
  }> {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, userId),
    });

    if (!user) {
      return { hasAccess: false, status: "expired", reason: "User not found" };
    }

    // Check if they have an active paid subscription
    if (user.subscriptionStatus === "active") {
      const now = new Date();
      const endDate = user.subscriptionEndDate ? new Date(user.subscriptionEndDate) : null;

      if (endDate && now < endDate) {
        return { hasAccess: true, status: "active" };
      }

      // Subscription expired
      await this.updateSubscriptionStatus(userId, "expired");
      return {
        hasAccess: false,
        status: "expired",
        reason: "Subscription expired",
      };
    }

    // Check trial status
    if (user.subscriptionStatus === "trial") {
      const trial = getTrialStatus(user.trialStartDate);

      if (trial.isActive) {
        return {
          hasAccess: true,
          status: "trial",
          daysRemaining: trial.daysRemaining,
        };
      }

      // Trial expired
      await this.updateSubscriptionStatus(userId, "expired");
      return {
        hasAccess: false,
        status: "expired",
        reason: "Trial expired",
      };
    }

    // Expired or cancelled
    return {
      hasAccess: false,
      status: user.subscriptionStatus,
      reason: `Subscription ${user.subscriptionStatus}`,
    };
  }

  /**
   * Get user's current plan
   */
  async getUserPlan(userId: string): Promise<PlanTier> {
    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, userId),
    });

    return (user?.plan as PlanTier) || "pro";
  }

  /**
   * Check if user can use a specific tool
   */
  canUseTool(plan: PlanTier, toolName: string): boolean {
    const planConfig = PLANS[plan];

    if (planConfig.allowedTools === "*") {
      return true;
    }

    return planConfig.allowedTools.includes(toolName as any);
  }

  /**
   * Check if user can connect a provider
   */
  canConnectProvider(plan: PlanTier, provider: string, currentIntegrationCount: number): { allowed: boolean; reason?: string } {
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
        reason: `You've reached the maximum of ${planConfig.features.maxIntegrations} integrations for ${plan} plan`,
      };
    }

    return { allowed: true };
  }

  /**
   * Create checkout URL for subscription
   */
  async createCheckoutUrl(userId: string, userEmail: string, targetPlan: "pro" | "enterprise", successUrl: string): Promise<string> {
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

      return checkout.url!;
    } catch (error: any) {
      console.error("Error creating Polar checkout:", error);
      throw error;
    }
  }

  /**
   * Handle successful subscription (webhook)
   */
  async activateSubscription(
    userId: string,
    plan: "pro" | "enterprise",
    polarSubscriptionId: string,
    polarCustomerId: string,
  ): Promise<void> {
    const now = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1); // Monthly subscription

    await this.db
      .update(schema.user)
      .set({
        plan,
        subscriptionStatus: "active",
        polarSubscriptionId,
        polarCustomerId,
        subscriptionStartDate: now,
        subscriptionEndDate: endDate,
        updatedAt: now,
      })
      .where(eq(schema.user.id, userId));
  }

  /**
   * Update subscription status
   */
  async updateSubscriptionStatus(userId: string, status: "trial" | "active" | "expired" | "cancelled"): Promise<void> {
    await this.db
      .update(schema.user)
      .set({
        subscriptionStatus: status,
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId));
  }

  /**
   * Get upgrade message for user
   */
  getUpgradeMessage(
    currentPlan: PlanTier,
    requiredPlan: "pro" | "enterprise",
    baseUrl: string,
    userEmail: string,
    status: "trial" | "active" | "expired" | "cancelled",
  ): string {
    const planName = PLANS[requiredPlan].name;
    const price = PLANS[requiredPlan].price;
    const upgradeUrl = `${baseUrl}/billing/checkout?plan=${requiredPlan}`;

    if (status === "expired") {
      return `Your trial has expired. Subscribe to ${planName} ($${price}/mo) to continue using this feature.\n\nUpgrade: ${upgradeUrl}`;
    }

    if (status === "trial") {
      return `This feature requires ${planName} plan. Subscribe now ($${price}/mo) or continue with your trial.\n\nUpgrade: ${upgradeUrl}`;
    }

    return `Upgrade to ${planName} ($${price}/mo) to use this feature.\n\nUpgrade: ${upgradeUrl}`;
  }
}
