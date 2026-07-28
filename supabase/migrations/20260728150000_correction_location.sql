-- Silently captures the employee's GPS location when they submit a missed-
-- punch correction request, as supporting evidence for HR/Admin's review.
-- Run once after 20260728140000_task_time_tracking.sql.

alter table attendance_correction_requests add column if not exists lat double precision;
alter table attendance_correction_requests add column if not exists lng double precision;
