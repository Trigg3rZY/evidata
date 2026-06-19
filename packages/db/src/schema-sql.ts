/**
 * Inlined schema DDL — the concatenation of the committed `drizzle/*.sql`
 * migrations, verbatim (the `--> statement-breakpoint` lines are valid `--` SQL
 * comments). `createMetadataDb` execs this for the embedded pglite client.
 *
 * Why inline rather than the fs migrator: `new URL('../drizzle', import.meta.url)`
 * is not resolvable once the package is bundled (e.g. by Next/Turbopack). The
 * generated `drizzle/*.sql` remain the source of truth and the M1 real-Postgres
 * path uses the file-based migrator (it runs unbundled, spec 08 §9). `schema-sql.test.ts`
 * asserts this constant stays in sync with those files.
 */
export const SCHEMA_SQL = `CREATE SCHEMA "evidata_meta";
--> statement-breakpoint
CREATE TABLE "evidata_meta"."answers" (
	"id" text PRIMARY KEY NOT NULL,
	"investigation_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"confidence" text NOT NULL,
	"is_latest" boolean NOT NULL,
	"created_after_kind" text,
	"created_after_from_version" integer,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"investigation_id" text NOT NULL,
	"answer_version" integer NOT NULL,
	"evidence_ref" text NOT NULL,
	"query_run_id" text NOT NULL,
	"purpose" text NOT NULL,
	"connector_id" text NOT NULL,
	"tables" jsonb NOT NULL,
	"sql" text NOT NULL,
	"result_summary" text NOT NULL,
	"sample_rows" jsonb,
	"safety" text NOT NULL,
	"policy_notes" text NOT NULL,
	"redacted_columns" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."investigations" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."query_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"investigation_id" text NOT NULL,
	"answer_version" integer NOT NULL,
	"connector_id" text NOT NULL,
	"sql" text NOT NULL,
	"status" text NOT NULL,
	"row_count" integer NOT NULL,
	"truncated" boolean NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"investigation_id" text NOT NULL,
	"answer_version" integer,
	"kind" text NOT NULL,
	"target_ref" text,
	"description" text NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."turns" (
	"id" text PRIMARY KEY NOT NULL,
	"investigation_id" text NOT NULL,
	"role" text NOT NULL,
	"question" text,
	"answer_version" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidata_meta"."answers" ADD CONSTRAINT "answers_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "evidata_meta"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."evidence" ADD CONSTRAINT "evidence_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "evidata_meta"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."evidence" ADD CONSTRAINT "evidence_query_run_id_query_runs_id_fk" FOREIGN KEY ("query_run_id") REFERENCES "evidata_meta"."query_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."query_runs" ADD CONSTRAINT "query_runs_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "evidata_meta"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD CONSTRAINT "suggestions_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "evidata_meta"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."turns" ADD CONSTRAINT "turns_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "evidata_meta"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_version_uq" ON "evidata_meta"."answers" USING btree ("investigation_id","version");--> statement-breakpoint
CREATE INDEX "answers_latest_idx" ON "evidata_meta"."answers" USING btree ("investigation_id","is_latest");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_ref_uq" ON "evidata_meta"."evidence" USING btree ("investigation_id","answer_version","evidence_ref");--> statement-breakpoint
CREATE INDEX "query_runs_version_idx" ON "evidata_meta"."query_runs" USING btree ("investigation_id","answer_version");--> statement-breakpoint
CREATE INDEX "turns_investigation_idx" ON "evidata_meta"."turns" USING btree ("investigation_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "answers_one_latest_uq" ON "evidata_meta"."answers" USING btree ("investigation_id") WHERE "evidata_meta"."answers"."is_latest";
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "evidata_meta"."business_glossary_terms" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"status" text NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."data_source_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"alias" text,
	"included_tables" jsonb NOT NULL,
	"field_rules" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."data_source_contexts" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "data_source_contexts_data_source_id_unique" UNIQUE("data_source_id")
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."data_source_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."entity_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"from_ref" text NOT NULL,
	"to_ref" text NOT NULL,
	"status" text NOT NULL,
	"provenance" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidata_meta"."policies" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"row_limit" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"statement_timeout_ms" integer,
	"confirm_on_broad_scan" boolean NOT NULL,
	"confirm_on_sensitive_access" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "policies_data_source_id_unique" UNIQUE("data_source_id")
);
--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_sources" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_sources" ADD COLUMN "lifecycle" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
UPDATE "evidata_meta"."data_sources" SET "lifecycle" = 'published' WHERE "id" = 'sample';--> statement-breakpoint
ALTER TABLE "evidata_meta"."business_glossary_terms" ADD CONSTRAINT "business_glossary_terms_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_source_connections" ADD CONSTRAINT "data_source_connections_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_source_connections" ADD CONSTRAINT "data_source_connections_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "evidata_meta"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_source_contexts" ADD CONSTRAINT "data_source_contexts_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_source_memberships" ADD CONSTRAINT "data_source_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."data_source_memberships" ADD CONSTRAINT "data_source_memberships_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."entity_mappings" ADD CONSTRAINT "entity_mappings_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."policies" ADD CONSTRAINT "policies_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "glossary_ds_idx" ON "evidata_meta"."business_glossary_terms" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_conn_uq" ON "evidata_meta"."data_source_connections" USING btree ("data_source_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_member_uq" ON "evidata_meta"."data_source_memberships" USING btree ("user_id","data_source_id");--> statement-breakpoint
CREATE INDEX "mappings_ds_idx" ON "evidata_meta"."entity_mappings" USING btree ("data_source_id");`;
