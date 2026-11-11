-- ============================================================================
-- security_patch.sql — تصحيحات أمنية بعد مراجعة شاملة
-- نفّذ هذا الملف في: Supabase → SQL Editor → New query → Run
-- الملف آمن للتنفيذ المتكرر (يعيد تشغيله مرة أخرى لن يسبب خطأ)
-- ============================================================================


-- ============================================================================
-- 1) [عالي] إغلاق تسريب محتوى الرسائل عبر التحديث الفورية (Realtime)
-- ----------------------------------------------------------------------------
-- المشكلة: جدول الرسائل مضبوط على "نسخة كاملة للصف" (replica identity full).
-- أحداث الحذف (DELETE) تُبثّ بدون تطبيق صلاحيات RLS، وحذف رسالة كان يرسل
-- نص الشكوى كاملاً + الرد الداخلي إلى أي مشترك.
-- الحل: إرجاع النسخ الافتراضي — أحداث الحذف لا تحمل إلا رقم الصف، والقراءة
-- الكاملة تبقى محصورة بصلاحيات الإدارة فقط. زر "رسالة جديدة فورية" يبقى شغّالاً.
-- ============================================================================
alter table public.submissions replica identity default;


-- ============================================================================
-- 2) [متوسط] إغلاق دالة إنشاء السياسات أمام المستخدمين
-- ----------------------------------------------------------------------------
-- المشكلة: الدالة تنفّذ أي جملة SQL تُمرَّر إليها، وكانت متاحة للجميع.
-- ============================================================================
revoke execute on function public.lu_create_policy(text) from public, anon, authenticated;


-- ============================================================================
-- 3) [متوسط] تقوية متابعة الرسائل: فهرس + حد محاولات
-- ----------------------------------------------------------------------------
-- 3-1) فهرس يجعل البحث بالرقم المرجعي سريعاً (بدل فحص كامل للجدول)
create index if not exists submissions_ref_upper_idx
  on public.submissions (upper(reference_number));

-- 3-2) جدول عدّ محاولات المتابعة (غير مقروء لأي دور)
create table if not exists public.track_attempts (
  ref_key     text        not null,
  attempted_at timestamptz not null default now()
);
alter table public.track_attempts enable row level security;
revoke all on public.track_attempts from public, anon, authenticated;
create index if not exists track_attempts_ref_idx
  on public.track_attempts (ref_key, attempted_at);

-- 3-3) دالة المتابعة مع حد: 5 محاولات في الدقيقة لكل رقم مرجعي
create or replace function public.track_submission(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_ref text;
  v_hits bigint;
begin
  v_ref := upper(btrim(coalesce(p_ref, '')));
  if v_ref = '' then
    return jsonb_build_object('ok', false, 'reason', 'EMPTY');
  end if;

  -- حد محاولات: يمنع تكرار الاستعلام على نفس الرقم بسرعة
  select count(*) into v_hits
    from public.track_attempts
   where ref_key = v_ref
     and attempted_at > now() - interval '1 minute';

  if v_hits >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  end if;

  insert into public.track_attempts (ref_key) values (v_ref);
  delete from public.track_attempts where attempted_at < now() - interval '1 hour';

  select
    s.reference_number,
    s.submission_type,
    s.status,
    s.created_at,
    s.updated_at,
    s.replied_at,
    s.resolved_at,
    s.admin_reply,
    s.college_name_snapshot,
    s.track_visible
  into r
  from public.submissions s
  where upper(s.reference_number) = v_ref
  limit 1;

  if r.reference_number is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  if coalesce(r.track_visible, true) = false then
    return jsonb_build_object('ok', false, 'reason', 'HIDDEN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'reference_number', r.reference_number,
    'submission_type', r.submission_type,
    'status', r.status,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'replied_at', r.replied_at,
    'resolved_at', r.resolved_at,
    'college_name', r.college_name_snapshot,
    'admin_reply', r.admin_reply
  );
end;
$$;

revoke all on function public.track_submission(text) from public;
grant  execute on function public.track_submission(text) to anon, authenticated, service_role;


-- ============================================================================
-- 4) [منخفض] تقليل صلاحيات الزائر (anon) على الجداول العامة
-- ----------------------------------------------------------------------------
-- الزائر يحتاج القراءة فقط لعرض الكليات والإعدادات في الصفحة العامة.
revoke all on public.colleges      from anon;
revoke all on public.app_settings  from anon;
grant  select on public.colleges      to anon;
grant  select on public.app_settings  to anon;

-- المتسلسل لا يحتاجه أحد من الواجهة (توليد الأرقام يتم داخل القاعدة)
revoke usage on sequence public.submission_ref_seq from anon, authenticated;


