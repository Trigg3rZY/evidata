ALTER TABLE "evidata_meta"."suggestions" ADD COLUMN "data_source_id" text;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD COLUMN "submitted_by" text;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD COLUMN "target_kind" text;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD COLUMN "target_item_id" text;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD COLUMN "proposed_definition" text;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD CONSTRAINT "suggestions_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "evidata_meta"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD CONSTRAINT "suggestions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidata_meta"."suggestions" ADD CONSTRAINT "suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestions_ds_status_idx" ON "evidata_meta"."suggestions" USING btree ("data_source_id","status");