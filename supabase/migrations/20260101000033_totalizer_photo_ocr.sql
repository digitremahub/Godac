-- GODAC V2 — OCR the tank/pump totalizer counter before and after a
-- fill-up, instead of the driver typing the two index numbers by
-- hand. The photos live in the existing fuel-tickets bucket (its
-- org-scoped storage RLS only keys off the first path segment, so no
-- new bucket/policy is needed) and get attached to whichever
-- fuel_entries row eventually gets created — the photo can be taken
-- before that row exists (manual-entry flow) or after (OCR-ticket
-- flow), see app/api/ocr/totalizer/{init,process}.
alter table fuel_entries add column totalizer_before_photo_path text;
alter table fuel_entries add column totalizer_after_photo_path text;
