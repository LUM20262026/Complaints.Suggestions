-- ============================================================================
-- Migration 001 — الجداول الأساسية + قيم البداية + المؤشرات
-- نظام الشكاوى والمقترحات — جامعة اللوتس (Lotus University)
-- ملاحظات:
--   * هذا الملف آمن للتنفيذ المتكرر (Idempotent) ولن يحذف أو يستبدل أي بيانات.
--   * لا يحتوي أي DROP أو TRUNCATE على بيانات.
-- اخراج: التاريخ الحالي بتوقيت المشروع.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) جدول الكليات
-- ---------------------------------------------------------------------------
create table if not exists public.colleges (
  id            bigint generated always as identity primary key,
  name          text    not null unique,
  is_active     boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) جدول إعدادات النظام (صف واحد يتحكم فياجهة المستخدم العامة)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                   smallint primary key default 1,
  university_name      text not null default 'جامعة اللوتس',
  page_title           text not null default 'منصة الشكاوى والمقترحات',
  welcome_text         text not null default 'أهلاً بك في منصة الجامعة — صوتك مسموع ومهما',
  description          text not null default 'منصة رسمية مخصصة لاستقبال شكاوى ومقترحات الطلاب وأعضاء هيئة التدريس والموظفين. أرسل رسالتك أولاً وهذا الامر بسرية تامة وستصل مباشرة إلى الإدارة المختصة.',
  submit_button_text   text not null default 'إرسال الرسالة',
  success_message      text not null default 'تم إرسال رسالتك بنجاح إلى إدارة الجامعة',
  closed_message       text not null default 'تم إيقاف استقبال الرسائل مؤقتاً. نعتذر عن الإزاحة ونتمنى أن تثبت العنارة لاحقاً.',
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

-- قيود منطقية على الإعدادات (تُنشأ فقط إن لم تكن موجودة لتكون الهجرة قابلة للتكرار)
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

-- صف الإعدادات الافتراضي (صف واحد فقط id = 1)
insert into public.app_settings (id) values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) الكليات الأساسية للجامعة (ترتيب رسمي)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4) جدول الرسائل (الشكاوى والمقترحات)
--    college_name_snapshot: يحفظ اسم الكلية وقت الإرسال حتى تظل التقارير
--    التاريخية صحيحة حتى لو غيُير اسم الكلية لاحقاً.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5) جدول سجل تغيّرات الرسائل (من أقام التغيير وما هو الحالة السابقة والجديدة)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6) جدول سجل عمليات الإدارة (Audit Log)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id         bigint generated always as identity primary key,
  admin_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  table_name text,
  record_id  bigint,
  details    jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7) جدول المديرين والصلاحيات (مرتبط بحسابات Supabase Auth)
--    الأدوار: super_admin / admin / viewer
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 8) المؤشرات الفهارس الأساسية
-- ---------------------------------------------------------------------------
create index if not exists submissions_created_idx   on public.submissions (created_at desc);
create index if not exists submissions_status_idx    on public.submissions (status, created_at desc);
create index if not exists submissions_college_idx   on public.submissions (college_id);
create index if not exists submissions_type_idx      on public.submissions (submission_type);
create index if not exists submissions_client_idx    on public.submissions (anon_client_id, created_at);
create index if not exists submissions_sender_idx    on public.submissions (sender_name);
create index if not exists history_submission_idx    on public.submission_history (submission_id, created_at desc);
create index if not exists audit_logs_created_idx    on public.audit_logs (created_at desc);
create index if not exists colleges_order_idx        on public.colleges (display_order);

-- ملخص نجاح المرحلة
select 'Migration 001 executed successfully — core tables are ready (no data was deleted).' as status;
