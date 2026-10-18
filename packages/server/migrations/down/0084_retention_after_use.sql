-- Takes the years after the use out of the end of a retention again, back
-- to how 0071 counted it. Run as the superuser, like every rollback.
CREATE OR REPLACE FUNCTION "evidence_retention_ends"(p_evidence uuid) RETURNS date
	LANGUAGE sql
	STABLE
	SET search_path = pg_catalog, public
AS $$
	WITH e AS (
		SELECT e.duty_id, e.performed_on, e.state -> 'retention' AS r
		  FROM public.evidence e
		 WHERE e.id = p_evidence AND e.emptied_at IS NULL
	), rule AS (
		SELECT e.performed_on,
		       CASE
		         WHEN e.r ->> 'kind' = 'years'
		           THEN (e.performed_on + make_interval(years => (e.r ->> 'years')::int))::date
		         WHEN e.r ->> 'kind' = 'while_in_use' AND d.asset_id IS NOT NULL
		           THEN (SELECT min(l.valid_from) FROM public.asset_lifecycle l
		                  WHERE l.asset_id = d.asset_id AND l.state = 'removed')
		         ELSE (SELECT min(n.performed_on) FROM public.evidence n
		                WHERE n.duty_id = e.duty_id AND n.performed_on > e.performed_on
		                  AND NOT EXISTS (SELECT 1 FROM public.evidence_voidings v WHERE v.evidence_id = n.id))
		       END AS day
		  FROM e
		  JOIN public.duties d ON d.id = e.duty_id
	)
	SELECT CASE
	         WHEN rule.day IS NULL THEN NULL
	         ELSE greatest(rule.day, (rule.performed_on + make_interval(years => coalesce(s.minimum_years, 0)))::date)
	       END
	  FROM rule
	  LEFT JOIN public.evidence_retention_settings s
	    ON s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
