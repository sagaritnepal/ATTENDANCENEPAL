-- Enables self-service registration from the admin-web frontend: whenever a
-- new row lands in auth.users (i.e. supabase.auth.signUp() was called), auto-
-- create a matching profiles row. Defaults to role 'employee' — never
-- 'admin' — so a self-registered account can't grant itself dashboard
-- access. Promoting someone to admin still requires an existing admin to run:
--   update profiles set role = 'admin' where id = '<their-auth-uuid>';
-- Run once after schema.sql / payroll.sql / seed.sql.

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'employee')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
