-- The circuit a defect was found on (#350, plan of #350, decision 6): a value
-- measured on a circuit of a low-voltage installation outside its limit, or a
-- check point of a circuit not in order, becomes a defect at the installation
-- with the signature, and names the circuit. The server writes it, like the
-- answer the defect came of; a device reads it and sends none.
--
-- `circuit_id`: a circuit of the asset of the defect, by the key over
-- `(tenant_id, circuit_id, asset_id)` onto `circuits_of_their_asset`, as the
-- parts of the structure keep to the asset of the part above them. It draws
-- the line between the areas the way they do: the defect hangs on an asset of
-- its property over its own keys, and its circuit on the same asset. A defect
-- on a circuit is at an asset, so that the key is always asked.
--
-- A circuit removed for good leaves the defect at its asset without the
-- circuit: the key empties only this column, `SET NULL ("circuit_id")`,
-- written by hand here, since drizzle has no words for the column list and
-- without it PostgreSQL empties the tenant and the asset as well. A circuit is
-- marked and not removed, so this happens only when its tenant goes.
--
-- The key is checked against every row of both tables, which have rows on an
-- installation: FORCE is taken off both for the statement and given back
-- after (#315). Every row has no circuit yet, so nothing is refused.
--
-- **Fits the version before it.** That version writes no circuit and reads
-- the column as it reads every column it does not know: not at all.
ALTER TABLE "defects" ADD COLUMN "circuit_id" uuid;--> statement-breakpoint
ALTER TABLE "defects" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "circuits" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_on_a_circuit_of_their_asset" FOREIGN KEY ("tenant_id","circuit_id","asset_id") REFERENCES "public"."circuits"("tenant_id","id","asset_id") ON DELETE SET NULL ("circuit_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "defects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "defects_circuit_idx" ON "defects" USING btree ("tenant_id","circuit_id");--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_circuit_at_an_asset" CHECK ("defects"."circuit_id" is null or "defects"."asset_id" is not null);
