-- Safe to run more than once: every table is created only if missing.

create table if not exists applications (
  id serial primary key,
  company_name text not null,
  deck_text text,            -- the founder's own deck text
  form_responses jsonb,      -- the application form answers
  status text not null default 'new',  -- new | scored | reviewed | manual_review
  created_at timestamptz not null default now()
);

create table if not exists extracted_fields (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  fields jsonb not null,           -- model output; null = deck does not say
  empty_fields text[] not null default '{}',  -- listed by code, not the model
  created_at timestamptz not null default now()
);

create table if not exists criteria (
  id serial primary key,
  name text not null unique,
  definition text not null,
  source_url text,
  status text not null default 'proposed, partners to confirm',
  created_at timestamptz not null default now()
);

create table if not exists scores (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  criterion_id int not null references criteria(id),
  score int check (score between 1 and 5),   -- null = gap, never a low score
  source text not null,                      -- deck page or URL; code rejects empty
  gaps text[] not null default '{}',
  conflict text,                             -- set when deck and web disagree
  created_at timestamptz not null default now()
);

create table if not exists corrections (
  id serial primary key,
  score_id int not null references scores(id) on delete cascade,
  criterion_id int not null references criteria(id),
  old_score int,
  new_score int not null check (new_score between 1 and 5),
  reason text not null,
  corrected_by text,
  created_at timestamptz not null default now()
);

create table if not exists research_log (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  url text not null,
  reason text not null,
  status text not null,  -- ok | failed
  created_at timestamptz not null default now()
);

