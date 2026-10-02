-- The sequence for the numbers of work orders, which the first migration
-- should have brought and did not.
--
-- The concept names three sequences for the foundation: assets, evidence and
-- work orders (section 12, phase 0; section 4.8; ADR 0002, point 13). The
-- first migration created the type with two of them. It has been merged, and
-- a migration that has been merged is not changed, so the third arrives here.
--
-- One value more in the enum and nothing else. The counter of a tenant is
-- created on first use, like every other, which is also why this migration
-- touches no row: all pending migrations run in one transaction, and a new
-- value of an enum may not be used in the transaction that adds it.
--
-- Before `evidence`, so that the order in the database is the order of the
-- list in the code: asset, work order, evidence, the way they follow each
-- other from the thing that is maintained to the proof that it was.

ALTER TYPE "public"."number_range_key" ADD VALUE 'work_order' BEFORE 'evidence';
