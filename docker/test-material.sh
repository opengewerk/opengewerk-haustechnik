# What the checks of a running stack in test-stack.sh need to know about this
# application and can read nowhere else (opengewerk-haustechnik#14). The steps
# are the foundation's, in upstream/opengewerk/docker; read with "." once the
# helpers there are defined, so the functions below may use sql, value,
# compose, restart_app, fail, $base and $temp, and the two tenants
# test-stack.sh creates are $first_tenant and $second_tenant.
#
# What a backup has to bring back besides the tenants, the audit log and the
# file store: what the foundation keeps for this application, accounts, the
# roles of a Betreiber and who works for which, and the sign in that rests on
# them; the areas of a Betreiber with who sees which
# (opengewerk-haustechnik#17) and what an invitation says about them
# (opengewerk-haustechnik#84); the first record with a place, a property
# (opengewerk-haustechnik#18); a building on it with the first asset
# (opengewerk-haustechnik#20); a file the account sent through the route of
# the store, with the row that makes it a file of the Betreiber
# (opengewerk-haustechnik#96), and the mail server of a Betreiber, the two
# tables the foundation brings since opengewerk-haustechnik#23; a setting for
# a kind of deadline with a pass of
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
counted_tables='auth_users memberships tenant_roles account_corrections areas member_areas invitations invitation_area_choices invitation_areas properties buildings contacts building_closures assets files mail_settings deadline_settings deadline_runs duties duty_dismissals evidence deadlines activities activity_duties activity_answers work_orders work_order_participants work_order_notes defects fault_categories fault_reports meter_points meter_readings meter_exchanges meter_pauses meter_settings work_order_settings activity_signatures work_order_decisions service_reports service_report_records briefings work_permits articles suppliers stores store_articles stock_movements work_order_materials store_labels contractors contracts contract_items evidence_voidings round_records prints attachments attachment_versions labels imports asset_kind_names defect_class_terms round_templates round_template_versions round_plans tasks mail_outbox push_subscriptions push_opt_outs push_outbox'

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

# What the account sends through the route of the file store before the backup
# (opengewerk-haustechnik#96). The store keeps it under the hash of this text.
probe_file='Prüfbericht Aufzug Haus A'

# An account of the Leitung of the first Betreiber, made after the backup with
# the same command and password, to ask the route of the last backup, which
# only the Leitung sees (opengewerk-haustechnik#127). It is in no backup, so
# the comparison after the restore does not know it.
lead_email='leitung@probe.example.de'

# Signs the probe account in, or the account whose address is handed in, and
# has it work for the first Betreiber, the way a browser does. Prints the
# cookies of the session and nothing else: the password goes to curl in the
# body of the request and into no output.
probe_session() {
  email=${1:-$probe_email}
  status=$(curl --silent --output /dev/null --dump-header "$temp/probe-sign-in.txt" --write-out '%{http_code}' \
    --header 'Content-Type: application/json' --header "Origin: $base" \
    --data "{\"email\":\"$email\",\"password\":\"$probe_password\"}" \
    "$base/api/auth/sign-in/email")
  [ "$status" = 200 ] || fail "Die Anmeldung des Probekontos ist gescheitert: ${status}"

  # Every cookie the answer set, name and value without its attributes, as
  # one header: "a=1; b=2".
  cookies=$(grep -i '^set-cookie:' "$temp/probe-sign-in.txt" | sed 's/^[^:]*: *//; s/;.*//' | tr -d '\r' | paste -s -d ';' - | sed 's/;/; /g')
  [ -n "$cookies" ] || fail 'Die Anmeldung des Probekontos hat kein Cookie gesetzt.'

  status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --header "Cookie: $cookies" --header 'Content-Type: application/json' --header "Origin: $base" \
    --data "{\"tenantId\":\"$first_tenant\"}" "$base/auth/tenant")
  [ "$status" = 201 ] || fail "Das Probekonto konnte seinen Betreiber nicht wählen: ${status}"

  printf '%s\n' "$cookies"
}

