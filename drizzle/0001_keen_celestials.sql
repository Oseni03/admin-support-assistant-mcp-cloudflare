DROP TABLE `subscription`;--> statement-breakpoint
DROP TABLE `usage`;--> statement-breakpoint
ALTER TABLE `user` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `polarCustomerId` text;--> statement-breakpoint
ALTER TABLE `user` ADD `polarSubscriptionId` text;--> statement-breakpoint
ALTER TABLE `user` ADD `subscriptionStatus` text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `user` ADD `subscriptionEndsAt` integer;