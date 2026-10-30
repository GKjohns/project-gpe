-- The canonical maps start public on the agent API; copies (-agent, -e2e, toy-inngest-*) and everything ingested later
-- start private. Flip with `npm run paper:public`.
UPDATE "papers" SET "public" = true WHERE "slug" IN ('eth', 'sensitivity', 'pfr', 'sunflowers-rao', 'sunflower-alwz', 'noncoordinate', 'unit-distance', 'intmult', 'logspace');