# Sends the probe file the way a device sends one: as bytes, to the address
# their hash names, in the session whose cookies are handed in.
send_probe_file() {
  printf '%s' "$probe_file" > "$temp/probe-file.bin"
  hash=$(sha256sum "$temp/probe-file.bin" | cut -d' ' -f1)
  status=$(curl --silent --output "$temp/probe-file.json" --write-out '%{http_code}' --request PUT \
    --header "Cookie: $1" --header 'Content-Type: application/octet-stream' \
    --header 'X-Media-Type: text/plain' --header "Origin: $base" \
    --data-binary "@$temp/probe-file.bin" "$base/files/$hash")
  echo "PUT /files/${hash}: ${status}"

  if [ "$status" != 200 ]; then
    cat "$temp/probe-file.json"
    fail 'Die Datei ließ sich nicht über die Route des Dateispeichers ablegen.'
  fi
}

records_for_backup() {
  # add-staff checks the role against the roles of the Betreiber, and a tenant
  # written with SQL has none until the application starts again.
  restart_app
  HAUSTECHNIK_PASSWORD=$probe_password compose exec -T -e HAUSTECHNIK_PASSWORD app \
    node dist/add-staff.js "$first_tenant" "$probe_email" 'Hanna Probe' technician
  # A correction of the name of that account (opengewerk-haustechnik#84), as
  # the row the route writes beside the change. Only the row: the name of the
  # account stays as the command made it.
  sql "
    insert into account_corrections (tenant_id, user_id, name_before, name_after)
    select '$first_tenant', u.id, 'Hanna Brobe', 'Hanna Probe'
      from auth_users u where u.email = '$probe_email';"
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
  # A time the building is closed (opengewerk-haustechnik#86), on the property
  # and in the area of it.
  sql "
    insert into building_closures (tenant_id, building_id, property_id, area_id, starts_on, ends_on, reason)
    select tenant_id, id, property_id, area_id, '2026-12-24', '2027-01-06', 'Weihnachtsferien'
      from buildings where tenant_id = '$first_tenant';"
  # A file in the store, sent through the route the way a device sends one
  # (opengewerk-haustechnik#96): the account signs in, works for its Betreiber
  # and puts the bytes to the address their hash names. The route writes the
  # file into the volume and the row that makes it a file of the Betreiber;
  # the comparison of the store finds the first, the count of the rows the
  # second, and after_restore below looks at both once more.
  cookies=$(probe_session)
  send_probe_file "$cookies"
  stored=$(value "select count(*) from files where tenant_id = '$first_tenant' and media_type = 'text/plain'")
  echo "Dateien des Betreibers nach dem Ablegen: ${stored}"
  test "${stored}" = 1
  # A document at the asset whose one version names that file
  # (opengewerk-haustechnik#97), in the area of the asset. The tables are the
  # foundation's, what a document hangs on is ours. A device would send both
  # through the sync; after_restore below asks the server for the file through
  # the version.
  sql "
    insert into attachments (tenant_id, property_id, area_id, asset_id, title, kind)
    select tenant_id, property_id, area_id, id, 'Bericht Aufzug Haus A', 'test_certificate'
      from assets where tenant_id = '$first_tenant';
    insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
    select a.tenant_id, a.id, f.sha256, 'bericht-aufzug.txt', f.media_type, f.size_bytes
      from attachments a join files f on f.tenant_id = a.tenant_id
     where a.tenant_id = '$first_tenant';"
  # A label on the asset (opengewerk-haustechnik#98), in the area of the
  # asset, with a code in the shape the foundation draws. The office makes one
  # at its route; here it is a row like the others, counted before the backup
  # and after the restore.
  sql "
    insert into labels (tenant_id, property_id, area_id, asset_id, code)
    select tenant_id, property_id, area_id, id, '3XQ7M2K9PDH4TA6W'
      from assets where tenant_id = '$first_tenant' order by id limit 1;"
  # An import and a word for an asset kind (opengewerk-haustechnik#100): the
  # one row the log shows of a list that was taken over, and what the lists
  # of this Betreiber call a kind. Rows like the others, counted before the
  # backup and after the restore.
  sql "
    insert into imports (tenant_id, kind, file_name, lines, summary)
    values ('$first_tenant', 'assets', 'anlagen-werkhof.xlsx', 38, '38 Anlagen angelegt');
    insert into asset_kind_names (tenant_id, name, name_key, kind)
    values ('$first_tenant', 'Aufzug', 'aufzug', 'allgemein.conveying_system');"
  # The default of a class of defects (opengewerk-haustechnik#116), which the
  # office sets under "Einstellungen". A row like the others, counted before
  # the backup and after the restore.
  sql "
    insert into defect_class_terms (tenant_id, defect_class, due_days)
    values ('$first_tenant', 'allgemein.significant', 14);"
  # A task at the asset (opengewerk-haustechnik#124), for somebody who works
  # for this Betreiber, in the area of the asset. A device would send it
  # through the sync; here it is a row like the others, counted before the
  # backup and after the restore.
  sql "
    insert into tasks (tenant_id, property_id, area_id, asset_id, title, due_on, assignee_user_id)
    select a.tenant_id, a.property_id, a.area_id, a.id, 'Typenschild fotografieren', date '2026-10-20', m.user_id
      from assets a join memberships m on m.tenant_id = a.tenant_id
     where a.tenant_id = '$first_tenant' order by a.id, m.user_id limit 1;"
  # A message by mail, a device that takes push, an occasion its person
  # switched off and a push message to that device
  # (opengewerk-haustechnik#126). Both messages are gone already: the jobs of
  # a running instance leave them as they are, and no address here is asked.
  # The device has no session, so the job that takes signed out devices off
  # keeps it.
  sql "
    insert into mail_outbox (tenant_id, kind, cause, sender_name, recipient_address, subject, body, status, sent_at)
    values ('$first_tenant', 'deadline_due', 'deadline_due:probe:2027-03-01', 'Probe', '$probe_email',
            'Frist am 01.03.2027', 'Guten Tag', 'sent', now());
    insert into push_subscriptions (tenant_id, user_id, entry, label, endpoint, p256dh, auth)
    select m.tenant_id, m.user_id, 'office', 'Firefox auf Windows', 'https://push.probe.example.de/a', 'BPublic', 'Secret'
      from memberships m where m.tenant_id = '$first_tenant' order by m.user_id limit 1;
    insert into push_opt_outs (tenant_id, user_id, occasion)
    select m.tenant_id, m.user_id, 'task_due'
      from memberships m where m.tenant_id = '$first_tenant' order by m.user_id limit 1;
    insert into push_outbox (tenant_id, kind, cause, subscription_id, title, body, url, status, sent_at, expires_at)
    select s.tenant_id, 'deadline_due', 'deadline_due:probe:2027-03-01', s.id, 'Frist am 01.03.2027',
           'Fälligkeit einer Pflicht', '/fristen', 'sent', now(), now() + interval '1 day'
      from push_subscriptions s where s.tenant_id = '$first_tenant';"
  # A mail server, whose table comes with the foundation as well
  # (opengewerk-haustechnik#23). The Leitung sets it under
  # "E-Mail-Einstellungen" (opengewerk-haustechnik#126).
  sql "
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
  # A work order at the asset to meet the duty, a defect noticed in it
  # (opengewerk-haustechnik#26) and the answer to a point of its form (#106),
  # given before the signature, which keeps it from then on. What writes them
  # comes with the rounds, the protocols and the work orders of phase 1.
  sql "
    insert into activities (tenant_id, property_id, area_id, asset_id, kind, title)
    select tenant_id, property_id, area_id, id, 'work_order', 'Hauptprüfung Aufzug Haus A'
      from assets where tenant_id = '$first_tenant';
    insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
    select a.tenant_id, a.property_id, a.area_id, a.id, d.id
      from activities a join duties d on d.tenant_id = a.tenant_id and d.asset_id = a.asset_id
     where a.tenant_id = '$first_tenant';
    insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind, urgency)
    select tenant_id, property_id, area_id, id, 'AU-2026-0001', 'inspection', 'urgent'
      from activities where tenant_id = '$first_tenant';
    insert into work_order_participants (tenant_id, property_id, area_id, activity_id, user_id)
    select a.tenant_id, a.property_id, a.area_id, a.id, u.id
      from activities a, auth_users u
     where a.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into meter_points (tenant_id, property_id, area_id, asset_id, conversion_factor)
    select tenant_id, property_id, area_id, id, 40 from assets where tenant_id = '$first_tenant';
    insert into meter_readings (tenant_id, property_id, area_id, asset_id, key_date, read_on,
                                value_milli, source, recorded_by)
    select a.tenant_id, a.property_id, a.area_id, a.id, '2026-10-01', '2026-10-05', 4812000, 'by_hand', u.id
      from assets a, auth_users u
     where a.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into meter_exchanges (tenant_id, property_id, area_id, asset_id, exchanged_on, old_number,
                                 old_end_milli, new_number, new_start_milli)
    select tenant_id, property_id, area_id, id, '2026-10-14', '13-882914', 4839700, '13-920455', 0
      from assets where tenant_id = '$first_tenant';
    insert into meter_pauses (tenant_id, property_id, area_id, asset_id, starts_on, reason)
    select tenant_id, property_id, area_id, id, '2026-08-01', 'Sommerferien'
      from assets where tenant_id = '$first_tenant';
    insert into meter_settings (tenant_id, key_day) values ('$first_tenant', 15);
    insert into work_order_notes (tenant_id, property_id, area_id, activity_id, text,
                                  written_at, written_by)
    select a.tenant_id, a.property_id, a.area_id, a.id, 'Notrufgerät getauscht.',
           '2026-10-01T09:20:00Z', u.id
      from activities a, auth_users u
     where a.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id,
                         description, found_on)
    select tenant_id, property_id, area_id, asset_id, id, 'Notruf im Fahrkorb ohne Verbindung.',
           '2026-10-01'
      from activities where tenant_id = '$first_tenant';
    -- A category and a fault reported at the asset (#331).
    insert into fault_categories (tenant_id, name, position)
    select id, 'Aufzug', 0 from tenants where id = '$first_tenant';
    insert into fault_reports (tenant_id, property_id, area_id, building_id, asset_id, category_id,
                               description, reported_by)
    select a.tenant_id, a.property_id, a.area_id, a.building_id, a.id, c.id,
           'Der Aufzug hält zwischen den Geschossen.', u.id
      from assets a, fault_categories c, auth_users u
     where a.tenant_id = '$first_tenant' and c.tenant_id = a.tenant_id and u.email = '$probe_email';
    insert into round_templates (tenant_id, title)
    select id, 'Technikzentrale' from tenants where id = '$first_tenant';
    insert into round_template_versions (tenant_id, template_id, form_version, definition,
                                         asks_countersignature)
    select tenant_id, id, 1, '{\"title\": \"Technikzentrale\", \"sections\": []}', true
      from round_templates where tenant_id = '$first_tenant';
    -- A plan of a round that rests (#113): a row the backup carries and the
    -- deadline engine leaves alone. A running plan makes its rounds and moves
    -- its deadline after the count, and the log after the restore is longer.
    insert into round_plans (tenant_id, property_id, building_id, area_id, template_id, rhythm,
                             weekdays, starts_on, resting)
    select b.tenant_id, b.property_id, b.id, b.area_id, t.id, 'weekly', '{3}', '2026-10-07', true
      from buildings b, round_templates t
     where b.tenant_id = '$first_tenant' and t.tenant_id = '$first_tenant';
    insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, result,
                                  remark)
    select tenant_id, property_id, area_id, id, 'emergency_call', 'not_ok',
           'Notruf im Fahrkorb ohne Verbindung.'
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
     where e.number = 'NW-2025-00002' and u.email = '$probe_email';
    insert into round_records (tenant_id, property_id, area_id, activity_id, state, fingerprint)
    select tenant_id, property_id, area_id, id, '{\"version\": 1, \"title\": \"Rundgang Probe\"}',
           repeat('0', 64)
      from activities where tenant_id = '$first_tenant';
    insert into prints (tenant_id, property_id, area_id, evidence_id, sha256)
    select e.tenant_id, e.property_id, e.area_id, e.id, f.sha256
      from evidence e join files f on f.tenant_id = e.tenant_id
     where e.number = 'NW-2025-00001';
    insert into work_order_settings (tenant_id, names_and_times) values ('$first_tenant', true);
    insert into articles (tenant_id, number, designation, unit, price_cents)
    values ('$first_tenant', 'A-1002', 'Akku Notleuchte', 'piece', 890);
    insert into suppliers (tenant_id, name) values ('$first_tenant', 'Großhandel Probe');
    insert into contractors (tenant_id, name, services) values ('$first_tenant', 'Fremdfirma Probe', '{440}');
    insert into contracts (tenant_id, contractor_id, title, starts_on, ends_on, renewal_months,
                           notice_amount, notice_unit)
    select tenant_id, id, 'Wartung Probe', '2026-01-01', '2026-12-31', 12, 3, 'months'
      from contractors where tenant_id = '$first_tenant';
    insert into contract_items (tenant_id, contract_id, property_id, area_id, asset_id)
    select a.tenant_id, c.id, a.property_id, a.area_id, a.id
      from contracts c join assets a on a.tenant_id = c.tenant_id
     where c.tenant_id = '$first_tenant';
    insert into stores (tenant_id, name) values ('$first_tenant', 'Hauptlager Probe');
    insert into store_articles (tenant_id, store_id, article_id, minimum_milli)
    select s.tenant_id, s.id, a.id, 10000 from stores s, articles a where s.tenant_id = '$first_tenant'
       and a.tenant_id = '$first_tenant';
    insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, supplier_id, booked_by)
    select s.tenant_id, s.id, a.id, 'receipt', 6000, p.id, u.id
      from stores s, articles a, suppliers p, auth_users u
     where s.tenant_id = '$first_tenant' and a.tenant_id = '$first_tenant'
       and p.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into work_order_materials (tenant_id, property_id, area_id, activity_id, store_id, article_id,
                                      quantity_milli, taken_at, taken_by)
    select w.tenant_id, w.property_id, w.area_id, w.id, s.id, ar.id, 1000, '2026-10-01T09:20:00Z', u.id
      from activities w, stores s, articles ar, auth_users u
     where w.tenant_id = '$first_tenant' and w.kind = 'work_order' and s.tenant_id = '$first_tenant'
       and ar.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, booked_by, material_id)
    select tenant_id, store_id, article_id, 'withdrawal', quantity_milli, taken_by, id
      from work_order_materials where tenant_id = '$first_tenant';
    insert into store_labels (tenant_id, store_article_id, code)
    select tenant_id, id, 'MATERA7REGA3B5XY' from store_articles where tenant_id = '$first_tenant';
    insert into service_reports (tenant_id, property_id, area_id, activity_id, client_name, path,
                                 signed_by, signed_at, page_fingerprint)
    select a.tenant_id, a.property_id, a.area_id, a.id, 'Petra Probe', 'M10,10L200,300', u.id,
           '2026-10-01T09:20:00Z', repeat('d', 64)
      from activities a, auth_users u
     where a.tenant_id = '$first_tenant' and u.email = '$probe_email';
    insert into service_report_records (tenant_id, property_id, area_id, service_report_id,
                                        state, fingerprint)
    select tenant_id, property_id, area_id, id,
           '{\"version\": 1, \"holder\": \"Probe\"}', repeat('0', 64)
      from service_reports where tenant_id = '$first_tenant';
    insert into briefings (tenant_id, property_id, area_id, activity_id, contractor_id, person_name,
                           subject, path, signed_by, signed_at)
    select a.tenant_id, a.property_id, a.area_id, a.id, c.id, 'Paul Probe', 'Fluchtwege', 'M10,10L200,300',
           u.id, '2026-10-01T08:00:00Z'
      from activities a, contractors c, auth_users u
     where a.tenant_id = '$first_tenant' and c.tenant_id = a.tenant_id and u.email = '$probe_email';
    insert into work_permits (tenant_id, property_id, area_id, activity_id, contractor_id, form_key,
                              form_version, answers, signed_by, signed_at)
    select a.tenant_id, a.property_id, a.area_id, a.id, c.id, 'brandschutz.hot_work_permit', 1,
           '{\"place\": \"Probe\"}', u.id, '2026-10-01T08:05:00Z'
      from activities a, contractors c, auth_users u
     where a.tenant_id = '$first_tenant' and c.tenant_id = a.tenant_id and u.email = '$probe_email';"
  waited=0
  # The duty's own deadline; the plan of a round brings one of its own.
  until test "$(value "select count(*) from deadlines where tenant_id = '$first_tenant' and duty_id is not null")" = 1 &&
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

