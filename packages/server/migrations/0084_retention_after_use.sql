-- Evidence kept while its asset is used may stay for the years of a rule
-- after the end of that use (#437): the book of an evaporative cooling
-- system is kept five years from its last entry (§ 12 Abs. 3 of the
-- 42. BImSchV), and the book is made from that evidence. The frozen state
-- names the years in `yearsAfter` since its version 12; an evidence written
-- before names none and ends with the removal of its asset, as it did.
--
-- An entry "removed" of the life cycle that was taken back ends no
-- retention any more; until now one did.
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
		           THEN (SELECT (min(l.valid_from) + make_interval(years => coalesce((e.r ->> 'yearsAfter')::int, 0)))::date
		                   FROM public.asset_lifecycle l
		                  WHERE l.asset_id = d.asset_id AND l.state = 'removed' AND l.deleted_at IS NULL)
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
