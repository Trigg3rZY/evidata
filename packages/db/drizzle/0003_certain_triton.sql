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
CREATE INDEX "mappings_ds_idx" ON "evidata_meta"."entity_mappings" USING btree ("data_source_id");