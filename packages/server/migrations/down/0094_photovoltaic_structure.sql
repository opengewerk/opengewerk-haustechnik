-- Takes the PV structure below a PV installation out again, back to how 0093
-- left things. Run as the superuser, like every rollback.
--
-- What it costs an installation that runs it: every inverter with its strings
-- and modules. What the log of changes said about them it keeps. The function
-- that marks the structure goes back to the electrical structure alone, as
-- 0092 made it.
DROP TRIGGER IF EXISTS "inverters_keep_their_installation" ON "assets";--> statement-breakpoint
DROP TABLE IF EXISTS "pv_modules";--> statement-breakpoint
DROP TABLE IF EXISTS "pv_strings";--> statement-breakpoint
DROP TABLE IF EXISTS "inverters";--> statement-breakpoint
DROP FUNCTION IF EXISTS "inverters_on_a_photovoltaic_installation"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "mark_structure_below"() RETURNS trigger
	LANGUAGE plpgsql
	SET search_path = pg_catalog, public
AS $$
BEGIN
	IF old.deleted_at IS NOT NULL OR new.deleted_at IS NULL THEN
		RETURN NULL;
	END IF;

	IF tg_table_name = 'assets' THEN
		UPDATE public.distribution_boards SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND asset_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'distribution_boards' THEN
		UPDATE public.board_sections SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND distribution_board_id = new.id AND deleted_at IS NULL;
		UPDATE public.circuits SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND distribution_board_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'board_sections' THEN
		UPDATE public.circuits SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND board_section_id = new.id AND deleted_at IS NULL;
	ELSIF tg_table_name = 'circuits' THEN
		UPDATE public.equipment SET deleted_at = new.deleted_at
		 WHERE tenant_id = new.tenant_id AND circuit_id = new.id AND deleted_at IS NULL;
	END IF;

	RETURN NULL;
END;
$$;
