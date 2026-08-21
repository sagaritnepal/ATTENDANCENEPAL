-- DashboardScreen.tsx (mobile-app) subscribes to postgres_changes INSERT on
-- attendance_logs for its live punch feed (the 'attendance-live' channel),
-- but no migration ever added this table to Supabase's realtime publication
-- — unlike `devices`, which DevicesScreen also subscribes to and which
-- already works. Without this, new punches land in the table fine (RLS and
-- the zkteco-bridge sync path are unaffected either way) but the live feed
-- never gets pushed the change; only a full screen remount picks it up.
--
-- Guarded with an existence check since `alter publication ... add table`
-- errors instead of no-op'ing if the table is already a member.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_logs'
  ) then
    alter publication supabase_realtime add table attendance_logs;
  end if;
end $$;
