/* ============================================================================
   auth.js — إدارة جلسة المدير: دخول/خروج/فحص الصلاحيات
   نظام الشكاوى والمقترحات — جامعة اللوتس
   مصدر الحقيقة للصلاحيات: جدول admin_profiles في قاعدة البيانات (RLS)
============================================================================ */

window.LUAuth = (function () {
  'use strict';

  // الملف التعريفي للمدير الحالي (id / email / role / full_name / is_active)
  let profile = null;

  // هل الحساب يملك الصلاحية لهذه الفئة على الأقل؟
  function hasRoleAt(minRole) {
    if (!profile) return false;
    const rank = { viewer: 1, admin: 2, super_admin: 3 }[profile.role] || 0;
    const need = { viewer: 1, admin: 2, super_admin: 3 }[minRole] || 1;
    return profile.is_active && rank >= need;
  }

  // جلب الملف التعريفي للمستخدم الحالي من قاعدة البيانات
  async function loadProfile(user) {
    if (!user) { profile = null; return null; }
    try {
      const { data, error } = await LU_DB
        .from('admin_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (error || !data || !data.is_active) {
        profile = null;
        return null;
      }
      profile = data;
      return data;
    } catch (e) {
      console.error('loadProfile failed', e);
      profile = null;
      return null;
    }
  }

  // الضمان: جلسة صحيحة + ملف مدير مفعّل
  async function ensureAdmin() {
    try {
      const { data: { user } } = await LU_DB.auth.getUser();
      return user ? await loadProfile(user) : null;
    } catch (e) {
      console.error('ensureAdmin', e);
      return null;
    }
  }

  // تسجيل الدخول
  async function login(email, password) {
    const { data, error } = await LU_DB.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // التأكد من وجود الصلاحية — بدونها نفصله فوراً (omitted accounts لا تدخل)
    const pro = await loadProfile(data.user);
    if (!pro) {
      await LU_DB.auth.signOut();
      throw new Error('AUTH:NOT_ADMIN');
    }
    return pro;
  }

  // تسجيل الخروج
  async function logout() {
    profile = null;
    try { await LU_DB.auth.signOut(); } catch (e) { console.warn(e); }
  }

  // ترجمة أخطاء الدخول إلى العربية
  function loginError(err) {
    const m = err && (err.message || '');
    if ('AUTH:NOT_ADMIN' === m || /AUTH:NOT_ADMIN/.test(m)) {
      return 'هذا الحساب غير مرتبط بصلاحيات مدير — اتصل بالسوبر أدمن.';
    }
    if (/Invalid login credentials/i.test(m)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    if (/Email not confirmed/i.test(m)) return 'البريد غير مؤكد — تواصل مع المسؤول لتفعيل الحساب.';
    if (/signups_not_allowed/i.test(m)) return 'التسجيل معطل في هذا المشروع.';
    if (/(429|rate|too many)/i.test(m)) return 'محاولات كثيرة — انتظر دقيقة ثم أعد المحاولة.';
    return luErrorMessage(err, 'تعذر تسجيل الدخول — حاول مرة أخرى.');
  }

  return {
    ensureAdmin,
    login,
    logout,
    loginError,
    hasRoleAt,
    get profile() { return profile; },
  };
})();
