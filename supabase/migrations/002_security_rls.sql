-- ============================================================================
-- Migration 002 — الحماية والأمان (RLS) على مستوى قاعدة البيانات
-- نظام الشكاوى والمقترحات — جامعة اللوتس
-- المبدأ:
--   * الزائر (anon): لا يقرأ رسائل، لا يعدل، لا يحذف — يُرسل فقط عبر دالة
--     RPC تتحقق من كل الشروط (Migration 003).
--   * المدير (authenticated): وصول محدد بجدول admin_profiles ودوره.
--   * التحقق من الصلاحيات يتم داخل PostgreSQL وليس في JavaScript.
--   * آمن للتنفيذ المتكرر.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) دالة مساعدة للتحقق من دور المدير الحالي (بتراتيب صلب هرمي)
--    security definer => تتجاوز RLS عند قراءة admin_profiles (تفادي التدوير)
-- ---------------------------------------------------------------------------
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

-- دالة تهرب الرموز الخاصة عند البحث بـ LIKE (منع تلاعب بنمط البحث)
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

-- دالة مساعدة لإنشاء السياسات دون تكرار (الهجرة آمنة على التكرار)
create or replace function public.lu_create_policy(p_sql text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  execute p_sql;
exception
  when duplicate_object then null;  -- السياسة موجودة مسبقاً
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) تفعيل RLS على جميع الجداول المكشوفة عبر الـ API
-- ---------------------------------------------------------------------------
alter table public.colleges           enable row level security;
alter table public.app_settings       enable row level security;
alter table public.submissions        enable row level security;
alter table public.submission_history enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.admin_profiles     enable row level security;

-- ---------------------------------------------------------------------------
-- 3) سحب صلاحيات الجداول الحساسة من الزائر (anon) كطبقة إضافية فوق RLS
-- ---------------------------------------------------------------------------
revoke all on public.submissions         from anon;
revoke all on public.submission_history  from anon;
revoke all on public.audit_logs          from anon;
revoke all on public.admin_profiles      from anon;

-- ---------------------------------------------------------------------------
-- 4) سياسات جدول الكليات
--    الزائر: يرى الكليات المفعلة فقط (لازم لنموذج الإرسال)
--    المدير: يرى الجميع ويضيف ويعدل (بدون حذف مباشر — يحذف عبر RPC بشرط عدم وجود رسائل)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5) سياسات جدول الإعدادات
--    الجميع يقرأ (تحتاجها واجهة المستخدم لتولد الشكل)، التعديل للمديرين فقط
-- ---------------------------------------------------------------------------
select public.lu_create_policy($p$
  create policy "settings_public_select" on public.app_settings
  for select using (true)
$p$);

select public.lu_create_policy($p$
  create policy "settings_admin_update" on public.app_settings
  for update to authenticated
  using (public.is_admin('admin')) with check (public.is_admin('admin'))
$p$);

-- ---------------------------------------------------------------------------
-- 6) سياسات جدول الرسائل
--    لا توجد أي سياسة للزوار على الإطلاق = لا قراءة ولا كتابة ولا تعديل ولا حذف.
--    الرسائل الجديدة تُنشأ عبر دالة RPC فقط (منع تجاوز قواعد التحقق).
--    لم يُنشأ سياست حذف إطلاقاً = الحذف النهائي محظور من الواجهة.
-- ---------------------------------------------------------------------------
select public.lu_create_policy($p$
  create policy "submissions_admin_select" on public.submissions
  for select to authenticated using (public.is_admin('viewer'))
$p$);

select public.lu_create_policy($p$
  create policy "submissions_admin_update" on public.submissions
  for update to authenticated
  using (public.is_admin('admin')) with check (public.is_admin('admin'))
$p$);

-- (حماية إضافية): منع تحديث حقول الحماية عبر واجهة REST — التحقق عبر Trigger
-- في Migration 003 يمنع تغيير السنوات الأساسية (created_at و anon_client_id).

-- ---------------------------------------------------------------------------
-- 7) سياسات سجل التغييرات (submission_history)
-- ---------------------------------------------------------------------------
select public.lu_create_policy($p$
  create policy "history_admin_select" on public.submission_history
  for select to authenticated using (public.is_admin('admin'))
$p$);

-- ---------------------------------------------------------------------------
-- 8) سياسات سجل العمليات (audit_logs)
-- ---------------------------------------------------------------------------
select public.lu_create_policy($p$
  create policy "audit_admin_select" on public.audit_logs
  for select to authenticated using (public.is_admin('admin'))
$p$);

-- ---------------------------------------------------------------------------
-- 9) سياسات حسابات المديرين (admin_profiles)
--    * عرض: لأي مدير مفعّل (يحتاجها نظام الصلاحيات والقوائم)
--    * تعديل أو حذف: للسوبر أدمن فقط — منع تصعيد صلاحيات من قبل admin
--    * إدراج: لا يوجد سياسة مباشرة — الإضافة عبر دالة RPC آمنة تتحقق من الدور
-- ---------------------------------------------------------------------------
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

-- ملخص نجاح المرحلة
select 'Migration 002 executed successfully — RLS policies applied (visitors are locked out).' as status;
