-- GODAC V2 — Phase 3 architectural placeholder for Module 10 (GODAC
-- Hub / marketplace de fret). Not implemented in the MVP: no UI, no
-- RLS beyond org isolation, no business logic wired in. Present only
-- so the eventual feature is additive rather than a schema migration
-- under a live marketplace.

create table freight_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  origin_planning_entry_id uuid references planning_entries (id) on delete set null,
  corridor text,
  available_from timestamptz,
  available_to timestamptz,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table freight_bids (
  id uuid primary key default gen_random_uuid(),
  freight_offer_id uuid not null references freight_offers (id) on delete cascade,
  bidder_organization_id uuid not null references organizations (id) on delete cascade,
  round integer not null default 1,
  proposed_price numeric(10, 2),
  status text not null default 'pending',
  responded_within timestamptz,
  created_at timestamptz not null default now()
);

alter table freight_offers enable row level security;
alter table freight_bids enable row level security;
-- Locked down entirely until Module 10 is built (Phase 3): no
-- policies are defined, so RLS denies all access by default even to
-- authenticated org members.
