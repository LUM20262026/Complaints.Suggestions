/* ============================================================================
   settings.js — التحكم الكامل في واجهة المستخدم من لوحة الإدارة
   نظام الشكاوى والمقترحات — جامعة اللوتس
   كل تعديل هنا يظهر تلقائياً في الصفحة العامة (لا تعديل أي ملفات)
============================================================================ */

window.LUSet = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let inited = false;

  // ---------------------------------------------------------------------------
  // تحميل الإعدادات داخل حقول النماذج
  // ---------------------------------------------------------------------------
  async function load() {
    try {
      const { data: s, error } = await LU_DB.from('app_settings').select('*').eq('id', 1).single();
      if (error || !s) throw error || 'NO_ROW';

      window.LUSettingsCache = s; // مخزن مشترك للملصقات ضمن اللوحة

      // تبويب المحتوى
      $('sUnivName').value = s.university_name || '';
      $('sPageTitle').value = s.page_title || '';
      $('sWelcome').value = s.welcome_text || '';
      $('sDesc').value = s.description || '';
      $('sSubmitText').value = s.submit_button_text || '';
      $('sSuccessMsg').value = s.success_message || '';
      $('sFooter').value = s.footer_text || '';
      $('sLabelC').value = s.label_complaint || '';
      $('sLabelS').value = s.label_suggestion || '';
      $('sPhC').value = s.placeholder_complaint || '';
      $('sPhS').value = s.placeholder_suggestion || '';

      // الشعار
      $('sLogoPrev').src = s.logo_url || 'assets/images/lotus-logo.svg';

      // الألوان
      syncColorPickers(s.primary_color || '#1E7A5B', s.secondary_color || '#7A5FB5');

      // تبويب النموذج
      $('sFormEnabled').checked = !!s.is_form_enabled;
      $('sAllowC').checked = !!s.allow_complaints;
      $('sAllowS').checked = !!s.allow_suggestions;
      $('sShowName').checked = !!s.show_name_field;
      $('sNameRequired').checked = !!s.name_required;
      $('sRequireCollege').checked = !!s.require_college;
      $('sMinLen').value = s.message_min_length ?? 10;
      $('sMaxLen').value = s.message_max_length ?? 2000;
      $('sClosedMsg').value = s.closed_message || '';

      // تبويب التصميم
      $('sDefaultTheme').value = s.default_theme || 'light';
    } catch (err) {
      console.error('settings load', err);
      luToast(luErrorMessage(err, 'تعذر تحميل إعدادات النظام'), 'error');
    }
  }

  function syncColorPickers(p, s) {
    $('sColorPrimary').value = /^#[0-9a-fA-F]{6}$/.test(p) ? p : '#1E7A5B';
    $('sColorPrimaryHex').value = p;
    $('sColorSecondary').value = /^#[0-9a-fA-F]{6}$/.test(s) ? s : '#7A5FB5';
    $('sColorSecondaryHex').value = s;
  }

  // ---------------------------------------------------------------------------
  // حفظ جزئي (أي مجموعة حقول) عبر أيُّ التحديث في قاعدة البيانات
  // ---------------------------------------------------------------------------
  async function savePartial(patch, successMsg, actionName) {
    try {
      const { data, error } = await LU_DB.from('app_settings').update(patch).eq('id', 1).select().single();
      if (error) throw error;
      window.LUSettingsCache = data;
      luToast(successMsg || 'تم الحفظ بنجاح — التغييرات ظاهرة الآن في الصفحة العامة', 'success');

      // سجل العملية في سجل العمليات
      try {
        await LU_DB.rpc('log_admin_action', { p_action: actionName || 'settings_update', p_table_name: 'app_settings', p_record_id: 1, p_details: patch });
      } catch (e) { /* لا يمنع الحفظ */ }

      document.dispatchEvent(new CustomEvent('lu:settings-changed', { detail: data }));
      return data;
    } catch (err) {
      console.error('settings save', err);
      luToast(luErrorMessage(err, 'تعذر حفظ الإعدادات — تحقق من صلاحياتك'), 'error');
      return null;
    }
  }

  function collectContent() {
    const p = $('sColorPrimaryHex').value.trim();
    const s2 = $('sColorSecondaryHex').value.trim();
    const hexOk = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
    return {
      university_name: $('sUnivName').value.trim(),
      page_title: $('sPageTitle').value.trim(),
      welcome_text: $('sWelcome').value.trim(),
      description: $('sDesc').value.trim(),
      submit_button_text: $('sSubmitText').value.trim(),
      success_message: $('sSuccessMsg').value.trim(),
      footer_text: $('sFooter').value.trim(),
      label_complaint: $('sLabelC').value.trim() || 'شكوى',
      label_suggestion: $('sLabelS').value.trim() || 'اقتراح',
      placeholder_complaint: $('sPhC').value.trim() || 'اكتب تفاصيل الشكوى هنا...',
      placeholder_suggestion: $('sPhS').value.trim() || 'اكتب مقترحك هنا...',
      primary_color: hexOk(p) ? p : '#1E7A5B',
      secondary_color: hexOk(s2) ? s2 : '#7A5FB5',
    };
  }

  function collectForm() {
    let min = Number($('sMinLen').value || 0);
    let max = Number($('sMaxLen').value || 2000);
    if (min < 0) min = 0;
    if (max < 10) max = 10;
    if (max <= min) max = Math.max(min + 1, max);
    $('sMinLen').value = min;
    $('sMaxLen').value = max;
    return {
      is_form_enabled: $('sFormEnabled').checked,
      allow_complaints: $('sAllowC').checked,
      allow_suggestions: $('sAllowS').checked,
      show_name_field: $('sShowName').checked,
      name_required: $('sNameRequired').checked,
      require_college: $('sRequireCollege').checked,
      message_min_length: min,
      message_max_length: max,
      closed_message: $('sClosedMsg').value.trim() || 'تم إيقاف استقبال الرسائل مؤقتاً. يرجى المحاولة لاحقاً.',
    };
  }

  // ---------------------------------------------------------------------------
  // رفع شعار الجامعة إلى تخزين Supabase (حاوية system — مفتوحة للإدارة فقط)
  // ---------------------------------------------------------------------------
  async function uploadLogo(file) {
    if (!file) return;
    // قوائم مسموحة صارمة: صور فقط، وبمحتوى محدَّد مسبقاً (منع رفع HTML/SVG خبيث)
    const ALLOWED = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    const ext = ALLOWED[file.type];
    if (!ext) {
      luToast('صيغة الشعار غير مدعومة — استخدم PNG أو JPG أو WEBP', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) { luToast('حجم الشعار أكبر من 2MB', 'error'); return; }
    if (file.size === 0) { luToast('الملف فارغ', 'error'); return; }
    luToast('جارٍ رفع الشعار...', 'info');
    try {
      const path = `logo/logo-${Date.now()}-1.${ext}`;
      const { error } = await LU_DB.storage.from('system').upload(path, file, {
        upsert: false,
        contentType: ALLOWED[file.type],   // نوع محتوى ثابت من القائمة وليس من الملف
        cacheControl: '3600',
      });
      if (error) throw error;
      const { data } = LU_DB.storage.from('system').getPublicUrl(path);
      const saved = await savePartial({ logo_url: data.publicUrl }, 'تم رفع الشعار وتطبيقه على الصفحة العامة', 'logo_upload');
      if (saved) $('sLogoPrev').src = saved.logo_url || 'assets/images/lotus-logo.svg';
    } catch (err) {
      console.error('logo upload', err);
      luToast(luErrorMessage(err, 'تعذر رفع الشعار — تحقق من صلاحياتك أو حجم الملف'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // الأحداث
  // ---------------------------------------------------------------------------
  function init() {
    if (inited) return;
    inited = true;

    // مزامنة منتقيات اللون مع الحقول النصية
    $('sColorPrimary').addEventListener('input', () => { $('sColorPrimaryHex').value = $('sColorPrimary').value; });
    $('sColorSecondary').addEventListener('input', () => { $('sColorSecondaryHex').value = $('sColorSecondary').value; });
    $('sColorPrimaryHex').addEventListener('change', () => {
      if (/^#[0-9a-fA-F]{6}$/.test($('sColorPrimaryHex').value)) $('sColorPrimary').value = $('sColorPrimaryHex').value;
    });
    $('sColorSecondaryHex').addEventListener('change', () => {
      if (/^#[0-9a-fA-F]{6}$/.test($('sColorSecondaryHex').value)) $('sColorSecondary').value = $('sColorSecondaryHex').value;
    });

    $('saveContent').addEventListener('click', () => savePartial(collectContent(), 'تم حفظ إعدادات المحتوى', 'settings_content'));
    $('saveForm').addEventListener('click', () => savePartial(collectForm(), 'تم حفظ إعدادات النموذج', 'settings_form'));
    $('saveDesign').addEventListener('click', () => savePartial({ default_theme: $('sDefaultTheme').value }, 'تم حفظ إعدادات التصميم', 'settings_design'));

    // الشعار
    $('sLogoFile').addEventListener('change', (e) => { if (e.target.files[0]) uploadLogo(e.target.files[0]); e.target.value = ''; });
    $('sLogoClear').addEventListener('click', async () => {
      if (!await luConfirm({ title: 'إزالة الشعار المخصص؟', text: 'سيعود الشعار الافتراضي في الصفحة العامة.' })) return;
      await savePartial({ logo_url: null }, 'تمت الإزالة وإعادة الشعار الافتراضي', 'logo_reset');
      $('sLogoPrev').src = 'assets/images/lotus-logo.svg';
    });

    // كلمة المرور (زرار الحفظ مربوط في admin.js — رابط واحد فقط لتفادي التنفيذ المزدوج)
    $('openPwModal').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance($('pwModal')).show());

    // تحديث فوري عند تغيير الإعدادات من جهاز آخر
    document.addEventListener('lu:settings-changed', (e) => {
      if (e.detail && e.detail.default_theme) { /* متاح للتلميحات */ }
    });
  }

  return { init, load };
})();
