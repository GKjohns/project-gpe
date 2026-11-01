-- Supabase serves the public schema over its Data API; the app connects as the owner (bypasses RLS) and never uses
-- supabase-js, so enabling RLS with no policies closes that door without changing the app.
ALTER TABLE "papers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "run_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stage_outputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "review_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "families" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "manuscripts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "catalog_meta" ENABLE ROW LEVEL SECURITY;
