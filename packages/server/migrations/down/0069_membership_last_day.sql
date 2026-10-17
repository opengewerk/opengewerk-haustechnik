-- Takes the last day of memberships and invitations out again, back to how
-- 0068 left things.
--
-- The three functions go back to the bodies that read no last day first, then
-- the columns go without asking, and with them every last day an operator had
-- set: those memberships run on without an end. Run as the superuser, like
-- every rollback.
CREATE OR REPLACE FUNCTION "tenants_with_leads"()
	RETURNS TABLE (id uuid, name text, created_at timestamptz, leads text[], members bigint, invited_leads text[])
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, public
AS $$
	SELECT t.id, t.name, t.created_at,
	       coalesce((SELECT array_agg(m.user_id ORDER BY m.created_at) FROM public.memberships m
	                  WHERE m.tenant_id = t.id AND m.blocked_at IS NULL
	                    AND EXISTS (SELECT 1 FROM public.tenant_roles r
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (m.roles))), '{}'),
	       (SELECT count(*) FROM public.memberships m WHERE m.tenant_id = t.id),
	       coalesce((SELECT array_agg(i.email ORDER BY i.created_at) FROM public.invitations i
	                  WHERE i.tenant_id = t.id
	                    AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
	                    AND EXISTS (SELECT 1 FROM public.tenant_roles r
	                                 WHERE r.tenant_id = t.id AND r.leads AND r.key = ANY (i.roles))), '{}')
	  FROM public.tenants t
	 ORDER BY t.created_at, t.name
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "session_sees_all_areas"() RETURNS boolean
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(current_setting('app.all_areas', true), '') = 'on'
	    OR EXISTS (
	         SELECT 1
	           FROM public.member_all_areas a
	           JOIN public.memberships m
	             ON m.tenant_id = a.tenant_id AND m.user_id = a.user_id
	          WHERE a.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	            AND a.user_id = nullif(current_setting('app.user_id', true), '')
	            AND m.blocked_at IS NULL)
	    OR EXISTS (
	         SELECT 1
	           FROM public.substitutions s
	           JOIN public.memberships m
	             ON m.tenant_id = s.tenant_id AND m.user_id = s.substitute_user_id
	           JOIN public.member_all_areas a
	             ON a.tenant_id = s.tenant_id AND a.user_id = s.absent_user_id
	          WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	            AND s.substitute_user_id = nullif(current_setting('app.user_id', true), '')
	            AND m.blocked_at IS NULL
	            AND (now() AT TIME ZONE 'Europe/Berlin')::date BETWEEN s.starts_on AND s.ends_on)
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "session_areas"() RETURNS uuid[]
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	SELECT coalesce(array_agg(DISTINCT held.area_id), '{}'::uuid[])
	  FROM (
	    SELECT ma.area_id
	      FROM public.member_areas ma
	      JOIN public.memberships m
	        ON m.tenant_id = ma.tenant_id AND m.user_id = ma.user_id
	     WHERE ma.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	       AND ma.user_id = nullif(current_setting('app.user_id', true), '')
	       AND m.blocked_at IS NULL
	    UNION ALL
	    SELECT ma.area_id
	      FROM public.substitutions s
	      JOIN public.memberships m
	        ON m.tenant_id = s.tenant_id AND m.user_id = s.substitute_user_id
	      JOIN public.member_areas ma
	        ON ma.tenant_id = s.tenant_id AND ma.user_id = s.absent_user_id
	     WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
	       AND s.substitute_user_id = nullif(current_setting('app.user_id', true), '')
	       AND m.blocked_at IS NULL
	       AND (now() AT TIME ZONE 'Europe/Berlin')::date BETWEEN s.starts_on AND s.ends_on
	    UNION ALL
	    SELECT nullif(current_setting('app.label_area', true), '')::uuid
	     WHERE nullif(current_setting('app.user_id', true), '') IS NULL
	       AND nullif(current_setting('app.label_area', true), '') IS NOT NULL
	  ) AS held
$$;--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN IF EXISTS "last_day";--> statement-breakpoint
ALTER TABLE "invitations" DROP COLUMN IF EXISTS "last_day";