-- ============================================================================
-- 5) [منخفض] الكليات: منع رؤية الكليات المخفية من أي حساب مسجّل غير إداري
-- ============================================================================
drop policy if exists "colleges_admin_select" on public.colleges;
select public.lu_create_policy($p$
  create policy "colleges_admin_select" on public.colleges
  for select to authenticated using (public.is_admin('viewer'))
$p$);


-- ============================================================================
-- 6) [منخفض] منع "الفشل المفتوح" في دالة التحقق من الصلاحيات
-- ----------------------------------------------------------------------------
-- أي اسم دور غير معروف كان يُعامل كأقل صلاحية (viewer) — الآن يُعامل كرفض.
-- ============================================================================
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
             when 'viewer'      then 1
             else 999 end)
  );
$$;


-- ============================================================================
-- 7) [منخفض] حماية بريد وصلاحيات المديرين
-- ----------------------------------------------------------------------------
-- من قبل: أي حساب مسجّل (حتى بدون صلاحية) كان يقرأ بريد وكلاء المديرين.
-- الآن: كل مدير يرى بقية المديرين، وكل شخص يرى ملفه فقط.
-- ============================================================================
drop policy if exists "admins_admin_select" on public.admin_profiles;
select public.lu_create_policy($p$
  create policy "admins_admin_select" on public.admin_profiles
  for select to authenticated
  using (public.is_admin('admin') or id = auth.uid())
$p$);


-- ============================================================================
-- 8) [منخفض] تحقق من مدخلات سجل العمليات (منع امتلاء الجدول أو تزوير أنواع)
-- ============================================================================
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

  if p_action is null or p_action !~ '^[a-z_]{1,64}$' then
    raise exception 'AUDIT:BAD_ACTION';
  end if;

  if p_table_name is not null and p_table_name !~ '^[a-z_]{1,64}$' then
    raise exception 'AUDIT:BAD_TABLE';
  end if;

  if octet_length(coalesce(p_details::text, '')) > 4000 then
    raise exception 'AUDIT:DETAILS_TOO_LARGE';
  end if;

  insert into public.audit_logs (admin_id, action, table_name, record_id, details)
  values (auth.uid(), p_action, p_table_name, p_record_id, p_details)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.log_admin_action(text, text, bigint, jsonb) from public, anon;
grant  execute on function public.log_admin_action(text, text, bigint, jsonb) to authenticated, service_role;


-- ============================================================================
-- 9) [منخفض] قيود رفع الشعار: صور فقط وبحد أقصى 2 ميجابايت
-- ----------------------------------------------------------------------------
do $$ begin
  drop policy if exists "system_storage_admin_insert" on storage.objects;
exception when others then null;
end $$;

select public.lu_create_policy($p$
  create policy "system_storage_admin_insert" on storage.objects
  for insert to authenticated
  with check (
        bucket_id = 'system'
    and public.is_admin('admin')
    and lower(name) ~ '^[a-z0-9._-]{1,80}\.(png|jpg|jpeg|webp)$'
    and coalesce((metadata->>'size')::bigint, 0) <= 2097152
  )
$p$);

do $$ begin
  drop policy if exists "system_storage_admin_update" on storage.objects;
exception when others then null;
end $$;

select public.lu_create_policy($p$
  create policy "system_storage_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'system' and public.is_admin('admin'))
  with check (
        bucket_id = 'system'
    and public.is_admin('admin')
    and lower(name) ~ '^[a-z0-9._-]{1,80}\.(png|jpg|jpeg|webp)$'
    and coalesce((metadata->>'size')::bigint, 0) <= 2097152
  )
$p$);


-- ============================================================================
-- 10) [منخفض] تثبيت مسار البحث في المفوقات (منع تلاعب محتمل في المسار)
-- ----------------------------------------------------------------------------
-- المحتوى مطابق حرفياً للدوال الأصلية، مع إضافة set search_path فقط.
-- ============================================================================
create or replace function public.tf_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.tf_submission_status_times()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'replied'  then new.replied_at  := coalesce(new.replied_at,  now()); end if;
    if new.status = 'resolved' then new.resolved_at := coalesce(new.resolved_at, now()); end if;
    if new.status = 'archived' then new.archived_at := coalesce(new.archived_at, now()); end if;
    -- إعادة فتح الرسالة من الأرشيف ⇒ إزالة زمن الأرشفة
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
set search_path = public, pg_temp
as $$
begin
  new.created_at := old.created_at;
  new.anon_client_id := old.anon_client_id;
  return new;
end;
$$;


-- ============================================================================
-- تحقق بعد التنفيذ
-- ============================================================================
select 'security_patch executed' as status;
select relname, relreplident from pg_class
 where relname in ('submissions') and relnamespace = 'public'::regnamespace;
