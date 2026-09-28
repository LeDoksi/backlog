-- External ids for titles added through search, so later phases can match a
-- title across boards and fill in data without guessing by name. Optional and
-- additive: v1 never reads them and its partial upserts leave them alone.
alter table public.drafts add column if not exists source text;
alter table public.drafts add column if not exists source_id text;
