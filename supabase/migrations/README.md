# Migrations

Everything in `../schema.sql`, `../payroll.sql`, `../seed.sql`, and `../00N_*.sql` was already
applied by hand through the Supabase SQL editor before the GitHub integration was connected —
those files stay where they are as a historical record and are **not** duplicated in here, so
connecting the integration doesn't try to re-run already-applied SQL (some of it, like `create
policy` and `alter table ... add constraint`, isn't safe to run twice).

From now on, new schema changes go here instead, one file per change:

```
supabase/migrations/<YYYYMMDDHHMMSS>_short_description.sql
```

e.g. `supabase/migrations/20260728120000_add_task_category.sql`. Once Supabase's GitHub
integration is connected (Project Settings → Integrations → GitHub → connect this repo → branch
`main`), pushing a new file here to `main` applies it to the live database automatically — no more
copy-pasting into the SQL editor by hand.
