-- ============================================================
-- fix_patch.sql — إصلاحات مطلوبة بعد run_all.sql
-- نفّذ هذا الملف في Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1) دالة الحذف النهائي للرسالة (للمديرين admin/super_admin)
create or replace function public.delete_submission(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ref text;
begin
  if not public.is_admin('admin') then
    raise exception 'DELETE:FORBIDDEN';
  end if;

  select reference_number into v_ref from public.submissions where id = p_id;
  if v_ref is null then
    raise exception 'DELETE:NOT_FOUND';
  end if;

  -- تسجيل العملية قبل الحذف (سجل الحالات المرتبط يُحذف تلقائيًا بـ cascade)
  insert into public.audit_logs (admin_id, action, table_name, record_id, details)
  values (auth.uid(), 'submission_delete', 'submissions', p_id,
          jsonb_build_object('reference_number', v_ref));

  delete from public.submissions where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke execute on function public.delete_submission(bigint) from public, anon;
grant  execute on function public.delete_submission(bigint) to authenticated, service_role;


-- ============================================================
-- 2) متابعة الرسائل (إظهار/إخفاء للمستخدم + استعلام بالرقم المرجعي)
-- ============================================================

-- عمود التحكم في ظهور المتابعة للمستخدم
alter table public.submissions
  add column if not exists track_visible boolean not null default true;

-- دالة عامة آمنة للاستعلام عن حالة رسالة بالرقم المرجعي (لا تُرجع بيانات حساسة)
create or replace function public.track_submission(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_ref text;
begin
  v_ref := upper(btrim(coalesce(p_ref, '')));
  if v_ref = '' then
    return jsonb_build_object('ok', false, 'reason', 'EMPTY');
  end if;

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
grant execute on function public.track_submission(text) to anon, authenticated, service_role;


-- ============================================================
-- 4) تمييز الرسائل المقروءة (علامة "تمت القراءة" عند فتح الرسالة من الإدارة)
-- ============================================================
alter table public.submissions
  add column if not exists admin_seen_at timestamptz null;


-- ============================================================
-- 5) إعادة استخدام الأرقام المحذوفة في الرقم المرجعي الجديد
--    بدل استمرار العداد للأمام، يأخذ الرقم الجديد أصغر رقم
--    غير مستخدم في السنة الحالية (يعيد أرقام المحذوفات)
-- ============================================================
create or replace function public.tf_submission_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year   text;
  v_prefix text;
  v_max    bigint := 0;
  v_n      bigint;
begin
  if new.reference_number is null or new.reference_number = '' then

    -- قفل يمنع إسناد رقم واحد لرسالتين متزامنتين
    perform pg_advisory_xact_lock(hashtext('lu_reference_generator'));

    v_year   := to_char(now(), 'YYYY');
    v_prefix := 'LU-' || v_year || '-';

    -- أكبر رقم مستخدم حالياً في السنة الحالية
    select coalesce(max(substring(reference_number from 'LU-[0-9]{4}-0*([0-9]+)$')::bigint), 0)
      into v_max
      from public.submissions
     where reference_number like v_prefix || '%'
       and reference_number ~ '^LU-[0-9]{4}-[0-9]+$';

    -- أصغر رقم غير مستخدم (يعيد استخدام أرقام الرسائل المحذوفة)
    select coalesce(min(g.n), v_max + 1)
      into v_n
      from generate_series(1, v_max + 1) as g(n)
     where not exists (
            select 1
              from public.submissions s
             where s.reference_number = v_prefix || lpad(g.n::text, 5, '0')
           );

    new.reference_number := v_prefix || lpad(v_n::text, 5, '0');
  end if;

  return new;
end;
$$;


-- ============================================================
-- 3) تصفير كل بيانات الرسائل (اختياري) — نفّذ هذا الجزء فقط إذا أردت مسح كل الرسائل
--    يحذف: الرسائل + سجل حالاتها + سجلات العمليات المرتبطة بها
--    لا يحذف: الكليات، الإعدادات، حسابات المديرين
-- ============================================================
/*
begin;

delete from public.audit_logs
where table_name in ('submissions', 'submission_history')
   or action in ('submission_delete','status_change','reply_saved','notes_saved');

truncate table public.submission_history, public.submissions restart identity cascade;

-- تصفير عداد الأرقام المرجعية (LU-YYYY-00001 من جديد)
alter sequence public.submission_ref_seq restart with 1;

commit;
*/

-- للتحقق بعد التنفيذ:
-- select count(*) as submissions from public.submissions;
-- select count(*) as history from public.submission_history;