import { and, eq } from "drizzle-orm";
import { DbClient } from "../db/client";
import { subscription, usage } from "../db/schema";

export class BillingService {
  constructor(private db: DbClient) {}

  async createSubscription(params: {
    userId: string;
    plan: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripePriceId?: string;
  }) {
    const id = crypto.randomUUID();

    await this.db.insert(subscription).values({
      id,
      userId: params.userId,
      plan: params.plan,
      status: "active",
      stripeCustomerId: params.stripeCustomerId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripePriceId: params.stripePriceId,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return id;
  }

  async getSubscription(userId: string) {
    const result = await this.db.select().from(subscription).where(eq(subscription.userId, userId)).limit(1);

    return result[0] || null;
  }

  async updateSubscription(userId: string, updates: Partial<typeof subscription.$inferInsert>) {
    await this.db
      .update(subscription)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(subscription.userId, userId));
  }

  async trackUsage(userId: string, type: "emailsSent" | "apiCalls" | "storageUsed", amount: number) {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const id = `${userId}-${month}`;

    await this.db
      .insert(usage)
      .values({
        id,
        userId,
        month,
        [type]: amount,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: usage.id,
        set: {
          [type]: amount,
          updatedAt: new Date(),
        },
      });
  }

  async getUsage(userId: string, month?: string) {
    const targetMonth = month || new Date().toISOString().slice(0, 7);

    const result = await this.db
      .select()
      .from(usage)
      .where(and(eq(usage.userId, userId), eq(usage.month, targetMonth)))
      .limit(1);

    return result[0] || null;
  }
}
