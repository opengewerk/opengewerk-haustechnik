-- Takes the asset kinds and fields of an operator's own out again, back to how
-- 0078 left things, and the right "Eigene Anlagenarten und Felder führen" out
-- of every role that holds it. Run as the superuser, like every rollback.
--
-- What it costs an installation that runs it: every own kind and own field.
-- An asset that carries an own kind keeps its key and its values, which the
-- version before this one cannot read; take such assets to a kind of a
-- package before.
DROP FUNCTION IF EXISTS "own_kind_uses"();--> statement-breakpoint
DROP TABLE IF EXISTS "own_asset_fields";--> statement-breakpoint
DROP TABLE IF EXISTS "own_asset_kinds";--> statement-breakpoint
ALTER TABLE "tenant_roles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
SELECT set_config('app.reason', 'migration', true);--> statement-breakpoint
UPDATE "tenant_roles"
   SET "rights" = array_remove("rights", 'kind.write'),
       "updated_at" = now()
 WHERE 'kind.write' = ANY ("rights");--> statement-breakpoint
SELECT set_config('app.reason', '', true);--> statement-breakpoint
ALTER TABLE "tenant_roles" FORCE ROW LEVEL SECURITY;
