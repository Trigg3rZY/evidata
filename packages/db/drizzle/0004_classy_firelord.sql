CREATE TABLE "evidata_meta"."model_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"base_url" text,
	"model" text NOT NULL,
	"params" jsonb NOT NULL,
	"capabilities" jsonb NOT NULL,
	"credential_blob" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidata_meta"."model_providers" ADD CONSTRAINT "model_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "evidata_meta"."users"("id") ON DELETE no action ON UPDATE no action;