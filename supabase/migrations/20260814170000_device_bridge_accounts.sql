-- Lets an admin issue a scoped credential for the on-prem LAN bridge
-- (zkteco-bridge/index.js) from the dashboard, instead of ever handing out
-- the global SUPABASE_SERVICE_ROLE_KEY — which can read/write EVERY
-- company's data, not just the one it's meant for, and is not something
-- that should ever leave our own infrastructure once this app is sold to
-- multiple organizations running their own bridge on their own machine.
--
-- A "bridge credential" is just a normal Supabase Auth user + profiles row
-- with role='admin', scoped to one company by the exact same RLS policies
-- (is_admin() and company_id = my_company_id()) every other admin session
-- already goes through — no new policies needed, see 20260805110000_
-- tenant_rls_policies.sql. is_device_bridge only exists so the dashboard can
-- tell these apart from a real human admin account for its own list/revoke
-- UI (admin-web/app/api/bridge-credentials/route.ts).

alter table profiles add column if not exists is_device_bridge boolean not null default false;
