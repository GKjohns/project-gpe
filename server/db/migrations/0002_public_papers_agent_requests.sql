CREATE TABLE "agent_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"surface" text NOT NULL,
	"tool" text,
	"paper" text,
	"status" integer NOT NULL,
	"ms" integer NOT NULL,
	"client" text NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"ref" text
);
--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_requests_at_idx" ON "agent_requests" USING btree ("at");