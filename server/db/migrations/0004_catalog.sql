CREATE TABLE "catalog_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "families" (
	"number" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"discipline" text NOT NULL,
	"discipline_slug" text NOT NULL,
	"position" integer NOT NULL,
	"member_count" integer NOT NULL,
	"has_lean" boolean DEFAULT false NOT NULL,
	"reasoning_trace" text
);
--> statement-breakpoint
CREATE TABLE "manuscripts" (
	"dir" text PRIMARY KEY NOT NULL,
	"family_number" integer NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"abstract" text NOT NULL,
	"pdf_file" text NOT NULL,
	"published_on" date,
	"has_lean" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "manuscript_dir" text;--> statement-breakpoint
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_family_number_families_number_fk" FOREIGN KEY ("family_number") REFERENCES "public"."families"("number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "families_discipline_idx" ON "families" USING btree ("discipline_slug");--> statement-breakpoint
CREATE INDEX "manuscripts_family_idx" ON "manuscripts" USING btree ("family_number");--> statement-breakpoint
CREATE INDEX "papers_manuscript_idx" ON "papers" USING btree ("manuscript_dir");