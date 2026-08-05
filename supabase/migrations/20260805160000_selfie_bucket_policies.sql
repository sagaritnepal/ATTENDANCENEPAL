-- The `attendance-selfies` storage bucket (README.md step 11) was only ever
-- documented as "create a public bucket" — a public bucket controls read
-- access, not who may upload to it. No migration ever granted INSERT on
-- storage.objects for it, so every uploader (admin Employees page, and now
-- the employee self-service Profile photo) was relying on whatever policy
-- happened to be configured by hand in the dashboard, which evidently never
-- covered this path — hence "new row violates row-level security policy".
--
-- Broad by design: any authenticated user may upload/update/read within
-- this one bucket, matching how it's already used (any employee needs to
-- write here for a GPS check-in selfie, not just admins for profile
-- photos) — RLS on the underlying tables (employees, profiles) is what
-- actually controls who a photo URL gets attached to, not this bucket.

drop policy if exists "attendance-selfies: authenticated upload" on storage.objects;
create policy "attendance-selfies: authenticated upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attendance-selfies');

drop policy if exists "attendance-selfies: authenticated update" on storage.objects;
create policy "attendance-selfies: authenticated update" on storage.objects
  for update to authenticated
  using (bucket_id = 'attendance-selfies')
  with check (bucket_id = 'attendance-selfies');

drop policy if exists "attendance-selfies: public read" on storage.objects;
create policy "attendance-selfies: public read" on storage.objects
  for select using (bucket_id = 'attendance-selfies');
