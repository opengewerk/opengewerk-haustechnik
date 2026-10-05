# What the checks of a running stack in test-stack.sh need to know about this
# application and can read nowhere else (opengewerk-haustechnik#14). The steps
# are the foundation's, in upstream/opengewerk/docker; read with "." once the
# helpers there are defined, so the functions below may use sql, value,
# compose, restart_app, store_file and $base, and the two tenants test-stack.sh
# creates are $first_tenant and $second_tenant.
#
# What a backup has to bring back besides the tenants, the audit log and the
# file store: what the foundation keeps for this application, accounts, the
# roles of a Betreiber and who works for which, and the sign in that rests on
# them; the areas of a Betreiber with who sees which
# (opengewerk-haustechnik#17) and what an invitation says about them
# (opengewerk-haustechnik#84); the first record with a place, a property
# (opengewerk-haustechnik#18); a building on it with the first asset
# (opengewerk-haustechnik#20); a file in the store with its row and the mail
# server of a Betreiber, the two tables the foundation brings since
# opengewerk-haustechnik#23; a setting for a kind of deadline with a pass of
# the deadline engine, the two it brings since opengewerk-haustechnik#24; and a
# duty at the asset with a dismissed proposal beside it, an evidence of the
# duty and the deadline the engine keeps from it (opengewerk-haustechnik#25);
# a work order with a defect, its signature and its rejection, and an evidence
# declared invalid (opengewerk-haustechnik#26).

# A route touching data, which refuses everybody without a sign in: the
# accounts of a Betreiber.
guarded_route=/staff

# The tables counted before the backup and after the restore. The area and
# the place of the account in it come with the account: a Betreiber gets its
# first area with its first membership.
counted_tables='auth_users memberships tenant_roles areas member_areas invitations invitation_area_choices invitation_areas properties buildings contacts assets files mail_settings deadline_settings deadline_runs duties duty_dismissals evidence deadlines activities activity_duties work_orders defects activity_signatures work_order_decisions evidence_voidings'

# The migrations, and how many of them make the older state an update starts
# from: the first, without the sequence for work orders that the second brings.
migrations="$here/../packages/server/migrations"
older_migrations=1

# What the update from that state adds to the log of a tenant that was there
# before, as "<table> (<reason>)": the migration of the areas gives the account
# that worked there the first area of its Betreiber, and the tenant written
# with SQL gets the roles a Betreiber begins with when the application starts
# again. Those are changes like any other.
update_adds='areas (migration), member_areas (migration), tenant_roles (roles.complete)'

# An account of the first Betreiber with a password, made with the command an
# operator has for it, so that the sign in can be tried after the restore. A
# probe value for a stack that exists for this run only, handed to the command
# through the environment and never as an argument, as the command asks.
probe_email='haustechnik@probe.example.de'
probe_password='ein-ordentlich-langes-probepasswort'

