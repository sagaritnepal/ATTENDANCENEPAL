-- Redefine handle_new_user() (from 20260805120000_tenant_rpc_updates.sql)
-- once more to also copy raw_user_meta_data->>'location' into
-- profiles.location, now that the /register page collects it up front
-- instead of only after signup via the Account Menu's "Edit Profile" popup.

create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_company_id uuid;
  v_role text := 'employee';
  v_full_name text := new.raw_user_meta_data ->> 'full_name';
  v_company_name text := new.raw_user_meta_data ->> 'company_name';
  v_location text := new.raw_user_meta_data ->> 'location';
begin
  if new.raw_user_meta_data ->> 'company_id' is not null then
    v_company_id := (new.raw_user_meta_data ->> 'company_id')::uuid;
  elsif v_company_name is not null and trim(v_company_name) <> '' then
    insert into public.companies (name, created_by) values (trim(v_company_name), new.id)
    returning id into v_company_id;
    v_role := 'admin';
  end if;
  -- Neither key present: v_company_id stays null and the insert below
  -- fails against profiles.company_id NOT NULL, loudly, rather than
  -- silently creating a mis-scoped account. Both real insert paths
  -- (register, create-login) always supply one of the two keys.

  insert into public.profiles (id, role, full_name, company_name, company_id, location)
  values (new.id, v_role, v_full_name, v_company_name, v_company_id, v_location)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
