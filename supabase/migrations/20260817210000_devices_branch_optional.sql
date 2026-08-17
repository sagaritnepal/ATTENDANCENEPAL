-- Branch was required when adding a device, but a device can be added
-- before its branch exists yet (or genuinely doesn't belong to one) — the
-- app already renders an "Unassigned branch" fallback everywhere it reads
-- devices.branch_id, so the only thing actually blocking this was the
-- NOT NULL constraint plus the forms' own required attribute/validation.

alter table devices alter column branch_id drop not null;
