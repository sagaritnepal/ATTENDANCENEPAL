-- 20260817210000 made devices.branch_id nullable, but the multi-tenancy
-- trigger that stamps devices.company_id (stamp_company_id_from_branch(),
-- from 20260805090000) unconditionally looks up company_id via branch_id
-- and raises 'No such branch, or branch has no company_id' when it's null
-- — so a branchless device could never actually be inserted.
--
-- qr_tokens and branch_departments share that same trigger function and
-- still genuinely require a branch, so this adds a devices-only variant
-- instead of loosening the shared one: derive company_id from the branch
-- when one is given (never trust the caller), otherwise fall back to the
-- inserting admin's own company — the same fallback stamp_company_id_root()
-- already uses for other tables with no FK chain to derive from.

create or replace function stamp_company_id_from_branch_or_self()
returns trigger as $$
begin
  if new.branch_id is not null then
    new.company_id := (select company_id from branches where id = new.branch_id);
    if new.company_id is null then
      raise exception 'No such branch, or branch has no company_id';
    end if;
  else
    new.company_id := my_company_id();
    if new.company_id is null then
      raise exception 'company_id could not be determined for this insert';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_stamp_company_id on devices;
create trigger trg_stamp_company_id before insert on devices
  for each row execute function stamp_company_id_from_branch_or_self();
