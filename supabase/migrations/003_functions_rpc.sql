-- ============================================================================
-- Migration 003 — الدوال والمفوقات (Triggers) وواجهات RPC
-- نظام الشكاوى والمقترحات — جامعة اللوتس
-- تشمل:
--   * توليد الرقم المرجعي LU-YYYY-NNNNN
--   * حفظ لقطة اسم الكلية وقت الإرسال
--   * تحديث تواريخ الرد/الحل/الأرشفة آلياً
--   * تسجيل سجل التغييرات (من قام التغيير؟ الحالة السابقة والجديدة؟)
--   * دالة الإرسال العام submit_public_message (تحقق شامل + مكافحة السبام)
--   * دالة الإحصائيات get_dashboard_stats
--   * دوال الإدارة: إضافة/إزالة مدير، حذف كلية غير مستخدمة، تسجيل عملية
--   * آمن للتنفيذ المتكرر
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) المفوقات العامة
-- ---------------------------------------------------------------------------

-- تحديث updated_at تلقائياً
create or replace function public.tf_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- توليد الرقم المرجعي: LU-YYYY-NNNNN (تسلسل عالمي يتبع السنة)
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

-- حفظ لقطة اسم الكلية وقت الإرسال (تظل التقارير التاريخية صحيحة)
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

-- ضبط تواريخ الحالة فور تغييرها (وقت الرد/الحل/الأرشفة)
create or replace function public.tf_submission_status_times()
returns trigger
language plpgsql
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

-- حماية حقل السجل: منع تعديل تاريخ الإنشاء أو بصمة العميل عبر واجهة REST
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

-- تسجيل سجل التغييرات: من قام التغيير، ما الحالة السابقة والجديدة، ما الفعل
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

  -- تغيير الحالة
  if new.status is distinct from old.status then
    v_action  := 'status_change';
    v_details := jsonb_build_object('old', old.status, 'new', new.status);
  -- إضافة أو تعديل الرد الرسمي
  elsif new.admin_reply is distinct from old.admin_reply then
    v_action  := 'admin_reply';
    v_details := jsonb_build_object('length', char_length(coalesce(new.admin_reply, '')));
  -- تعديل الملاحظات الداخلية
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

-- ---------------------------------------------------------------------------
-- 2) ربط المفوقات بالجداول
-- ---------------------------------------------------------------------------
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

drop trigger if exists trg_submissions_snapshot on public.submissions;
create trigger trg_submissions_snapshot
  before insert or update of college_id on public.submissions
  for each row execute function public.tf_submission_snapshot();

drop trigger if exists trg_submissions_times on public.submissions;
create trigger trg_submissions_times before update on public.submissions
for each row execute function public.tf_submission_status_times();

drop trigger if exists trg_submissions_immutable on public.submissions;
create trigger trg_submissions_immutable before update on public.submissions
for each row execute function public.tf_submissionimmutable_guard();

drop trigger if exists trg_submissions_history on public.submissions;
create trigger trg_submissions_history
  after insert or update on public.submissions
  for each row execute function public.tf_submission_history();

