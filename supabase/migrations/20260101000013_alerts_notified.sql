-- GODAC V2 — tracks whether an alert's Resend email actually went
-- out, so the alerts UI (Module 8) can show "notifié" vs "en attente
-- d'envoi" instead of assuming email delivery silently.
alter table alerts add column notified_at timestamptz;