create table if not exists call_proposals (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  reviewed_by_human boolean not null default false,  -- the tick box
  slots timestamptz[] not null default '{}',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists past_deals (
  id serial primary key,
  company_name text not null,
  original_application text,  -- what the backtest may read
  partner_memo text,          -- written after the decision; the backtest must NOT read this
  created_at timestamptz not null default now()
);

create table if not exists partner_decisions (
  id serial primary key,
  past_deal_id int not null unique references past_deals(id) on delete cascade,
  decision text not null check (decision in ('funded', 'passed')),
  partner_note text
);

create table if not exists decision_log (
  id serial primary key,
  application_id int references applications(id) on delete set null,
  step text not null,
  decision text not null,
  reason text not null,   -- one sentence
  created_at timestamptz not null default now()
);

-- Step 3: settings and model-call logging.
create table if not exists settings (
  key text primary key,
  value text not null
);

alter table decision_log add column if not exists model text;
alter table decision_log add column if not exists prompt_version text;
alter table decision_log add column if not exists input_tokens int;
alter table decision_log add column if not exists output_tokens int;
alter table decision_log add column if not exists cost_usd numeric(12,6);
alter table decision_log add column if not exists cost_inr numeric(12,4);
alter table decision_log add column if not exists trace_id text;

-- Step 4: case data. Memo details are split so the backtest can read only the safe part.
alter table past_deals add column if not exists sector text;
alter table past_deals add column if not exists stage text;
alter table past_deals add column if not exists source_channel text;
create unique index if not exists applications_company_name_key on applications (company_name);
create unique index if not exists past_deals_company_name_key on past_deals (company_name);
create table if not exists partner_notes (
  id serial primary key,
  meeting int not null unique,
  title text not null,
  body text not null
);

-- Step 5: extraction results and failure notes.
alter table extracted_fields add column if not exists sources jsonb;
alter table extracted_fields add column if not exists conflicts jsonb;
create unique index if not exists extracted_fields_application_id_key on extracted_fields (application_id);
alter table applications add column if not exists status_note text;

-- Step 6: web research. Every finding keeps its source address and the exact words it rests on.
alter table research_log add column if not exists run_id text;
alter table research_log add column if not exists kind text;
alter table research_log add column if not exists detail text;
alter table applications add column if not exists researched_at timestamptz;
alter table applications add column if not exists research_note text;
create table if not exists research_findings (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  run_id text not null,
  kind text not null check (kind in ('founder', 'company', 'market')),
  subject text not null,
  claim text not null,
  url text not null,
  quote text not null,
  identity text not null check (identity in ('confirmed', 'unclear')),
  relation text not null check (relation in ('supports', 'contradicts', 'adds')),
  application_says text,
  created_at timestamptz not null default now()
);
create index if not exists research_findings_application_id_idx on research_findings (application_id);

-- Step 7: scoring. One row per application and criterion, replaced when the application is scored again.
alter table criteria add column if not exists decisive_fields text[] not null default '{}';
alter table scores add column if not exists model_score int;
alter table scores add column if not exists evidence text;
alter table scores add column if not exists reasoning text;
alter table scores add column if not exists capped text;
alter table scores add column if not exists basis text;
alter table scores add column if not exists prompt_version text;
create unique index if not exists scores_application_criterion_key on scores (application_id, criterion_id);
alter table applications add column if not exists scored_at timestamptz;
alter table applications add column if not exists score_note text;
alter table applications add column if not exists scored_with_research boolean;
alter table applications add column if not exists score_input_hash text;
create table if not exists portfolio_companies (
  id serial primary key,
  name text not null,
  description text,
  source_url text,
  created_at timestamptz not null default now()
);
create unique index if not exists portfolio_companies_name_key on portfolio_companies (lower(name));
create table if not exists portfolio_overlaps (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  company text not null,
  level text not null check (level in ('possible', 'likely')),
  why text not null,
  created_at timestamptz not null default now()
);
create index if not exists portfolio_overlaps_application_id_idx on portfolio_overlaps (application_id);

-- Step 8: a correction remembers whose application it came from and the sector and stage then, so it can be found for similar companies.
alter table corrections add column if not exists application_id int references applications(id) on delete cascade;
alter table corrections add column if not exists sector text;
alter table corrections add column if not exists stage text;
-- The corrections that were shown to the scorer for this score, so the kill rule can count how often Riya still changed it.
alter table scores add column if not exists example_ids int[] not null default '{}'
;

-- Step 9: one row per past deal per backtest run. The latest run is the report.
create table if not exists backtest_results (
  id serial primary key,
  run_id int not null,
  past_deal_id int not null references past_deals(id) on delete cascade,
  scores jsonb,
  strong int,
  gaps int,
  result text check (result in ('advance', 'pass for now', 'insufficient data')),
  decision text not null,
  agrees boolean,
  verdict text,
  verdict_note text,
  error text,
  prompt_version text,
  created_at timestamptz not null default now()
)
;

-- Backtest option "facts only": the memo's founder section, kept apart so the plain backtest still never touches the memo column.
alter table past_deals add column if not exists founder_text text;
alter table backtest_results add column if not exists mode text not null default 'description'
;

-- Step 10: intro email draft, second-model check, Riya's tick, send.
alter table call_proposals add column if not exists subject text;
alter table call_proposals add column if not exists body text;
alter table call_proposals add column if not exists check_ok boolean not null default false;
alter table call_proposals add column if not exists check_problems text[] not null default '{}';
alter table call_proposals add column if not exists drafted_by text;
alter table call_proposals add column if not exists checked_by text;
alter table call_proposals add column if not exists sent_to text
;

-- Step 11: founder replies, their classification and the draft answer.
create table if not exists founder_replies (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  reply_text text not null,
  classification text not null check (classification in ('wants to book', 'proposes another time', 'asks a question', 'declines', 'unclear')),
  basis text,                                  -- the sentence from the reply the class rests on
  flags text[] not null default '{}',          -- notes for Riya
  draft_subject text,
  draft_body text,                             -- null when no draft is made
  reviewed_by_human boolean not null default false,
  sent_at timestamptz,
  sent_to text,
  created_at timestamptz not null default now()
)
;

-- Step 12: one follow-up per application, ever (the unique key enforces it), and a log of booking-link use.
create table if not exists followups (
  id serial primary key,
  application_id int not null unique references applications(id) on delete cascade,
  subject text not null,
  body text not null,
  reviewed_by_human boolean not null default false,
  sent_at timestamptz,
  sent_to text,
  created_at timestamptz not null default now()
)
;

-- Step 14: the queue. Each application gets three jobs in a chain: extract, then research, then score.
create table if not exists jobs (
  id serial primary key,
  application_id int not null references applications(id) on delete cascade,
  kind text not null check (kind in ('extract', 'research', 'score')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  after_job int references jobs(id) on delete cascade,  -- runs only when this job is done
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
)
