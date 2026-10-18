-- Where an article lies in a store (#385): a shelf, a cabinet or a
-- compartment, in words, for this store only. The column and its bound come
-- from the stock of the foundation (opengewerk#664); no row has one yet. The
-- audit trigger of 0054 writes the whole row and names it with the rest.
ALTER TABLE "store_articles" ADD COLUMN "bin" text;--> statement-breakpoint
ALTER TABLE "store_articles" ADD CONSTRAINT "store_articles_bin_fits" CHECK ("store_articles"."bin" is null or char_length("store_articles"."bin") <= 200);