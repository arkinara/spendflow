CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`method` text NOT NULL,
	`reference_number` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`processed_by` text,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`processed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payments_claim_idx` ON `payments` (`claim_id`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);