# What the application makes of the record the backup just left: the route
# behind "Einstellungen", "Sicherung" names it, with its archive, encrypted,
# and not overdue (opengewerk-haustechnik#127, #80).
after_record() {
  HAUSTECHNIK_PASSWORD=$probe_password compose exec -T -e HAUSTECHNIK_PASSWORD app \
    node dist/add-staff.js "$first_tenant" "$lead_email" 'Lea Leitung' management
  cookies=$(probe_session "$lead_email")

  # The Leitung needs a second factor (ADR 0006), and a sign in with one asks
  # for a code from an app. So the account signs in with its password first
  # and is then given the flag the setup of an app leaves, which the check
  # reads afresh on every request.
  sql "update auth_users set two_factor_enabled = true where email = '$lead_email';"
  [ "$(value "select two_factor_enabled from auth_users where email = '$lead_email'")" = t ] ||
    fail 'Das Konto der Leitung hat keinen zweiten Faktor bekommen.'

  status=$(curl --silent --output "$temp/backup-status.json" --write-out '%{http_code}' \
    --header "Cookie: $cookies" --header "Origin: $base" "$base/settings/backup")
  echo "GET /settings/backup: ${status}"
  cat "$temp/backup-status.json"
  echo
  test "${status}" = 200
  grep -q '"state":"recorded"' "$temp/backup-status.json"
  grep -q '"encrypted":true' "$temp/backup-status.json"
  grep -q '"overdue":false' "$temp/backup-status.json"
  echo 'Die Route hinter "Einstellungen", "Sicherung" nennt die Sicherung, die eben fertig wurde.'
}

