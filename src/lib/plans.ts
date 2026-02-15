import { env } from "cloudflare:workers";

export const PLANS = {
  pro: {
    name: "Pro",
    price: 15,
    polarPriceId: env.POLAR_PRO_PLAN,
    trialDays: 7,
    features: {
      maxIntegrations: 3,
      description: "Perfect for individuals and small teams",
    },
    allowedProviders: ["gmail", "calendar", "drive"],
    allowedTools: [
      // Gmail - Full access
      "send_email",
      "draft_email",
      "read_email",
      "search_emails",
      "modify_email",
      "delete_email",
      "list_email_labels",
      "create_label",
      "update_label",
      "delete_label",
      "get_or_create_label",

      // Calendar - Full access
      "create_event",
      "list_events",
      "update_event",
      "delete_event",
      "list_calendars",

      // Drive - Full access
      "search_files",
      "get_file",
      "download_file",
      "upload_file",
      "create_folder",
      "delete_file",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price: 40,
    polarPriceId: env.POLAR_ENTERPRISE_PLAN,
    trialDays: 7,
    features: {
      maxIntegrations: Infinity,
      description: "Advanced integrations and batch operations",
    },
    allowedProviders: ["gmail", "calendar", "drive", "notion", "slack"],
    allowedTools: "*", // All tools allowed
  },
} as const;

export type PlanTier = keyof typeof PLANS;

// Trial status helper
export function getTrialStatus(createdAt: Date, trialDays: number = 7) {
  const now = new Date();
  const trialEndDate = new Date(createdAt);
  trialEndDate.setDate(trialEndDate.getDate() + trialDays);

  const daysRemaining = Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    isActive: now < trialEndDate,
    daysRemaining: Math.max(0, daysRemaining),
    endDate: trialEndDate,
    hasExpired: now >= trialEndDate,
  };
}
