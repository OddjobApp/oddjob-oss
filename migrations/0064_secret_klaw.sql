CREATE TABLE "health_check_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"check_interval_seconds" integer DEFAULT 30 NOT NULL,
	"check_timeout_seconds" integer DEFAULT 10 NOT NULL,
	"stale_heartbeat_seconds" integer DEFAULT 120 NOT NULL,
	"unhealthy_threshold_count" integer DEFAULT 3 NOT NULL,
	"degraded_threshold_percent" numeric(5, 2) DEFAULT '0.10' NOT NULL,
	"alert_enabled" boolean DEFAULT true NOT NULL,
	"alert_on_unhealthy" boolean DEFAULT true NOT NULL,
	"alert_on_degraded" boolean DEFAULT false NOT NULL,
	"alert_on_stale_heartbeat" boolean DEFAULT true NOT NULL,
	"alert_on_dependency_issue" boolean DEFAULT true NOT NULL,
	"alert_channels" text DEFAULT 'slack' NOT NULL,
	"alert_severity" varchar(20) DEFAULT 'warning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_check_failures" (
	"instance_id" integer PRIMARY KEY NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_time" timestamp with time zone,
	"last_successful_time" timestamp with time zone,
	"alert_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "health_check_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"check_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"response_time_ms" integer,
	"status" varchar(20) NOT NULL,
	"status_code" integer,
	"database_status" varchar(20),
	"cache_status" varchar(20),
	"broker_status" varchar(20),
	"error_message" text,
	"alert_triggered" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_check_config" ADD CONSTRAINT "health_check_config_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_failures" ADD CONSTRAINT "health_check_failures_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_check_config_org_id_idx" ON "health_check_config" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "health_check_instance_id_idx" ON "health_check_results" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "health_check_timestamp_idx" ON "health_check_results" USING btree ("check_timestamp");--> statement-breakpoint
CREATE INDEX "health_check_org_id_idx" ON "health_check_results" USING btree ("org_id");