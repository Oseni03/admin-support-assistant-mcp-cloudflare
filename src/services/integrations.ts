import { eq, and } from "drizzle-orm";
import { DbClient } from "../db/client";
import { integration } from "../db/schema";

export class IntegrationService {
  constructor(private db: DbClient) {
    if (!db) {
      throw new Error("Database client is required for IntegrationService");
    }
  }

  async saveIntegration(params: {
    userId: string;
    provider: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    scope?: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      // Check if integration exists first
      const existing = await this.db
        .select()
        .from(integration)
        .where(and(eq(integration.userId, params.userId), eq(integration.provider, params.provider)))
        .limit(1);

      if (existing.length > 0) {
        // Update existing integration
        console.log(`Updating existing ${params.provider} integration for user ${params.userId}`);

        await this.db
          .update(integration)
          .set({
            accessToken: params.accessToken,
            refreshToken: params.refreshToken || null,
            expiresAt: params.expiresAt || null,
            scope: params.scope || null,
            metadata: params.metadata ? JSON.stringify(params.metadata) : null,
            updatedAt: new Date(),
          })
          .where(eq(integration.id, existing[0].id));

        console.log(`✅ Integration updated: ${existing[0].id}`);
        return existing[0].id;
      } else {
        // Insert new integration
        const id = crypto.randomUUID();
        console.log(`Creating new ${params.provider} integration for user ${params.userId}`);

        await this.db.insert(integration).values({
          id,
          userId: params.userId,
          provider: params.provider,
          accessToken: params.accessToken,
          refreshToken: params.refreshToken || null,
          expiresAt: params.expiresAt || null,
          scope: params.scope || null,
          metadata: params.metadata ? JSON.stringify(params.metadata) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        console.log(`✅ Integration created: ${id}`);
        return id;
      }
    } catch (error: any) {
      console.error("Error saving integration:", error);
      console.error("Error details:", {
        message: error.message,
        cause: error.cause,
        stack: error.stack,
      });
      throw error;
    }
  }

  async getIntegration(userId: string, provider: string) {
    try {
      const result = await this.db
        .select()
        .from(integration)
        .where(and(eq(integration.userId, userId), eq(integration.provider, provider)))
        .limit(1);

      if (result.length === 0) return null;

      const int = result[0];
      return {
        ...int,
        metadata: int.metadata ? JSON.parse(int.metadata) : null,
      };
    } catch (error: any) {
      console.error("Error getting integration:", error);
      throw error;
    }
  }

  async getUserIntegrations(userId: string) {
    try {
      const results = await this.db.select().from(integration).where(eq(integration.userId, userId));

      return results.map((int) => ({
        ...int,
        metadata: int.metadata ? JSON.parse(int.metadata) : null,
      }));
    } catch (error: any) {
      console.error("Error getting user integrations:", error);
      throw error;
    }
  }

  async deleteIntegration(userId: string, provider: string) {
    try {
      await this.db.delete(integration).where(and(eq(integration.userId, userId), eq(integration.provider, provider)));

      console.log(`✅ Integration deleted: ${provider} for user ${userId}`);
    } catch (error: any) {
      console.error("Error deleting integration:", error);
      throw error;
    }
  }
}
