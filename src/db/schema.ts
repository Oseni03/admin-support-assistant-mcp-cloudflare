import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// BetterAuth required tables
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

// Custom tables for your application
export const integration = sqliteTable("integration", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // 'gmail', 'calendar', 'drive', 'notion', 'slack'
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken"),
  expiresAt: integer("expiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  metadata: text("metadata"), // JSON string for provider-specific data
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const subscription = sqliteTable("subscription", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(), // 'free', 'pro', 'enterprise'
  status: text("status").notNull(), // 'active', 'canceled', 'past_due', 'trialing'
  stripeCustomerId: text("stripeCustomerId"),
  stripeSubscriptionId: text("stripeSubscriptionId"),
  stripePriceId: text("stripePriceId"),
  currentPeriodStart: integer("currentPeriodStart", { mode: "timestamp" }),
  currentPeriodEnd: integer("currentPeriodEnd", { mode: "timestamp" }),
  cancelAtPeriodEnd: integer("cancelAtPeriodEnd", { mode: "boolean" }).default(false),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const usage = sqliteTable("usage", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  month: text("month").notNull(), // 'YYYY-MM'
  emailsSent: integer("emailsSent").default(0),
  apiCalls: integer("apiCalls").default(0),
  storageUsed: integer("storageUsed").default(0), // in bytes
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

// Composite unique constraint
export const integrationIndex = primaryKey({
  columns: [integration.userId, integration.provider],
});
