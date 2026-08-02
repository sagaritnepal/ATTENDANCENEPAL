-- Backfill the departments table from whatever department names already
-- exist on employees (free text, entered before the departments table
-- existed), so they show up in the Branch/Depart page and Employee
-- dropdowns instead of being invisible until re-typed.
insert into departments (name)
select distinct department
from employees
where department is not null and trim(department) <> ''
on conflict (name) do nothing;