records_for_backup() {
  # add-staff checks the role against the roles of the Betreiber, and a tenant
  # written with SQL has none until the application starts again.
  restart_app
  HAUSTECHNIK_PASSWORD=$probe_password compose exec -T -e HAUSTECHNIK_PASSWORD app \
    node dist/add-staff.js "$first_tenant" "$probe_email" 'Hanna Probe' technician
  # An invitation that names the area of the Betreiber for whoever takes it up
  # (opengewerk-haustechnik#84). The hash stands for a link nobody has.
  sql "
    insert into invitations (tenant_id, email, name, roles, token_hash, invited_by, expires_at)
    select '$first_tenant', 'neu@probe.example.de', 'Nele Neu', '{technician}', repeat('b', 64),
           u.id, now() + interval '7 days'
      from auth_users u where u.email = '$probe_email';
    insert into invitation_area_choices (tenant_id, invitation_id, every_area)
    select tenant_id, id, false from invitations where tenant_id = '$first_tenant';
    insert into invitation_areas (tenant_id, invitation_id, area_id)
    select i.tenant_id, i.id, a.id
      from invitations i join areas a on a.tenant_id = i.tenant_id
     where i.tenant_id = '$first_tenant';"
  # The membership gave the Betreiber its first area; a property goes into it,
  # with a building and an asset in that. The kind is one of the probe package:
  # the database keeps the key, the catalogue is asked by the routes.
  sql "
    insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
    select '$first_tenant', id, 'Campus Probe', 'Probestraße 1', '68535', 'Edingen-Neckarhausen', 'DE-BW'
      from areas where tenant_id = '$first_tenant';
    insert into buildings (tenant_id, property_id, area_id, name, kinds)
    select tenant_id, id, area_id, 'Haus A', '{school}'
      from properties where tenant_id = '$first_tenant';
    insert into assets (tenant_id, property_id, area_id, building_id, kind, name)
    select tenant_id, property_id, area_id, id, 'probe.elevator', 'Aufzug Haus A'
      from buildings where tenant_id = '$first_tenant';"
  # Somebody to talk to at the property (opengewerk-haustechnik#85), in the
  # area of it. The table is the foundation's, what a contact hangs on is ours.
  sql "
    insert into contacts (tenant_id, property_id, area_id, given_name, family_name, role, phone)
    select tenant_id, id, area_id, 'Jens', 'Probe', 'Hausmeister', '0000 4471'
      from properties where tenant_id = '$first_tenant';"
  # A file in the store with the row that makes it one, and a mail server. Both
  # tables come with the foundation (opengewerk-haustechnik#23); what writes
  # them comes with the documents and the notifications of phase 1, so until
  # then this file is the one the comparison of the store finds.
  hash=$(store_file 'Bericht Aufzug Haus A')
  sql "
    insert into files (tenant_id, sha256, size_bytes, media_type) values
      ('$first_tenant', '$hash', 21, 'text/plain');
    insert into mail_settings (tenant_id, host, port, security, from_address) values
      ('$first_tenant', 'mail.probe.example.de', 587, 'starttls', 'technik@probe.example.de');"
  # A setting for the kind of deadline of the duties, a table the foundation
  # brings since opengewerk-haustechnik#24. The passes of the engine
  # (`deadline_runs`) are written by the engine itself, below.
  sql "
    insert into deadline_settings (tenant_id, kind, lead_days) values
      ('$first_tenant', 'duty.due', 14);"
  # A duty of the catalogue at the asset, confirmed by the account, and a
  # proposal it dismissed with its reason (opengewerk-haustechnik#25). The kinds
  # are keys of the probe package, as the asset's is.
  sql "
    insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                        interval_months, maximum_months, confirmed_by)
    select a.tenant_id, a.property_id, a.area_id, a.id, 'probe.elevator_main_test', 1, 'betrsichv',
           24, 24, u.id
      from assets a, auth_users u
     where a.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into duty_dismissals (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                                 reason, dismissed_by)
    select a.tenant_id, a.property_id, a.area_id, a.id, 'probe.elevator_annual_check', 1,
           'Die Anlage hat keine Notrufeinrichtung.', u.id
      from assets a, auth_users u
     where a.tenant_id = '$first_tenant' and u.email = '$probe_email';"
  # A work order at the asset to meet the duty, and a defect noticed in it
  # (opengewerk-haustechnik#26). What writes them comes with the rounds, the
  # protocols and the work orders of phase 1.
  sql "
    insert into activities (tenant_id, property_id, area_id, asset_id, kind, title)
    select tenant_id, property_id, area_id, id, 'work_order', 'Hauptprüfung Aufzug Haus A'
      from assets where tenant_id = '$first_tenant';
    insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
    select a.tenant_id, a.property_id, a.area_id, a.id, d.id
      from activities a join duties d on d.tenant_id = a.tenant_id and d.asset_id = a.asset_id
     where a.tenant_id = '$first_tenant';
    insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
    select tenant_id, property_id, area_id, id, 'AU-2026-0001', 'inspection'
      from activities where tenant_id = '$first_tenant';
    insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id,
                         description, found_on)
    select tenant_id, property_id, area_id, asset_id, id, 'Notruf im Fahrkorb ohne Verbindung.',
           '2026-10-01'
      from activities where tenant_id = '$first_tenant';
    insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                     signed_at, path, page_fingerprint)
    select a.tenant_id, a.property_id, a.area_id, a.id, u.id, 'signer', '2026-10-01T09:30:00Z',
           'M10,10L200,300', repeat('a', 64)
      from activities a, auth_users u
     where a.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into work_order_decisions (tenant_id, property_id, area_id, work_order_id, decision,
                                      reason, decided_by)
    select w.tenant_id, w.property_id, w.area_id, w.id, 'rejected',
           'Die Notrufverbindung fehlt noch.', u.id
      from work_orders w, auth_users u
     where w.tenant_id = '$first_tenant' and u.email = '$probe_email';"
  # An evidence of the duty. The engine runs in the application, its first pass
  # ten seconds after the start and then once a minute, and keeps a deadline
  # for the duty from it; the backup brings back what the pass wrote, the
  # deadline and the pass of every operator. Waited for here, so that nothing
  # of it is written between the count before the backup and the backup.
  # The state is the least a report has (#26), written as JSON, and the
  # fingerprint a placeholder of the right form: nothing here reads it back.
  # An older evidence beside it is declared invalid, so the deadline still
  # counts from the first.
  sql "
    insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result, number,
                          origin, examiner, examiner_organisation, written_by, state, fingerprint)
    select d.tenant_id, d.property_id, d.area_id, d.id, '2025-03-14', 'without_defects',
           'NW-2025-00001', 'report', 'Erika Muster', 'Prüfstelle Süd', u.id,
           '{\"version\": 1, \"number\": \"NW-2025-00001\", \"origin\": \"report\"}',
           repeat('0', 64)
      from duties d, auth_users u
     where d.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result, number,
                          origin, examiner, examiner_organisation, written_by, state, fingerprint)
    select d.tenant_id, d.property_id, d.area_id, d.id, '2025-01-10', 'without_defects',
           'NW-2025-00002', 'report', 'Erika Muster', 'Prüfstelle Süd', u.id,
           '{\"version\": 2, \"number\": \"NW-2025-00002\", \"origin\": \"report\"}',
           repeat('0', 64)
      from duties d, auth_users u
     where d.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
    select e.tenant_id, e.property_id, e.area_id, e.id, 'Der Bericht gehört zu einer anderen Anlage.',
           u.id
      from evidence e, auth_users u
     where e.number = 'NW-2025-00002' and u.email = '$probe_email';"
  waited=0
  until test "$(value "select count(*) from deadlines where tenant_id = '$first_tenant'")" = 1 &&
    test "$(value "select count(*) from deadline_runs where succeeded_at is not null")" = \
      "$(value 'select count(*) from tenants')"; do
    waited=$((waited + 1))
    if [ "$waited" -gt 120 ]; then
      echo 'Der Lauf der Fristen hat in zwei Minuten keine Frist für die Pflicht geschrieben.'
      exit 1
    fi
    sleep 1
  done
  echo "Der Lauf der Fristen hat die Frist der Pflicht nach ${waited} Sekunden geschrieben."
}

