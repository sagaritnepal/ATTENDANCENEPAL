-- Adds the "designation" (job title) field used by the admin web dashboard's
-- Employee Directory. Run once after schema.sql.
alter table employees add column if not exists designation text;
