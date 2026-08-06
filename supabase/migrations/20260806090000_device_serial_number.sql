-- Serial number identifies the physical unit, distinct from name/IP (which
-- can be reassigned/changed) — unique per company so two companies' devices
-- can't collide, but nullable so existing devices registered before this
-- column existed aren't broken (Postgres treats multiple NULLs as distinct
-- under a unique constraint, so they don't conflict with each other).

alter table devices add column if not exists serial_number text;

alter table devices drop constraint if exists devices_company_serial_unique;
alter table devices add constraint devices_company_serial_unique unique (company_id, serial_number);
