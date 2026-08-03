-- Capture the signer-up's full name and company name (entered on the
-- /register form) so accounts aren't just a bare email address.
alter table profiles add column if not exists full_name text;
alter table profiles add column if not exists company_name text;

-- Redefine handle_new_user() (from 003_auth_signup.sql) to also copy those
-- two fields out of the signUp() call's user metadata, where the frontend
-- puts them (options.data), into the new profiles row.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, full_name, company_name)
  values (
    new.id,
    'employee',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'company_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
