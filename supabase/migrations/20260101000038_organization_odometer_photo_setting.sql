-- GODAC V2 — per-organization setting making the odometer counter
-- photo mandatory at tour start/end, not just optional-with-OCR-bonus
-- as it is by default. Same shape as the existing `ocr_enabled`
-- toggle, but a plain organizations column rather than a module
-- switch: this isn't a priced feature, just a stricter-or-not data
-- entry policy direction can flip for their own fleet.
alter table organizations add column require_odometer_photo boolean not null default false;
