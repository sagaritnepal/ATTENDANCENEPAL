-- The employees.department backfill found nothing because these
-- department names actually live on department-scoped shift templates
-- (shifts.department, e.g. "IT" / "SALES&MKT"), not on any employee row
-- yet. Pull those in too.
insert into departments (name)
select distinct department
from shifts
where department is not null and trim(department) <> ''
on conflict (name) do nothing;