# An account and its place at the Betreiber on the older state, written with
# SQL: the application of this checkout does not run on that state.
records_for_update() {
  sql "
    insert into auth_users (id, name, email) values ('u-probe', 'Hanna Probe', '$probe_email');
    insert into memberships (tenant_id, user_id, roles) values ('$first_tenant', 'u-probe', '{technician}');"
}

# After the restore the account signs in with the password it had before the
# backup (opengewerk-haustechnik#15). The answer is a session, which also
# means its sign in was written to the restored database.
after_restore() {
  status=$(curl --silent --output "$temp/sign-in.json" --write-out '%{http_code}' \
    --header 'Content-Type: application/json' --header "Origin: $base" \
    --data "{\"email\":\"$probe_email\",\"password\":\"$probe_password\"}" \
    "$base/api/auth/sign-in/email")
  echo "Anmeldung nach dem Rückspielen: ${status}"
  test "${status}" = 200
  echo 'Das Konto von vor der Sicherung meldet sich mit seinem Passwort an.'
}

# The sequence the second migration brings, in its place in the list, the
# account from before the update with its place at the Betreiber, and the first
# area of the Betreiber with the account in it.
after_update() {
  kinds=$(value "select string_agg(enumlabel, ' ' order by enumsortorder) from pg_enum where enumtypid = 'number_range_key'::regtype")
  echo "Nummernkreise nach dem Update: ${kinds}"
  test "${kinds}" = 'asset work_order evidence'
  test "$(value "select count(*) from memberships where user_id = 'u-probe'")" = 1
  areas=$(value "select string_agg(a.name, ', ') from areas a join member_areas m on m.area_id = a.id where m.user_id = 'u-probe' and m.tenant_id = '$first_tenant'")
  echo "Bereiche des Zugangs nach dem Update: ${areas}"
  test "${areas}" = 'Alle Liegenschaften'
  echo 'Der Zugang von vor dem Update ist da, sieht den ersten Bereich seines Betreibers, und der Nummernkreis für Aufträge ist dazugekommen.'
}
