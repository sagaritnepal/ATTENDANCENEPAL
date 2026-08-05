-- Plain stored handle on the employee HR record, distinct from the login
-- email used by "Create Login" (accounts/auth) — just a text field the
-- employer can fill in on the Add Employee form, same treatment as PAN/SSF.

alter table employees add column if not exists username text;
