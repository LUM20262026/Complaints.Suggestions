-- ============================================================================
--  RUN_ALL — تنفيذ كامل لقاعدة البيانات بضغطة واحدة
--  نظام الشكاوى والمقترحات — جامعة اللوتس
--  طريقة الاستخدام: انسخ هذا الملف كاملاً والصقه في Supabase → SQL Editor → Run
--  * آمن للتنفيذ المتكرر 100% (Idempotent) — لن يحذف أو يستبدل أي بيانات
--  * CONSISTS OF: 001_core_tables + 002_security_rls + 003_functions_rpc + 004_realtime_storage
-- ============================================================================

-- ===========================================================================
-- [1/4] الجداول الأساسية
-- ===========================================================================

create table if not exists public.colleges (
  id            bigint generated always as identity primary key,
  name          text    not null unique,
  is_active     boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.app_settings (
  id                   smallint primary key default 1,
  university_name      text not null default 'جامعة اللوتس',
  page_title           text not null default 'منصة الشكاوى والمقترحات',
  welcome_text         text not null default 'أهلاً بك في منصة الجامعة — صوتك مسموع ومهم',
  description          text not null default 'منصة رسمية مخصصة لاستقبال شكاوى ومقترحات الطلاب وأعضاء هيئة التدريس والموظفين. أرسل رسالتك بسرية تامة وستصل مباشرة إلى الإدارة المختصة.',
  submit_button_text   text not null default 'إرسال الرسالة',
  success_message      text not null default 'تم إرسال رسالتك بنجاح إلى إدارة الجامعة',
  closed_message       text not null default 'تم إيقاف استقبال الرسائل مؤقتاً. نعذرنا عن الإزاحة، حاول لاحقاً.',
  footer_text          text not null default 'جميع الحقوق محفوظة لجامعة اللوتس',
  logo_url             text,
  primary_color        text not null default '#1E7A5B',
  secondary_color      text not null default '#7A5FB5',
  label_complaint      text not null default 'شكوى',
  label_suggestion     text not null default 'اقتراح',
  placeholder_complaint text not null default 'اكتب تفاصيل الشكوى هنا...',
  placeholder_suggestion text not null default 'اكتب مقترحك هنا...',
  is_form_enabled      boolean not null default true,
  allow_complaints     boolean not null default true,
  allow_suggestions    boolean not null default true,
  show_name_field      boolean not null default true,
  name_required        boolean not null default false,
  require_college      boolean not null default true,
  message_min_length   integer not null default 10,
  message_max_length   integer not null default 2000,
  default_theme        text not null default 'light',
  updated_at           timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_single_row') then
    alter table public.app_settings add constraint app_settings_single_row check (id = 1);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_lengths_chk') then
    alter table public.app_settings add constraint app_settings_lengths_chk
      check (message_min_length >= 0
         and message_max_length between 10 and 50000
         and message_max_length >= greatest(message_min_length, 1));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_theme_chk') then
    alter table public.app_settings add constraint app_settings_theme_chk
      check (default_theme in ('light','dark'));
  end if;
end $$;

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

insert into public.colleges (name, display_order) values
  ('كلية العلاج الطبيعي', 1),
  ('كلية طب الفم والأسنان', 2),
  ('كلية الصيدلة', 3),
  ('كلية التمريض', 4),
  ('كلية تكنولوجيا العلوم الصحية التطبيقية', 5),
  ('كلية الهندسة', 6),
  ('كلية الحاسبات والمعلومات والذكاء الاصطناعي', 7),
  ('كلية الإدارة والاقتصاد والعلوم السياسية', 8)
on conflict (name) do nothing;

create sequence if not exists public.submission_ref_seq;

create table if not exists public.submissions (
  id                    bigint generated always as identity primary key,
  reference_number      text unique not null,
  sender_name           text,
  college_id            bigint references public.colleges(id),
  college_name_snapshot text,
  submission_type       text not null,
  message               text not null,
  status                text not null default 'new',
  admin_reply           text,
  internal_notes        text,
  anon_client_id        text,
  replied_at            timestamptz,
  resolved_at           timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_type_chk') then
    alter table public.submissions add constraint submissions_type_chk
      check (submission_type in ('complaint','suggestion'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_status_chk') then
    alter table public.submissions add constraint submissions_status_chk
      check (status in ('new','in_review','in_progress','replied','resolved','rejected','archived'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_message_chk') then
    alter table public.submissions add constraint submissions_message_chk
      check (length(btrim(message)) <= 50000);
  end if;
end $$;

create table if not exists public.submission_history (
  id            bigint generated always as identity primary key,
  submission_id bigint not null references public.submissions(id) on delete cascade,
  admin_id      uuid references auth.users(id) on delete set null,
  old_status    text,
  new_status    text,
  action        text not null,
  details       jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id         bigint generated always as identity primary key,
  admin_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  table_name text,
  record_id  bigint,
  details    jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  email      text not null unique,
  role       text not null default 'admin',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admin_profiles_role_chk') then
    alter table public.admin_profiles add constraint admin_profiles_role_chk
      check (role in ('super_admin','admin','viewer'));
  end if;
end $$;

create index if not exists submissions_created_idx   on public.submissions (created_at desc);
create index if not exists submissions_status_idx    on public.submissions (status, created_at desc);
create index if not exists submissions_college_idx   on public.submissions (college_id);
create index if not exists submissions_type_idx      on public.submissions (submission_type);
create index if not exists submissions_client_idx    on public.submissions (anon_client_id, created_at);
create index if not exists submissions_sender_idx    on public.submissions (sender_name);
create index if not exists history_submission_idx    on public.submission_history (submission_id, created_at desc);
create index if not exists audit_logs_created_idx    on public.audit_logs (created_at desc);
create index if not exists colleges_order_idx        on public.colleges (display_order);

-- ===========================================================================
-- [2/4] الحماية والأمان (RLS)
-- ===========================================================================

create or replace function public.is_admin(min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (case p.role
             when 'super_admin' then 3
             when 'admin'       then 2
             when 'viewer'      then 1
             else 0 end)
          >= (case min_role
             when 'super_admin' then 3
             when 'admin'       then 2
             else 1 end)
  );
$$;

create or replace function public.lu_like_escape(term text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(
    replace(replace(replace(btrim(coalesce(term, '')), '\', '\\'), '%', '\%'), '_', '\_'),
  '');
$$;

create or replace function public.lu_create_policy(p_sql text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  execute p_sql;
exception
  when duplicate_object then null;
end;
$$;

alter table public.colleges           enable row level security;
alter table public.app_settings       enable row level security;
alter table public.submissions        enable row level security;
alter table public.submission_history enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.admin_profiles     enable row level security;

revoke all on public.submissions         from anon;
revoke all on public.submission_history  from anon;
revoke all on public.audit_logs          from anon;
revoke all on public.admin_profiles      from anon;

select public.lu_create_policy($p$
  create policy "colleges_public_select" on public.colleges
  for select using (is_active = true)
$p$);

select public.lu_create_policy($p$
  create policy "colleges_admin_select" on public.colleges
  for select to authenticated using (true)
$p$);

select public.lu_create_policy($p$
  create policy "colleges_admin_insert" on public.colleges
  for insert to authenticated with check (public.is_admin('admin'))
$p$);

select public.lu_create_policy($p$
  create policy "colleges_admin_update" on public.colleges
  for update to authenticated
  using (public.is_admin('admin')) with check (public.is_admin('admin'))
$p$);

select public.lu_create_policy($p$
  create policy "settings_public_select" on public.app_settings
  for select using (true)
$p$);

select public.lu_create_policy($p$
  create policy "settings_admin_update" on public.app_settings
  for update to authenticated
  using (public.is_admin('admin')) with check (public.is_admin('admin'))
$p$);

select public.lu_create_policy($p$
  create policy "submissions_admin_select" on public.submissions
  for select to authenticated using (public.is_admin('viewer'))
$p$);

select public.lu_create_policy($p$
  create policy "submissions_admin_update" on public.submissions
  for update to authenticated
  using (public.is_admin('admin')) with check (public.is_admin('admin'))
$p$);

select public.lu_create_policy($p$
  create policy "history_admin_select" on public.submission_history
  for select to authenticated using (public.is_admin('admin'))
$p$);

select public.lu_create_policy($p$
  create policy "audit_admin_select" on public.audit_logs
  for select to authenticated using (public.is_admin('admin'))
$p$);

select public.lu_create_policy($p$
  create policy "admins_admin_select" on public.admin_profiles
  for select to authenticated using (public.is_admin('viewer'))
$p$);

select public.lu_create_policy($p$
  create policy "admins_super_update" on public.admin_profiles
  for update to authenticated
  using (public.is_admin('super_admin')) with check (public.is_admin('super_admin'))
$p$);

select public.lu_create_policy($p$
  create policy "admins_super_delete" on public.admin_profiles
  for delete to authenticated using (public.is_admin('super_admin'))
$p$);

-- ===========================================================================
-- [3/4] الدوال والمفوقات وواجهات RPC
-- ===========================================================================

create or replace function public.tf_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.tf_submission_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference_number is null or new.reference_number = '' then
    new.reference_number := 'LU-' || to_char(now(), 'YYYY') || '-' ||
                            lpad(nextval('public.submission_ref_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function public.tf_submission_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.college_id is null then
    new.college_name_snapshot := null;
  else
    select c.name into new.college_name_snapshot
    from public.colleges c
    where c.id = new.college_id;
  end if;
  return new;
end;
$$;

create or replace function public.tf_submission_status_times()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'replied'  then new.replied_at  := coalesce(new.replied_at,  now()); end if;
    if new.status = 'resolved' then new.resolved_at := coalesce(new.resolved_at, now()); end if;
    if new.status = 'archived' then new.archived_at := coalesce(new.archived_at, now()); end if;
    if old.status = 'archived' and new.status <> 'archived' then
      new.archived_at := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.tf_submissionimmutable_guard()
returns trigger
language plpgsql
as $$
begin
  new.created_at := old.created_at;
  new.anon_client_id := old.anon_client_id;
  return new;
end;
$$;

create or replace function public.tf_submission_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
  v_details jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.submission_history
      (submission_id, admin_id, old_status, new_status, action, details)
    values
      (new.id, auth.uid(), null, new.status, 'created',
       jsonb_build_object(
         'type',        new.submission_type,
         'college',     new.college_name_snapshot,
         'has_name',    (new.sender_name is not null),
         'source',      'public_form'));
    return new;
  end if;

  if new.status is distinct from old.status then
    v_action  := 'status_change';
    v_details := jsonb_build_object('old', old.status, 'new', new.status);
  elsif new.admin_reply is distinct from old.admin_reply then
    v_action  := 'admin_reply';
    v_details := jsonb_build_object('length', char_length(coalesce(new.admin_reply, '')));
  elsif new.internal_notes is distinct from old.internal_notes then
    v_action  := 'internal_notes';
    v_details := jsonb_build_object('length', char_length(coalesce(new.internal_notes, '')));
  else
    return new;
  end if;

  insert into public.submission_history
    (submission_id, admin_id, old_status, new_status, action, details)
  values
    (new.id, auth.uid(), old.status, new.status, v_action, v_details);

  return new;
end;
$$;

drop trigger if exists trg_colleges_touch on public.colleges;
create trigger trg_colleges_touch before update on public.colleges
for each row execute function public.tf_touch_updated_at();

drop trigger if exists trg_settings_touch on public.app_settings;
create trigger trg_settings_touch before update on public.app_settings
for each row execute function public.tf_touch_updated_at();

drop trigger if exists trg_admins_touch on public.admin_profiles;
create trigger trg_admins_touch before update on public.admin_profiles
for each row execute function public.tf_touch_updated_at();

drop trigger if exists trg_submissions_touch on public.submissions;
create trigger trg_submissions_touch before update on public.submissions
for each row execute function public.tf_touch_updated_at();

drop trigger if exists trg_submissions_ref on public.submissions;
create trigger trg_submissions_ref before insert on public.submissions
for each row execute function public.tf_submission_reference();

drop trigger if exists trg_submissions_immutable on public.submissions;
create trigger trg_submissions_immutable before update on public.submissions
for each row execute function public.tf_submissionimmutable_guard();

drop trigger if exists trg_submissions_times on public.submissions;
create trigger trg_submissions_times before update on public.submissions
for each row execute function public.tf_submission_status_times();

drop trigger if exists trg_submissions_snapshot on public.submissions;
create trigger trg_submissions_snapshot
  before insert or update of college_id on public.submissions
  for each row execute function public.tf_submission_snapshot();

drop trigger if exists trg_submissions_history on public.submissions;
create trigger trg_submissions_history
  after insert or update on public.submissions
  for each row execute function public.tf_submission_history();

create or replace function public.submit_public_message(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s             public.app_settings%rowtype;
  v_type        text;
  v_msg         text;
  v_name        text;
  v_college_id  bigint;
  v_client      text;
  v_elapsed     integer;
  v_new_id      bigint;
  v_new_ref     text;
begin
  if coalesce(payload->>'website', '') <> '' then
    raise exception 'SUBMIT:SPAM';
  end if;

  v_elapsed := coalesce((payload->>'elapsed_ms')::integer, 0);
  if v_elapsed < 1200 then
    raise exception 'SUBMIT:TOO_FAST';
  end if;

  select * into s from public.app_settings where id = 1;
  if s.id is null then
    raise exception 'SUBMIT:NOT_INITIALIZED';
  end if;

  if not s.is_form_enabled then
    raise exception 'SUBMIT:FORM_CLOSED';
  end if;

  v_type := payload->>'submission_type';
  if v_type not in ('complaint','suggestion') then
    raise exception 'SUBMIT:BAD_TYPE';
  end if;
  if v_type = 'complaint' and not s.allow_complaints then
    raise exception 'SUBMIT:TYPE_DISABLED';
  end if;
  if v_type = 'suggestion' and not s.allow_suggestions then
    raise exception 'SUBMIT:TYPE_DISABLED';
  end if;

  v_msg := btrim(coalesce(payload->>'message', ''));
  if v_msg is null or char_length(v_msg) = 0 then
    raise exception 'SUBMIT:EMPTY';
  end if;
  if char_length(v_msg) < greatest(s.message_min_length, 1)
     or char_length(v_msg) > greatest(s.message_max_length, 10) then
    raise exception 'SUBMIT:LENGTH';
  end if;

  v_name := nullif(btrim(coalesce(payload->>'sender_name', '')), '');
  if char_length(coalesce(v_name, '')) > 120 then
    raise exception 'SUBMIT:NAME_TOO_LONG';
  end if;
  if not s.show_name_field then
    v_name := null;
  end if;
  if s.name_required and (v_name is null) then
    raise exception 'SUBMIT:NAME_REQUIRED';
  end if;

  v_college_id := nullif(btrim(coalesce(payload->>'college_id', '')), '')::bigint;
  if v_college_id is not null and not exists (
      select 1 from public.colleges c
      where c.id = v_college_id and c.is_active) then
    raise exception 'SUBMIT:COLLEGE_INVALID';
  end if;
  if v_college_id is null and s.require_college then
    raise exception 'SUBMIT:COLLEGE_REQUIRED';
  end if;

  v_client := left(coalesce(btrim(coalesce(payload->>'client_token', '')), 'unknown'), 64);

  if (select count(*) from public.submissions
      where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'SUBMIT:OVERLOAD';
  end if;

  if (select count(*) from public.submissions
      where anon_client_id = v_client
        and created_at > now() - interval '60 minutes') >= 10 then
    raise exception 'SUBMIT:RATE_LIMITED';
  end if;

  if exists (select 1 from public.submissions
             where anon_client_id = v_client
               and message = v_msg
               and created_at > now() - interval '10 minutes') then
    raise exception 'SUBMIT:DUPLICATE';
  end if;

  insert into public.submissions
      (sender_name, college_id, submission_type, message, status, anon_client_id)
  values
      (v_name, v_college_id, v_type, v_msg, 'new', v_client)
  returning id, reference_number into v_new_id, v_new_ref;

  return jsonb_build_object('ok', true, 'id', v_new_id, 'reference_number', v_new_ref);
end;
$$;

create or replace function public.get_dashboard_stats(filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f_from  timestamptz;
  f_to    timestamptz;
  f_search text;
  v_len    interval;
  v_from_p timestamptz;
  res      jsonb;
  v_total  bigint;
  v_prev   bigint;
  v_wk_a   bigint;  v_wk_a_c bigint;  v_wk_a_s bigint;
  v_wk_b   bigint;  v_wk_b_c bigint;  v_wk_b_s bigint;
  v_mo_a   bigint;  v_mo_a_c bigint;  v_mo_a_s bigint;
  v_mo_b   bigint;  v_mo_b_c bigint;  v_mo_b_s bigint;
begin
  if not public.is_admin('viewer') then
    raise exception 'STATS:FORBIDDEN';
  end if;

  f_from   := nullif(btrim(coalesce(filters->>'date_from', '')), '')::timestamptz;
  f_to     := nullif(btrim(coalesce(filters->>'date_to',   '')), '')::timestamptz;
  f_search := public.lu_like_escape(coalesce(filters->>'search', ''));

  with m as (
    select s.*
    from public.submissions s
    where (filters->>'type' is null or s.submission_type = filters->>'type')
      and (  (filters->'statuses') is null
          or jsonb_typeof(filters->'statuses') <> 'array'
          or jsonb_array_length(filters->'statuses') = 0
          or s.status = any (
               select value from jsonb_array_elements_text(filters->'statuses')))
      and (filters->>'college_id' is null or s.college_id = (filters->>'college_id')::bigint)
      and (f_from is null or s.created_at >= f_from)
      and (f_to   is null or s.created_at <= f_to)
      and (f_search is null
           or s.reference_number  ilike '%' || f_search || '%'
           or coalesce(s.sender_name, '') ilike '%' || f_search || '%'
           or s.message ilike '%' || f_search || '%')
  )
  select jsonb_build_object(
    'ok',              true,
    'total',           (select count(*) from m),
    'complaints',      (select count(*) from m where submission_type = 'complaint'),
    'suggestions',     (select count(*) from m where submission_type = 'suggestion'),
    'status_new',      (select count(*) from m where status = 'new'),
    'status_review',   (select count(*) from m where status in ('in_review','in_progress')),
    'status_replied',  (select count(*) from m where status = 'replied'),
    'status_resolved', (select count(*) from m where status = 'resolved'),
    'status_rejected', (select count(*) from m where status = 'rejected'),
    'status_archived', (select count(*) from m where status = 'archived'),
    'by_college', coalesce((
        select jsonb_agg(jsonb_build_object('name', x.college_display, 'count', x.cnt))
        from (
          select coalesce(college_name_snapshot, 'غير محدد') as college_display,
                 count(*) as cnt
          from m group by 1 order by 2 desc
        ) x), '[]'::jsonb),
    'by_day', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(d.day, 'YYYY-MM-DD'),
                 'complaints', coalesce(t.c, 0),
                 'suggestions', coalesce(t.s, 0)) order by d.day)
        from generate_series(current_date - interval '29 days',
                             current_date, interval '1 day') as d(day)
        left join (
          select created_at::date as cd,
                 count(*) filter (where submission_type = 'complaint')  as c,
                 count(*) filter (where submission_type = 'suggestion') as s
          from m group by 1
        ) t on t.cd = d.day::date
      ), '[]'::jsonb),
    'by_month', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(d.m, 'YYYY-MM'),
                 'complaints', coalesce(t.c, 0),
                 'suggestions', coalesce(t.s, 0)) order by d.m)
        from generate_series(date_trunc('month', now() - interval '11 months'),
                             now(), interval '1 month') as d(m)
        left join (
          select date_trunc('month', created_at) as mm,
                 count(*) filter (where submission_type = 'complaint')  as c,
                 count(*) filter (where submission_type = 'suggestion') as s
          from m group by 1
        ) t on t.mm = d.m
      ), '[]'::jsonb)
  ) into res;

  select count(*),
         count(*) filter (where submission_type = 'complaint'),
         count(*) filter (where submission_type = 'suggestion')
    into v_wk_a, v_wk_a_c, v_wk_a_s
    from public.submissions
    where created_at >= now() - interval '7 days';

  select count(*),
         count(*) filter (where submission_type = 'complaint'),
         count(*) filter (where submission_type = 'suggestion')
    into v_wk_b, v_wk_b_c, v_wk_b_s
    from public.submissions
    where created_at >= now() - interval '14 days'
      and created_at <  now() - interval '7 days';

  select count(*),
         count(*) filter (where submission_type = 'complaint'),
         count(*) filter (where submission_type = 'suggestion')
    into v_mo_a, v_mo_a_c, v_mo_a_s
    from public.submissions
    where created_at >= date_trunc('month', now());

  select count(*),
         count(*) filter (where submission_type = 'complaint'),
         count(*) filter (where submission_type = 'suggestion')
    into v_mo_b, v_mo_b_c, v_mo_b_s
    from public.submissions
    where created_at >= date_trunc('month', now()) - interval '1 month'
      and created_at <  date_trunc('month', now());

  res := res || jsonb_build_object(
    'compare', jsonb_build_object(
      'week',
        jsonb_build_object(
          'a', jsonb_build_object('total', v_wk_a, 'complaints', v_wk_a_c, 'suggestions', v_wk_a_s),
          'b', jsonb_build_object('total', v_wk_b, 'complaints', v_wk_b_c, 'suggestions', v_wk_b_s)),
      'month',
        jsonb_build_object(
          'a', jsonb_build_object('total', v_mo_a, 'complaints', v_mo_a_c, 'suggestions', v_mo_a_s),
          'b', jsonb_build_object('total', v_mo_b, 'complaints', v_mo_b_c, 'suggestions', v_mo_b_s))));

  if f_from is not null and f_to is not null and f_from < f_to then
    select count(*) into v_total
      from public.submissions s
      where (filters->>'type' is null or s.submission_type = filters->>'type')
        and (  (filters->'statuses') is null
            or jsonb_typeof(filters->'statuses') <> 'array'
            or jsonb_array_length(filters->'statuses') = 0
            or s.status = any (select value from jsonb_array_elements_text(filters->'statuses')))
        and (filters->>'college_id' is null or s.college_id = (filters->>'college_id')::bigint)
        and (f_search is null
             or s.reference_number  ilike '%' || f_search || '%'
             or coalesce(s.sender_name, '') ilike '%' || f_search || '%'
             or s.message ilike '%' || f_search || '%');
    res := jsonb_set(res, '{total}', to_jsonb(v_total));

    v_len    := (f_to - f_from);
    v_from_p := f_from - v_len;
    select count(*) into v_prev
      from public.submissions s
      where (filters->>'type' is null or s.submission_type = filters->>'type')
        and (  (filters->'statuses') is null
            or jsonb_typeof(filters->'statuses') <> 'array'
            or jsonb_array_length(filters->'statuses') = 0
            or s.status = any (select value from jsonb_array_elements_text(filters->'statuses')))
        and (filters->>'college_id' is null or s.college_id = (filters->>'college_id')::bigint)
        and (f_search is null
             or s.reference_number  ilike '%' || f_search || '%'
             or coalesce(s.sender_name, '') ilike '%' || f_search || '%'
             or s.message ilike '%' || f_search || '%')
        and s.created_at >= v_from_p
        and s.created_at <  f_from;

    res := res || jsonb_build_object(
      'compare_range', jsonb_build_object('a', v_total, 'b', v_prev));
  end if;

  return res;
end;
$$;

create or replace function public.log_admin_action(
  p_action     text,
  p_table_name text default null,
  p_record_id  bigint default null,
  p_details    jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if not public.is_admin('admin') then
    raise exception 'AUDIT:FORBIDDEN';
  end if;

  insert into public.audit_logs (admin_id, action, table_name, record_id, details)
  values (auth.uid(), p_action, p_table_name, p_record_id, p_details)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.add_admin_by_email(
  p_email text,
  p_full_name text,
  p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid;
  v_email text;
begin
  if not public.is_admin('super_admin') then
    raise exception 'ADMINS:FORBIDDEN';
  end if;

  if p_role not in ('super_admin','admin','viewer') then
    raise exception 'ADMINS:BAD_ROLE';
  end if;

  if btrim(coalesce(p_email, '')) = '' or btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'ADMINS:INPUT_REQUIRED';
  end if;

  select u.id, u.email into v_uid, v_email
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;

  if v_uid is null then
    raise exception 'ADMINS:USER_NOT_FOUND';
  end if;

  if exists (select 1 from public.admin_profiles ap
             where ap.id <> v_uid and lower(ap.email) = lower(btrim(p_email))) then
    raise exception 'ADMINS:EMAIL_TAKEN';
  end if;

  insert into public.admin_profiles (id, full_name, email, role, is_active)
  values (v_uid, btrim(p_full_name), v_email, p_role, true)
  on conflict (id) do update
    set full_name = excluded.full_name,
        role      = excluded.role,
        is_active = true,
        updated_at = now();

  insert into public.audit_logs (admin_id, action, table_name, record_id, details)
  values (auth.uid(), 'admin_upsert', 'admin_profiles', null,
    jsonb_build_object('email', v_email, 'role', p_role));

  return jsonb_build_object('ok', true, 'id', v_uid, 'email', v_email);
end;
$$;

create or replace function public.remove_admin(p_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin('super_admin') then
    raise exception 'ADMINS:FORBIDDEN';
  end if;

  if p_admin_id = auth.uid() then
    raise exception 'ADMINS:CANNOT_SELF_REMOVE';
  end if;

  if not exists (select 1 from public.admin_profiles ap where ap.id = p_admin_id) then
    raise exception 'ADMINS:NOT_FOUND';
  end if;

  delete from public.admin_profiles where id = p_admin_id;

  insert into public.audit_logs (admin_id, action, table_name, record_id, details)
  values (auth.uid(), 'admin_remove', 'admin_profiles', null,
    jsonb_build_object('removed_id', p_admin_id));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_college(p_college_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if not public.is_admin('admin') then
    raise exception 'COLLEGE:FORBIDDEN';
  end if;

  select c.name into v_name from public.colleges c where c.id = p_college_id;
  if v_name is null then
    raise exception 'COLLEGE:NOT_FOUND';
  end if;

  if exists (select 1 from public.submissions s where s.college_id = p_college_id) then
    raise exception 'COLLEGE:IN_USE';
  end if;

  delete from public.colleges where id = p_college_id;

  insert into public.audit_logs (admin_id, action, table_name, record_id, details)
  values (auth.uid(), 'college_delete', 'colleges', p_college_id,
    jsonb_build_object('name', v_name));

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.get_dashboard_stats(jsonb)      from public, anon;
revoke execute on function public.log_admin_action(text,text,bigint,jsonb) from public, anon;
revoke execute on function public.add_admin_by_email(text,text,text)        from public, anon;
revoke execute on function public.remove_admin(uuid)              from public, anon;
revoke execute on function public.delete_college(bigint)          from public, anon;

grant execute on function public.submit_public_message(jsonb)          to anon, authenticated, service_role;
grant execute on function public.get_dashboard_stats(jsonb)            to authenticated, service_role;
grant execute on function public.log_admin_action(text,text,bigint,jsonb) to authenticated, service_role;
grant execute on function public.add_admin_by_email(text,text,text)    to authenticated, service_role;
grant execute on function public.remove_admin(uuid)                    to authenticated, service_role;
grant execute on function public.delete_college(bigint)                to authenticated, service_role;

-- ===========================================================================
-- [4/4] التحديثات الفورية (Realtime) + التخزين
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('system', 'system', true)
on conflict (id) do update set public = true;

select public.lu_create_policy($p$
  create policy "system_storage_public_read" on storage.objects
  for select using (bucket_id = 'system')
$p$);

select public.lu_create_policy($p$
  create policy "system_storage_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'system' and public.is_admin('admin'))
$p$);

select public.lu_create_policy($p$
  create policy "system_storage_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'system' and public.is_admin('admin'))
  with check (bucket_id = 'system' and public.is_admin('admin'))
$p$);

select public.lu_create_policy($p$
  create policy "system_storage_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'system' and public.is_admin('admin'))
$p$);

alter table public.submissions replica identity full;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      create publication supabase_realtime;
    exception when others then null;
    end;
  end if;
end $$;

do $$ begin
  begin
    alter publication supabase_realtime add table public.submissions;
  exception when duplicate_object then null;
  end;
end $$;

do $$ begin
  begin
    alter publication supabase_realtime add table public.app_settings;
  exception when duplicate_object then null;
  end;
end $$;

do $$ begin
  begin
    alter publication supabase_realtime add table public.colleges;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- FINISH — تحقق سريع من الجداول
-- ============================================================================
select table_name,
       (select count(*) from information_schema.columns c where c.table_name = t.table_name and c.table_schema='public') as columns_count
from information_schema.tables t
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
