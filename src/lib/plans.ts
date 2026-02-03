import { env } from "cloudflare:workers";

export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    features: {
      maxIntegrations: 1,
      readOnly: true, // Only read operations allowed
      advancedTools: false, // No batch operations
    },
    allowedProviders: ["gmail", "calendar", "drive"], // Can only connect these
    allowedTools: [
      // Gmail - Read only
      "read_email",
      "search_emails",
      "list_email_labels",

      // Calendar - Read only
      "list_events",
      "list_calendars",

      // Drive - Read only
      "search_files",
      "get_file",
      "download_file",
    ],
  },
  pro: {
    name: "Pro",
    price: 10,
    polarPriceId: env.POLAR_PRO_PLAN,
    features: {
      maxIntegrations: 3,
      readOnly: false, // Can write
      advancedTools: false, // No batch operations yet
    },
    allowedProviders: ["gmail", "calendar", "drive"], // Same as free
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
    price: 30,
    polarPriceId: env.POLAR_ENTERPRISE_PLAN,
    features: {
      maxIntegrations: Infinity,
      readOnly: false,
      advancedTools: true, // Batch operations, automation
    },
    allowedProviders: ["gmail", "calendar", "drive", "notion", "slack"], // All providers
    allowedTools: "*", // All tools allowed
  },
} as const;

export type PlanTier = keyof typeof PLANS;
