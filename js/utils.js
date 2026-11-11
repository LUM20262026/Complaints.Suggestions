/* ============================================================================
   utils.js — أدوات مساعدة مشتركة (التنسيق، التضمين الأمني، الحوارات)
   نظام الشكاوى والمقترحات — جامعة اللوتس
============================================================================ */

// ---------------------------------------------------------------------------
// حماية من XSS: تمرير أي نص قادم من المستخدم عبر دالة التهريب قبل عرضه
// ---------------------------------------------------------------------------
window.luEscape = function (text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// ---------------------------------------------------------------------------
// بيانات الحالات والأيقونات والألوان (نفس المخطط المستخدم في قاعدة البيانات)
// ---------------------------------------------------------------------------
window.LU_STATUS = {
  new:         { label: 'جديدة',               color: '#3B82F6', icon: 'bi-envelope-plus-fill' },
  in_review:   { label: 'قيد المراجعة',        color: '#F59E0B', icon: 'bi-eye-fill' },
  in_progress: { label: 'جاري اتخاذ الإجراء',  color: '#F97316', icon: 'bi-gear-fill' },
  replied:     { label: 'تم الرد',             color: '#8B5CF6', icon: 'bi-chat-left-text-fill' },
  resolved:    { label: 'تم الحل',             color: '#10B981', icon: 'bi-check-circle-fill' },
  rejected:    { label: 'مرفوضة',              color: '#EF4444', icon: 'bi-x-circle-fill' },
  archived:    { label: 'مؤرشفة',              color: '#64748B', icon: 'bi-archive-fill' },
};

window.LU_STATUS_KEYS = Object.keys(window.LU_STATUS);

// ملصقات أنواع الرسائل الافتراضية (تُستبدل بنصوص الإعدادات عند توفرها)
window.LU_TYPES = {
  complaint:  { label: 'شكوى',   icon: 'bi-exclamation-octagon-fill', color: '#EF4444' },
  suggestion: { label: 'اقتراح', icon: 'bi-lightbulb-fill',           color: '#3B82F6' },
};

// اسم الكلية الافتراضي للرسائل التي لا كلية لها
window.LU_NO_COLLEGE = 'غير محدد';

// ---------------------------------------------------------------------------
// تنسيق التواريخ بالعربية (ميلادي)
// ---------------------------------------------------------------------------
window.luDateTime = function (ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
};

window.luDate = function (ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(d);
};

// يرجع yyyy-mm-dd وفق التوقيت المحلي (لنواتج التصدير)
window.luDateISO = function (ts) {
  const d = ts ? new Date(ts) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

window.luTimeHHmm = function (ts) {
  const d = ts ? new Date(ts) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ---------------------------------------------------------------------------
// تأخير الاستدعاء (لحقول البحث الحية)
// ---------------------------------------------------------------------------
window.luDebounce = function (fn, wait) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
};

// ---------------------------------------------------------------------------
// توليد معرف فريد للجلسة (بصمة مكافحة السبام)
// ---------------------------------------------------------------------------
window.luClientToken = function () {
  let t = null;
  try { t = localStorage.getItem('lu_anon_client'); } catch (e) {}
  if (!t) {
    t = (crypto.randomUUID ? crypto.randomUUID() :
      'c-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10));
    try { localStorage.setItem('lu_anon_client', t); } catch (e) {}
  }
  return t;
};

// ---------------------------------------------------------------------------
// تأكيد إجراء حساس (SweetAlert2)
// ---------------------------------------------------------------------------
window.luConfirm = async function ({ title = 'هل أنت متأكد؟', text = '', confirmText = 'نعم، متابعة', cancelText = 'إلغاء', icon = 'warning' } = {}) {
  const res = await Swal.fire({
    titleText: String(title),
    text: luEscape(text),
    icon,
    direction: 'rtl',
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    reverseButtons: true,
    confirmButtonColor: '#1E7A5B',
    cancelButtonColor: '#64748B',
  });
  return res.isConfirmed;
};

// تنبيه سريع (Toast) أعلى الشاشة
// ملاحظة أمنية: نستخدم titleText (نص) وليست title (HTML) حتى لا تنفَّذ أي
// بيانات قادمة من المستخدم ككود داخل المتصفح.
window.luToast = function (msg, type = 'info') {
  Swal.fire({
    toast: true,
    position: 'top',
    direction: 'rtl',
    icon: type,
    titleText: String(msg === null || msg === undefined ? '' : msg),
    showConfirmButton: false,
    timer: type === 'error' ? 5000 : 3000,
    timerProgressBar: true,
  });
};
