-- Lets an admin/HR user set their own profile photo (AccountMenu's "Edit
-- Profile" never had one). 20260805100000_tenant_backfill.sql deliberately
-- locked self-update of `profiles` down to a column allowlist (full_name,
-- company_name, pan_no, location) instead of a blanket UPDATE grant, to
-- close a privilege-escalation path (self-promoting role/company_id) — so
-- adding a new self-editable field means adding both the column AND its
-- own explicit grant, not just adding the column.

alter table profiles add column if not exists photo_url text;
grant update (photo_url) on profiles to authenticated;
