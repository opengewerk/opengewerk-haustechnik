-- Takes the circuit of a defect out again, back to how 0092 left things. Run
-- as the superuser, like every rollback.
--
-- What it costs an installation that runs it: a defect found on a circuit
-- stays at its installation and no longer names the circuit. Its description
-- still says it, and the evidence of the test keeps every circuit as it was.
ALTER TABLE "defects" DROP CONSTRAINT IF EXISTS "defects_circuit_at_an_asset";--> statement-breakpoint
DROP INDEX IF EXISTS "defects_circuit_idx";--> statement-breakpoint
ALTER TABLE "defects" DROP CONSTRAINT IF EXISTS "defects_on_a_circuit_of_their_asset";--> statement-breakpoint
ALTER TABLE "defects" DROP COLUMN IF EXISTS "circuit_id";
