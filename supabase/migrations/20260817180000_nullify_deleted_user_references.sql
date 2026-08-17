-- Deleting an auth user (e.g. a test signup like surendra@gmail.com) was
-- failing with "Database error deleting user" — profiles.id -> auth.users
-- already cascades, but several tables hold a reviewed_by/assigned_by/
-- created_by pointer at that soon-to-be-deleted profiles row (or, for
-- companies.created_by, straight at auth.users) with the default RESTRICT
-- behavior, which blocks the whole cascade. These columns are just an
-- audit trail (who reviewed/assigned/created something), not something that
-- should force-keep an account around or cascade-delete the business record
-- itself — so on delete set null instead of the default no-action.

alter table leave_requests drop constraint if exists leave_requests_reviewed_by_fkey;
alter table leave_requests add constraint leave_requests_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table attendance_correction_requests drop constraint if exists attendance_correction_requests_reviewed_by_fkey;
alter table attendance_correction_requests add constraint attendance_correction_requests_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table tasks drop constraint if exists tasks_assigned_by_fkey;
alter table tasks add constraint tasks_assigned_by_fkey
  foreign key (assigned_by) references profiles(id) on delete set null;

alter table tasks drop constraint if exists tasks_reviewed_by_fkey;
alter table tasks add constraint tasks_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table point_redemptions drop constraint if exists point_redemptions_reviewed_by_fkey;
alter table point_redemptions add constraint point_redemptions_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table device_sync_events drop constraint if exists device_sync_events_requested_by_fkey;
alter table device_sync_events add constraint device_sync_events_requested_by_fkey
  foreign key (requested_by) references profiles(id) on delete set null;

alter table attendance_gps_requests drop constraint if exists attendance_gps_requests_reviewed_by_fkey;
alter table attendance_gps_requests add constraint attendance_gps_requests_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table company_holidays drop constraint if exists company_holidays_created_by_fkey;
alter table company_holidays add constraint company_holidays_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

alter table companies drop constraint if exists companies_created_by_fkey;
alter table companies add constraint companies_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
