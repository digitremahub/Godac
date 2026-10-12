-- Shared FAQ for the assistant, fed by every organisation's questions.
--
-- assistant_question_log: questions asked to the assistant, already
-- scrubbed of names / plates / phone numbers / e-mails before insert
-- (lib/assistant/faq.ts) and stored WITHOUT organisation or user id,
-- so a row cannot be traced back to a company or a person. Purged
-- 90 days after creation by /api/cron/retention.
--
-- assistant_faq: generalised question + answer pairs, drafted by the
-- AI from the log and from resolved support requests, then reviewed
-- and published by a platform admin (GODAC's editor). Published
-- entries become a source for every organisation's assistant.
--
-- platform_admins: GODAC-level operators (not an organisation role).

create table platform_admins (
  user_id uuid primary key references users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- No policy: read and written only through the service role.

create table assistant_question_log (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  role user_role not null,
  -- false when the assistant had to hand over to a human — those are
  -- exactly the gaps the FAQ should fill.
  answered boolean not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index assistant_question_log_unprocessed_idx on assistant_question_log (created_at) where processed_at is null;
alter table assistant_question_log enable row level security;
-- No policy: service role only.

create table assistant_faq (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null default '',
  -- Empty means every role.
  roles user_role[] not null default '{}',
  status text not null default 'suggested' check (status in ('suggested', 'published', 'dismissed')),
  asked_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_faq_status_idx on assistant_faq (status);
alter table assistant_faq enable row level security;

create policy assistant_faq_published_read on assistant_faq
  for select to authenticated
  using (status = 'published');

-- Resolved support requests are drafted into the FAQ once.
alter table support_requests add column faq_processed_at timestamptz;
