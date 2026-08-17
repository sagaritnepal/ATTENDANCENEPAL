-- Supabase Security Advisor flagged employees_on_leave_today (004) as a
-- "Security Definer View": views default to running as their owner
-- (postgres, which bypasses RLS) rather than the querying user. Since
-- leave_requests is company-scoped by RLS (20260805110000), that meant this
-- view leaked every company's on-leave employee_ids to any caller, not just
-- their own — security_invoker makes it run as the querying user instead,
-- so the view's results honor the same per-company RLS as querying
-- leave_requests directly.

alter view employees_on_leave_today set (security_invoker = on);
