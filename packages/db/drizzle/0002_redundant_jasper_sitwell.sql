CREATE TABLE "evidata_meta"."connection_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."connections" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"database" text NOT NULL,
	"ssl_mode" text NOT NULL,
	"credential_blob" jsonb NOT NULL,
	"health" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"connection_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."schema_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"status" text NOT NULL,
	"partial" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidata_meta"."connection_memberships" ADD CONSTRAINT "connection_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."connection_memberships" ADD CONSTRAINT "connection_memberships_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "evidata_meta"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."connections" ADD CONSTRAINT "connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_sources" ADD CONSTRAINT "data_sources_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "evidata_meta"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."schema_snapshots" ADD CONSTRAINT "schema_snapshots_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "evidata_meta"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conn_member_uq" ON "evidata_meta"."connection_memberships" USING btree ("user_id","connection_id");--> statement-breakpoint
CREATE INDEX "snapshots_connection_idx" ON "evidata_meta"."schema_snapshots" USING btree ("connection_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "evidata_meta"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "evidata_meta"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "evidata_meta"."users" USING btree ("email");--> statement-breakpoint
INSERT INTO "evidata_meta"."data_sources" ("id", "name", "kind", "connection_id", "created_at") VALUES ('sample', 'Sample — Advertising Platform', 'sample', NULL, now()) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "evidata_meta"."investigations" ADD CONSTRAINT "investigations_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;