CREATE TABLE `bot_sandbox_runtime_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_instance_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`port` integer NOT NULL,
	`api_key` text NOT NULL,
	`workspace_base_path` text NOT NULL,
	`pool_size` integer NOT NULL,
	`min_ready_processes` integer NOT NULL,
	`session_timeout_ms` integer NOT NULL,
	`max_concurrent_init` integer NOT NULL,
	`health_check_interval_ms` integer NOT NULL,
	`port_range_start` integer NOT NULL,
	`port_range_end` integer NOT NULL,
	`default_denied_domains_json` text NOT NULL,
	`default_allow_read_json` text NOT NULL,
	`default_allow_write_json` text NOT NULL,
	`default_deny_read_json` text NOT NULL,
	`default_deny_write_json` text NOT NULL,
	`restart_requested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_instance_id`) REFERENCES `bot_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_srt_pools_api_key_idx` ON `bot_sandbox_runtime_pools` (`api_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `bot_srt_pools_bot_instance_idx` ON `bot_sandbox_runtime_pools` (`bot_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bot_srt_pools_port_idx` ON `bot_sandbox_runtime_pools` (`port`);--> statement-breakpoint
WITH `legacy_bot_pools` AS (
	SELECT
		`bot_instances`.`id` AS `bot_instance_id`,
		`bot_instances`.`owner_user_id` AS `bot_owner_user_id`,
		`bot_instances`.`created_at` AS `bot_created_at`,
		`user_sandbox_runtime_pools`.*,
		COALESCE(
			`user_sandbox_runtime_pools`.`port_range_end` - `user_sandbox_runtime_pools`.`port_range_start` + 1,
			100
		) AS `range_width`,
		COALESCE(MIN(`user_sandbox_runtime_pools`.`port`) OVER (), 31000) AS `base_port`,
		COALESCE(MIN(`user_sandbox_runtime_pools`.`port_range_start`) OVER (), 9100) AS `base_proxy_port`,
		ROW_NUMBER() OVER (
			ORDER BY `bot_instances`.`created_at`, `bot_instances`.`id`
		) AS `pool_position`
	FROM `bot_instances`
	LEFT JOIN `user_sandbox_runtime_pools`
		ON `user_sandbox_runtime_pools`.`owner_user_id` = `bot_instances`.`owner_user_id`
),
`allocated_bot_pools` AS (
	SELECT
		`legacy_bot_pools`.*,
		`base_port` + `pool_position` - 1 AS `allocated_port`,
		`base_proxy_port` + COALESCE(
			SUM(`range_width`) OVER (
				ORDER BY `bot_created_at`, `bot_instance_id`
				ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
			),
			0
		) AS `allocated_range_start`
	FROM `legacy_bot_pools`
)
INSERT INTO `bot_sandbox_runtime_pools` (
	`id`,
	`bot_instance_id`,
	`enabled`,
	`port`,
	`api_key`,
	`workspace_base_path`,
	`pool_size`,
	`min_ready_processes`,
	`session_timeout_ms`,
	`max_concurrent_init`,
	`health_check_interval_ms`,
	`port_range_start`,
	`port_range_end`,
	`default_denied_domains_json`,
	`default_allow_read_json`,
	`default_allow_write_json`,
	`default_deny_read_json`,
	`default_deny_write_json`,
	`restart_requested_at`,
	`created_at`,
	`updated_at`
)
SELECT
	lower(hex(randomblob(16))),
	`bot_instance_id`,
	COALESCE(`enabled`, 1),
	`allocated_port`,
	lower(hex(randomblob(32))),
	CASE
		WHEN `workspace_base_path` IS NOT NULL
			AND substr(`workspace_base_path`, -length(`bot_owner_user_id`)) = `bot_owner_user_id`
			AND substr(`workspace_base_path`, -(length(`bot_owner_user_id`) + 1), 1) = '/'
			THEN substr(`workspace_base_path`, 1, length(`workspace_base_path`) - length(`bot_owner_user_id`)) || `bot_instance_id`
		ELSE '/app/apps/sandbox-runtime/user-workspaces/' || `bot_instance_id`
	END,
	1,
	1,
	COALESCE(`session_timeout_ms`, 600000),
	COALESCE(`max_concurrent_init`, 1),
	COALESCE(`health_check_interval_ms`, 60000),
	`allocated_range_start`,
	`allocated_range_start` + `range_width` - 1,
	COALESCE(`default_denied_domains_json`, '[]'),
	COALESCE(`default_allow_read_json`, '[]'),
	COALESCE(`default_allow_write_json`, '["/tmp"]'),
	COALESCE(`default_deny_read_json`, '["/etc/passwd","/etc/passwd-","/etc/shadow","/etc/shadow-","/etc/group","/etc/group-","/etc/gshadow","/etc/gshadow-","/proc/self/mountinfo","/proc/*/mountinfo","/proc/self/mounts","/proc/*/mounts","/proc/mounts","/proc/self/mountstats","/proc/*/mountstats","/proc/self/cmdline","/proc/1/cmdline","/proc/*/cmdline","/proc/self/environ","/proc/1/environ","/proc/*/environ","/proc/kallsyms","/proc/self/cgroup","/proc/*/cgroup","/proc/cgroups","/root","~/.ssh","~/.aws"]'),
	COALESCE(`default_deny_write_json`, '[".env","~/.ssh","~/.aws"]'),
	`restart_requested_at`,
	COALESCE(`created_at`, `bot_created_at`),
	COALESCE(`updated_at`, `bot_created_at`)
FROM `allocated_bot_pools`;
