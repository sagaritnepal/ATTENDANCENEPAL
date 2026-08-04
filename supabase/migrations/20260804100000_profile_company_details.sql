-- Two more fields for the admin's "Edit Profile" popup, alongside the
-- existing profiles.full_name/company_name from 20260803120000. No new RLS
-- needed — the existing "profiles: self update" policy already lets a user
-- update any column on their own row.

alter table profiles add column if not exists pan_no text;
alter table profiles add column if not exists location text;
