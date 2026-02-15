import { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { randomUUID } from "crypto";

export class UserService {
  constructor(private db: DrizzleD1Database<typeof schema>) {}

  async createUser(email: string, githubLogin?: string, name?: string) {
    const now = new Date();
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7); // 7-day trial

    const user = await this.db
      .insert(schema.user)
      .values({
        id: randomUUID(),
        email,
        githubLogin,
        name,
        plan: "pro", // Default to pro plan
        subscriptionStatus: "trial",
        trialStartDate: now,
        trialEndDate: trialEnd,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return user[0];
  }
}
