CREATE TABLE `chat_players` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`tg_user_id` integer,
	`display_name` text,
	`created_at` integer NOT NULL,
	`merged_into` text,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tg_user_id`) REFERENCES `users`(`tg_user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_players_chat_user_uq` ON `chat_players` (`chat_id`,`tg_user_id`) WHERE "chat_players"."tg_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_players_chat_guest_name_uq` ON `chat_players` (`chat_id`,lower("display_name")) WHERE "chat_players"."tg_user_id" IS NULL;--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`tg_chat_id` integer NOT NULL,
	`title` text NOT NULL,
	`language` text NOT NULL,
	`currency` text NOT NULL,
	`stack_chips` integer NOT NULL,
	`stack_amount` integer NOT NULL,
	`game_name_template` text NOT NULL,
	`quick_buyins` text NOT NULL,
	`prize_template` text,
	`game_counter` integer DEFAULT 0 NOT NULL,
	`bot_status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chats_tg_chat_id_unique` ON `chats` (`tg_chat_id`);--> statement-breakpoint
CREATE TABLE `game_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`player_id` text,
	`type` text NOT NULL,
	`chips` integer,
	`amount` integer,
	`payload` text,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`cancelled_by` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `chat_players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`tg_user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `game_events_game_idx` ON `game_events` (`game_id`,`id`);--> statement-breakpoint
CREATE TABLE `game_players` (
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`seat_order` integer NOT NULL,
	`added_by` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `player_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `chat_players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`tg_user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `game_results` (
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`in_chips` integer NOT NULL,
	`out_chips` integer NOT NULL,
	`buyin_count` integer NOT NULL,
	`rebuy_count` integer NOT NULL,
	`adjustment_chips_num` integer NOT NULL,
	`adjustment_chips_den` integer NOT NULL,
	`money_result` integer NOT NULL,
	`place` integer,
	`prize` integer,
	`paid_total` integer,
	PRIMARY KEY(`game_id`, `player_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `chat_players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`currency` text NOT NULL,
	`stack_chips` integer NOT NULL,
	`stack_amount` integer NOT NULL,
	`tournament_config` text,
	`mismatch_mode` text,
	`mismatch_player_id` text,
	`mismatch_chips` integer,
	`settlement_is_manual` integer DEFAULT false NOT NULL,
	`created_by` integer NOT NULL,
	`status_message_id` integer,
	`result_message_id` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`tg_user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `games_chat_status_idx` ON `games` (`chat_id`,`status`);--> statement-breakpoint
CREATE INDEX `games_chat_finished_idx` ON `games` (`chat_id`,`finished_at`);--> statement-breakpoint
CREATE TABLE `link_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`created_by` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`player_id`) REFERENCES `chat_players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`from_player_id` text NOT NULL,
	`to_player_id` text NOT NULL,
	`amount` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_player_id`) REFERENCES `chat_players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_player_id`) REFERENCES `chat_players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `settlements_game_idx` ON `settlements` (`game_id`,`position`);--> statement-breakpoint
CREATE TABLE `users` (
	`tg_user_id` integer PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text,
	`username` text,
	`language` text,
	`pay_phone` text,
	`pay_bank` text,
	`pay_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
