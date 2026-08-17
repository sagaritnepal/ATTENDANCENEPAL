-- companies had row level security turned on (relrowsecurity = true) with
-- NO policies ever defined for it in any migration here — meaning this was
-- flipped on directly in the Supabase dashboard (very likely via the
-- Security Advisor's "enable RLS" quick action), not through this repo's
-- migration history. With RLS on and zero policies, Postgres denies ALL
-- access by default, for every role including the ones this app's own
-- session runs as — this is why the Week-off feature's weekly_off_day
-- setting was silently failing to save AND failing to read back (both the
-- write in week-off/page.tsx and the read in lib/weekOff.ts's
-- fetchMyCompanyWeekOffConfig() go through the normal authenticated client,
-- not the service-role key, so both were being blocked with no visible
-- error — a `.select().single()` against zero visible rows just resolves to
-- null, not an error).
--
-- companies.id IS the company id here (this is the root tenant table, not a
-- child table with its own company_id column) — so "my own company" means
-- id = my_company_id(), not company_id = my_company_id() like every other
-- table's policies in this project.

alter table companies enable row level security; -- already true; stated for clarity/idempotency

drop policy if exists "companies: read own" on companies;
create policy "companies: read own" on companies
  for select using (id = my_company_id());

-- Deliberately SELECT + UPDATE only, not INSERT/DELETE — company creation
-- isn't a supported client-side flow, and destroying a company row is far
-- too destructive to ever allow through ordinary RLS-authenticated access.
drop policy if exists "companies: admin update own" on companies;
create policy "companies: admin update own" on companies
  for update using (is_admin() and id = my_company_id())
  with check (is_admin() and id = my_company_id());
