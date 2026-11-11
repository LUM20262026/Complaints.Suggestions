-- ============================================================================
-- Migration 004 — التحديثات الفورية (Realtime) + مساحة تخزين الشعار
-- نظام الشكاوى والمقترحات — جامعة اللوتس
--   * إضافة الجداول على نشر supabase_realtime لتشغيل التحديث الفوري
--   * تجهيز حاوية تخزين عامة لأجل شعار الجامعة (الرفع للإدارة فقط)
--   * آمن للتنفيذ المتكرر
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) حاوية التخزين للشعار (عام القراءة، الكتابة المديرين فقط)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('system', 'system', true)
on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- 2) سياسات التخزين (قراءة عامة، كتابة للمديرين)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3) اشتراك الجداول في التحديثات الفورية
--    * submissions  : تحديث لوحة الإدارة فور ورود رسالة أو تغيير الحالة
--    * app_settings : تحديث واجهة المستخدم العامة فور تغيير الإعدادات
--    * colleges     : تحديث الكليات المعروضة في النموذج العام
-- ---------------------------------------------------------------------------
-- نسخ كاملة للصف عند التحديث (حتى يستقبل اشتراك Realtime البيانات الكاملة)
alter table public.submissions replica identity full;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- على مشاريع Supabase المستضافة يكون نشر supabase_realtime موجوداً تلقائياً
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

-- ملخص نجاح المرحلة
select 'Migration 004 executed successfully — realtime + storage ready.' as status;
