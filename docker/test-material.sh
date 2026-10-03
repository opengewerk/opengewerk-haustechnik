# What the checks of a running stack in test-stack.sh need to know about this
# application and can read nowhere else (opengewerk-haustechnik#14). The steps
# are the foundation's, in upstream/opengewerk/docker; read with "." once the
# helpers there are defined, so the functions below may use sql, value,
# compose, restart_app and $base, and the two tenants test-stack.sh creates are
# $first_tenant and $second_tenant.
#
# This application has no records of its own yet. What a backup has to bring
# back besides the tenants, the audit log and the file store is what the
# foundation keeps for it: accounts, the roles of a Betreiber and who works for
# which, and the sign in that rests on them.

# A route touching data, which refuses everybody without a sign in: the
# accounts of a Betreiber.
guarded_route=/staff

# The tables counted before the backup and after the restore.
counted_tables='auth_users memberships tenant_roles'

# The migrations, and how many of them make the older state an update starts
# from: the first, without the sequence for work orders that the second brings.
migrations="$here/../packages/server/migrations"
older_migrations=1

# What the update from that state adds to the log of a tenant that was there
# before, as "<table> (<reason>)": the tenant written with SQL gets the roles a
# Betreiber begins with when the application starts again, and those are
# changes like any other.
update_adds='tenant_roles (roles.complete)'

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

# The sequence the second migration brings, in its place in the list, and the
# account from before the update with its place at the Betreiber.
after_update() {
  kinds=$(value "select string_agg(enumlabel, ' ' order by enumsortorder) from pg_enum where enumtypid = 'number_range_key'::regtype")
  echo "Nummernkreise nach dem Update: ${kinds}"
  test "${kinds}" = 'asset work_order evidence'
  test "$(value "select count(*) from memberships where user_id = 'u-probe'")" = 1
  echo 'Der Zugang von vor dem Update ist da, und der Nummernkreis für Aufträge ist dazugekommen.'
}
