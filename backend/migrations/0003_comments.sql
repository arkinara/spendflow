CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_claim_idx` ON `comments` (`claim_id`);--> statement-breakpoint
DROP INDEX `notifications_read_idx`;--> statement-breakpoint
ALTER TABLE `notifications` ADD `read_at` integer;--> statement-breakpoint
CREATE INDEX `notifications_read_at_idx` ON `notifications` (`read_at`);