-- ---------------------------------------------------------------------------
-- 3) دالة الإرسال العام للمستخدم (الزوار + المسجلين)
--    تتحقق من: حالة النموذج، النوع المقبول، طول النص، الكلية، الاسم،
--    وبصمة الجلسة لمكافحة التكرار (سبام)، مع حد أمان عام للنظام.
--    ترميز الأخطاء SUBMIT:XXX يُترجم في الواجهة إلى رسائل عربية واضحة.
-- ---------------------------------------------------------------------------
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
  -- (أ) حقل الفخ غير مرئي لحماية الروبوتات: يجب أن يظل فارغاً
  if coalesce(payload->>'website', '') <> '' then
    raise exception 'SUBMIT:SPAM';
  end if;

  -- (ب) حد أدنى من الزمن منذ فتح النموذج (حماية إيضاحية من الروبوتات)
  v_elapsed := coalesce((payload->>'elapsed_ms')::integer, 0);
  if v_elapsed < 1200 then
    raise exception 'SUBMIT:TOO_FAST';
  end if;

  -- (ج) تحميل الإعدادات والتأكد من تهيئتها
  select * into s from public.app_settings where id = 1;
  if s.id is null then
    raise exception 'SUBMIT:NOT_INITIALIZED';
  end if;

  if not s.is_form_enabled then
    raise exception 'SUBMIT:FORM_CLOSED';
  end if;

  -- (د) نوع الرسالة وما إذا كان مقبولاً حالياً
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

  -- (هـ) النص: غير فارغ وغيرمسافات فقط وضمن الحدود المحددة إدارياً
  v_msg := btrim(coalesce(payload->>'message', ''));
  if v_msg is null or char_length(v_msg) = 0 then
    raise exception 'SUBMIT:EMPTY';
  end if;
  if char_length(v_msg) < greatest(s.message_min_length, 1)
     or char_length(v_msg) > greatest(s.message_max_length, 10) then
    raise exception 'SUBMIT:LENGTH';
  end if;

  -- (و) الاسم: اختياري عند الإعدادات افتراضياً — ويُهمل كلياً إذا أوقفت الإدارة الحقل
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

  -- (ز) الكلية: إجبارية حسب الإعدادات، ويجب أن تكون كلية مفعلة موجودة فعلاً
  v_college_id := nullif(btrim(coalesce(payload->>'college_id', '')), '')::bigint;
  if v_college_id is not null and not exists (
      select 1 from public.colleges c
      where c.id = v_college_id and c.is_active) then
    raise exception 'SUBMIT:COLLEGE_INVALID';
  end if;
  if v_college_id is null and s.require_college then
    raise exception 'SUBMIT:COLLEGE_REQUIRED';
  end if;

  -- (ح) بصمة جلسة لنظام مكافحة السبام (تحدد إجابات الروبوتات المتكرر)
  v_client := left(coalesce(btrim(coalesce(payload->>'client_token', '')), 'unknown'), 64);

  -- (ط) حد أمان عام: 30 رسالة كحد أقصى في الدقيقة لكامل النظام (تقليل ضغط الحمل)
  if (select count(*) from public.submissions
      where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'SUBMIT:OVERLOAD';
  end if;

  -- (ي) حد أمان لكل جلسة: 10 رسائل كحد أقصى في 60 دقيقة
  if (select count(*) from public.submissions
      where anon_client_id = v_client
        and created_at > now() - interval '60 minutes') >= 10 then
    raise exception 'SUBMIT:RATE_LIMITED';
  end if;

  -- (ك) منع تكرار نص مطابق من نفس الجلسة خلال 10 دقائق
  if exists (select 1 from public.submissions
             where anon_client_id = v_client
               and message = v_msg
               and created_at > now() - interval '10 minutes') then
    raise exception 'SUBMIT:DUPLICATE';
  end if;

  -- (ل) الإدراج الفعلي (سنوات الحماية الأخرى تم إنفاذها بقواعد CHECK والمفوقات)
  insert into public.submissions
      (sender_name, college_id, submission_type, message, status, anon_client_id)
  values
      (v_name, v_college_id, v_type, v_msg, 'new', v_client)
  returning id, reference_number into v_new_id, v_new_ref;

  return jsonb_build_object('ok', true, 'id', v_new_id, 'reference_number', v_new_ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) دالة الإحصائيات والواجهات المخطوطة لشهر الأداء على مستوى البيانات
--    لا تُرجع نص الرسائل ولا ردود الإدارة — مجموعات رقمية فقط
-- ---------------------------------------------------------------------------
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

  -- مقارنة الفترات الزمنية: أسبوع و شهر (بيانات عامة دون فلاتر من نوع الرسالة)
  select count(*)                   , count(*) filter (where submission_type = 'complaint'),
         count(*) filter (where submission_type = 'suggestion')
    into v_wk_a, v_wk_a_c, v_wk_a_s
    from public.submissions
    where created_at >= now() - interval '7 days';

  select count(*)                   , count(*) filter (where submission_type = 'complaint'),
         count(*) filter (where submission_type = 'suggestion')
    into v_wk_b, v_wk_b_c, v_wk_b_s
    from public.submissions
    where created_at >= now() - interval '14 days'
      and created_at <  now() - interval '7 days';

  select count(*)                   , count(*) filter (where submission_type = 'complaint'),
         count(*) filter (where submission_type = 'suggestion')
    into v_mo_a, v_mo_a_c, v_mo_a_s
    from public.submissions
    where created_at >= date_trunc('month', now());

  select count(*)                   , count(*) filter (where submission_type = 'complaint'),
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

  -- عند التحديد بمجالات زمنية من الوحدة: مقارنة الفترة المحددة بالفترة السابقة بنفس الطول
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
      'compare_range', jsonb_build_object(
        'a', v_total,
        'b', v_prev));
  end if;

  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) دوال الإدارية المحمية
-- ---------------------------------------------------------------------------

-- تسجيل عملية إدارية في سجل العمليات
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

-- إضافة مدير عبر البريد (المستخدم يجب أن يكون موجوداً في Supabase Auth أولاً)
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

-- إزالة مدير من جدول الصلاحيات (السوبر أدمن فقط، ولا يمكن إزالة نفسه)
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

-- حذف كلية (يُسمح فقط إذا لم تصل إليها أي رسائل — حماية البيانات التاريخية)
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

-- ---------------------------------------------------------------------------
-- 6) صلاحيات تنفيذ الدوال (منع التنفيذ من الزوار لغايات الإدارة)
-- ---------------------------------------------------------------------------
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

-- ملخص نجاح المرحلة
select 'Migration 003 executed successfully — functions and triggers are live.' as status;
