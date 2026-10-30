CREATE TABLE "blobs" (
	"sha" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"path" text NOT NULL,
	"blob_sha" text NOT NULL,
	"bytes" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_blob_sha_blobs_sha_fk" FOREIGN KEY ("blob_sha") REFERENCES "public"."blobs"("sha") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_assets_paper_idx" ON "source_assets" USING btree ("paper_id");