# After the restore the file the account sent is back where the store looks
# for it, with the contents its name promises and the row that makes it a file
# of the Betreiber (opengewerk-haustechnik#96). And the account signs in with
# the password it had before the backup (opengewerk-haustechnik#15). The
# answer is a session, which also means its sign in was written to the
# restored database.
after_restore() {
  expected=$(printf '%s' "$probe_file" | sha256sum | cut -d' ' -f1)
  hash=$(value "select sha256 from files where tenant_id = '$first_tenant'")
  echo "Datei des Betreibers nach dem Rückspielen: ${hash}"
  test "${hash}" = "${expected}"
  found=$(compose exec -T app sh -c 'sha256sum "$STORAGE_PATH/$(printf "%s" "$1" | cut -c1-2)/$(printf "%s" "$1" | cut -c3-4)/$1"' sh "$hash" | cut -d' ' -f1)
  test "${found}" = "${expected}"
  echo 'Die abgelegte Datei ist mit ihrer Zeile zurück, und ihr Inhalt ist der von vor der Sicherung.'

  status=$(curl --silent --output "$temp/sign-in.json" --write-out '%{http_code}' \
    --header 'Content-Type: application/json' --header "Origin: $base" \
    --data "{\"email\":\"$probe_email\",\"password\":\"$probe_password\"}" \
    "$base/api/auth/sign-in/email")
  echo "Anmeldung nach dem Rückspielen: ${status}"
  test "${status}" = 200
  echo 'Das Konto von vor der Sicherung meldet sich mit seinem Passwort an.'

  # The document at the asset is back with its version, and the server hands
  # the file out through the version, to the account that works in the area of
  # the asset (opengewerk-haustechnik#97): the bytes are those of the store.
  cookies=$(probe_session)
  version=$(value "select id from attachment_versions where tenant_id = '$first_tenant'")
  status=$(curl --silent --output "$temp/probe-document.bin" --write-out '%{http_code}' \
    --header "Cookie: $cookies" --header "Origin: $base" \
    "$base/attachments/versions/$version/content")
  echo "GET /attachments/versions/${version}/content nach dem Rückspielen: ${status}"
  test "${status}" = 200
  test "$(sha256sum "$temp/probe-document.bin" | cut -d' ' -f1)" = "${expected}"
  echo 'Das Dokument an der Anlage ist zurück, und der Server gibt seine Datei über die Fassung aus.'
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
