-- GODAC V2 — schema bootstrap: extensions + shared enum types.
create extension if not exists "pgcrypto";

create type user_role as enum (
  'chauffeur',
  'manager',
  'manager_chauffeur',
  'comptable',
  'direction'
);

create type vehicle_type as enum ('VL', 'PL', 'SPL');

create type vehicle_status as enum ('active', 'maintenance', 'out_of_service');

create type fuel_type as enum ('diesel', 'adblue');

-- Lifecycle of a fuel_entries row. `manual` never touches the OCR
-- pipeline. OCR-sourced rows always pass through awaiting_validation
-- before becoming validated — never written straight to validated.
create type fuel_entry_status as enum (
  'manual',
  'pending_ocr',
  'awaiting_validation',
  'validated',
  'ocr_failed'
);

create type alert_type as enum (
  'price_anomaly',
  'totalizer_gap',
  'tank_overflow',
  'ocr_failure'
);

create type alert_severity as enum ('info', 'warning', 'critical');

create type alert_status as enum ('open', 'acknowledged', 'resolved');

create type intervention_status as enum (
  'scheduled',
  'in_progress',
  'done',
  'cancelled'
);

create type fine_status as enum (
  'pending_identification',
  'identified',
  'contested',
  'paid'
);

create type leave_status as enum ('pending', 'approved', 'rejected');

create type subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete'
);
