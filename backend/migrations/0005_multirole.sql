ALTER TABLE `users` ADD COLUMN `roles` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `primary_role` text NOT NULL DEFAULT 'employee';--> statement-breakpoint
UPDATE `users` SET `roles` = json_array(`role`), `primary_role` = `role`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `role`;
