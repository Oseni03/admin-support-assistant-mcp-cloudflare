import { Polar } from "@polar-sh/sdk";
import { DbClient } from "../db/client";

export class PolarService {
  private polar: Polar;

  constructor(
    private db: DbClient,
    accessToken: string,
  ) {
    this.polar = new Polar({
      accessToken,
    });
  }

  /**
   * Ingest a usage event for a customer
   * @param externalCustomerId - User's email or unique identifier
   * @param eventName - Name of the event (e.g., "email_sent", "api_call")
   * @param quantity - Amount of usage
   * @param metadata - Additional metadata about the event
   */
  async ingestEvent(externalCustomerId: string, eventName: string, quantity: number, metadata?: Record<string, any>) {
    try {
      await this.polar.events.ingest({
        events: [
          {
            name: eventName,
            externalCustomerId,
            metadata: {
              quantity,
              ...metadata,
              timestamp: new Date().toISOString(),
            },
          },
        ],
      });
    } catch (error: any) {
      console.error(`Failed to ingest event ${eventName}:`, error);
      throw new Error(`Failed to ingest Polar event: ${error.message}`);
    }
  }

  /**
   * Track email sent usage
   */
  async trackEmailSent(externalCustomerId: string, count: number = 1) {
    await this.ingestEvent(externalCustomerId, "email_sent", count, {
      type: "gmail",
    });
  }

  /**
   * Track API calls usage
   */
  async trackApiCall(externalCustomerId: string, apiName: string) {
    await this.ingestEvent(externalCustomerId, "api_call", 1, {
      api: apiName,
    });
  }

  /**
   * Track storage usage in bytes
   */
  async trackStorage(externalCustomerId: string, bytes: number) {
    await this.ingestEvent(externalCustomerId, "storage_used", bytes, {
      unit: "bytes",
    });
  }

  /**
   * Create or update a customer in Polar
   */
  async createOrUpdateCustomer(email: string, name: string, externalId?: string) {
    try {
      const response = await this.polar.customers.create({
        email,
        name,
        externalId: externalId || email,
      });

      return response;
    } catch (error: any) {
      // Customer might already exist, try to fetch it
      if (error.message?.includes("already exists")) {
        console.log(`Customer ${email} already exists in Polar`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Get customer information
   */
  async getCustomer(externalId: string) {
    try {
      const customer = await this.polar.customers.get({
        id: externalId,
      });

      return customer;
    } catch (error: any) {
      console.error(`Failed to fetch customer ${externalId}:`, error);
      return null;
    }
  }

  /**
   * Get customer's current usage
   */
  async getCustomerUsage(externalId: string) {
    try {
      const customer = await this.getCustomer(externalId);
      if (!customer) return null;

      // This would typically return aggregated meter data
      // For now, we return the customer object which contains usage info
      return customer;
    } catch (error: any) {
      console.error(`Failed to get customer usage:`, error);
      return null;
    }
  }
}
