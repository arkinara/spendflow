CREATE TABLE `approval_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`step_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`comment` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `approval_steps`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approval_actions_claim_idx` ON `approval_actions` (`claim_id`);--> statement-breakpoint
CREATE INDEX `approval_actions_step_idx` ON `approval_actions` (`step_id`);--> statement-breakpoint
CREATE INDEX `approval_actions_actor_idx` ON `approval_actions` (`actor_id`);--> statement-breakpoint
CREATE TABLE `approval_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`match_min_amount` integer,
	`match_max_amount` integer,
	`match_category_id` text,
	`match_department` text,
	`is_fallback` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`match_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `approval_routes_active_idx` ON `approval_routes` (`active`);--> statement-breakpoint
CREATE INDEX `approval_routes_fallback_idx` ON `approval_routes` (`is_fallback`);--> statement-breakpoint
CREATE TABLE `approval_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`approver_type` text NOT NULL,
	`approver_id` text,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `approval_routes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `approval_steps_route_idx` ON `approval_steps` (`route_id`);--> statement-breakpoint
CREATE INDEX `approval_steps_order_idx` ON `approval_steps` (`order_index`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`line_item_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_url` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`merchant` text,
	`amount` integer,
	`currency` text,
	`transaction_date` text,
	`uploaded_by` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`line_item_id`) REFERENCES `claim_line_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_line_item_idx` ON `attachments` (`line_item_id`);--> statement-breakpoint
CREATE INDEX `attachments_uploaded_by_idx` ON `attachments` (`uploaded_by`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`requires_receipt` integer DEFAULT false NOT NULL,
	`receipt_threshold` integer DEFAULT 0 NOT NULL,
	`per_item_cap` integer,
	`mileage_rate` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `categories_active_idx` ON `categories` (`active`);--> statement-breakpoint
CREATE TABLE `claim_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`category_id` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`quantity` integer,
	`unit_label` text,
	`unit_rate` integer,
	`has_receipt` integer DEFAULT false NOT NULL,
	`note` text,
	`policy_flag` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `claim_line_items_claim_idx` ON `claim_line_items` (`claim_id`);--> statement-breakpoint
CREATE INDEX `claim_line_items_category_idx` ON `claim_line_items` (`category_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`title` text NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`employee_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`trip_start` text,
	`trip_end` text,
	`destination` text,
	`approval_route_id` text,
	`current_step_index` integer DEFAULT 0 NOT NULL,
	`policy_exception` text,
	`submitted_at` integer,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approval_route_id`) REFERENCES `approval_routes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claims_reference_unique` ON `claims` (`reference`);--> statement-breakpoint
CREATE INDEX `claims_employee_idx` ON `claims` (`employee_id`);--> statement-breakpoint
CREATE INDEX `claims_status_idx` ON `claims` (`status`);--> statement-breakpoint
CREATE INDEX `claims_route_idx` ON `claims` (`approval_route_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`claim_id` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_id`);--> statement-breakpoint
CREATE INDEX `notifications_read_idx` ON `notifications` (`read`);--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category_id` text,
	`limit_amount` integer,
	`period` text DEFAULT 'per_item' NOT NULL,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`receipt_required` integer DEFAULT false NOT NULL,
	`receipt_required_above` integer DEFAULT 0 NOT NULL,
	`justification_required_above` integer DEFAULT 0 NOT NULL,
	`effective_date` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `policies_active_idx` ON `policies` (`active`);--> statement-breakpoint
CREATE INDEX `policies_category_idx` ON `policies` (`category_id`);