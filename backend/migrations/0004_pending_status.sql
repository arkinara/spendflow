CREATE TABLE `user_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`consumed_by_ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_invitations_token_unique` ON `user_invitations` (`token`);--> statement-breakpoint
CREATE INDEX `user_invitations_token_idx` ON `user_invitations` (`token`);