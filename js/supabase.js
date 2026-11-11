/* ============================================================================
   supabase.js — إعداد الاتصال بمشروع Supabase وتصريف الأخطاء
   نظام الشكاوى والمقترحات — جامعة اللوتس
   ملاحظة أمنية: هذا المفتاح Publishable ومخصص للواجهة الأمامية فقط،
   وهو آمن كون قاعدة البيانات محمية بسياسات RLS من داخل PostgreSQL.
============================================================================ */

// بيانات المشروع (تُدار من مكان واحد)
window.LU_SUPABASE_CONFIG = {
  url: 'https://aplgjyuhnkstxmejqztj.supabase.co',
  publishableKey: 'sb_publishable_BpucLw6koNl2_-Ikbw1h7A_OZ6uaeXQ',
};

// عميل Supabase واحد لنظام ككل (يُستخدم في كل الصفحات والوحدات)
const LU_DB = supabase.createClient(
  window.LU_SUPABASE_CONFIG.url,
  window.LU_SUPABASE_CONFIG.publishableKey,
  {
    auth: {
      persistSession: true,          // تظل الجلسة محفوظة بعد إغلاق الموقع
      storageKey: 'lu_auth_session',
      detectSessionInUrl: false,
    },
    realtime: { params: { eventsPerSecond: 8 } },
  }
);
window.LU_DB = LU_DB;

// ---------------------------------------------------------------------------
// ترجمة أخطاء قاعدة البيانات إلى عبارات عربية واضحة للمستخدم
// ---------------------------------------------------------------------------
window.LU_ERROR_MAP = {
  // أخطاء الإرسال العام (رموز SUBMIT:XXX من دالة submit_public_message)
  'SUBMIT:SPAM':            'تعذر إرسال الطلب. حاول مرة أخرى.',
  'SUBMIT:TOO_FAST':        'تم الإرسال أسرع من المعتاد — انتظر لحظة ثم أعد المحاولة.',
  'SUBMIT:FORM_CLOSED':     'استقبال الرسائل متوقف حالياً. جرب في وقت لاحق.',
  'SUBMIT:TYPE_DISABLED':   'النوع المرسَل غير مفعل حالياً في المنصة.',
  'SUBMIT:BAD_TYPE':        'اختر نوع الرسالة (شكوى أو اقتراح) قبل الإرسال.',
  'SUBMIT:EMPTY':           'لا يمكن إرسال رسالة فارغة — اكتب النص أولاً.',
  'SUBMIT:LENGTH':          'طول النص خارج الحدود المسموحة، يرجى التعديل.',
  'SUBMIT:NAME_TOO_LONG':   'الاسم أطول من الحد المسموح (120 حرفاً).',
  'SUBMIT:NAME_REQUIRED':   'الاسم مطلوب حسب سياسة النظام الحالية.',
  'SUBMIT:COLLEGE_REQUIRED':'يرجى اختيار الكلية قبل الإرسال.',
  'SUBMIT:COLLEGE_INVALID': 'الكلية المختارة غير متاحة حالياً — يرجى تحديث القائمة.',
  'SUBMIT:RATE_LIMITED':    'وصلت الحد الأقصى من الرسائل مؤقتاً، حاول بعد ساعة.',
  'SUBMIT:DUPLICATE':       'تم إرسال نص مطابق قبل قليل من نفس الجهاز.',
  'SUBMIT:OVERLOAD':        'المنصة تمر بحمل مرتفع مؤقتاً، حاول بعد دقيقة.',
  'SUBMIT:NOT_INITIALIZED': 'النظام غير جاهز حالياً — يرجى المحاولة لاحقاً.',
  // أخطاء الصلاحيات
  'STATS:FORBIDDEN':        'لا تملك صلاحية عرض الإحصائيات.',
  'AUDIT:FORBIDDEN':        'لا تملك صلاحية هذا الإجراء الإداري.',
  'ADMINS:FORBIDDEN':       'هذا الإجراء متاح للسوبر أدمن فقط.',
  'ADMINS:USER_NOT_FOUND':  'لم يوجد مستخدم بهذا البريد — تأكد من إنشاء الحساب أولاً.',
  'ADMINS:EMAIL_TAKEN':     ' البريد مربوط بحساب مدير آخر.',
  'ADMINS:BAD_ROLE':        'الدور غير صحيح.',
  'ADMINS:CANNOT_SELF_REMOVE': 'لا يمكنك إزالة حسابك بنفسك.',
  'ADMINS:NOT_FOUND':       'الحساب المطلوب غير موجود.',
  'COLLEGE:FORBIDDEN':      'لا تملك صلاحية إدارة الكليات.',
  'COLLEGE:NOT_FOUND':      'الكلية غير موجودة.',
  'COLLEGE:IN_USE':         'لا يمكن حذف كلية مرتبطة برسائل — استخدم إخفاء بدلاً من الحذف.',
};

// دالة موحدة لاستخراج رسالة عربية من أي خطأ
window.luErrorMessage = function (err, fallback) {
  if (!err) return fallback || 'حدث خطأ غير متوقع';
  const raw = err.message || err.error_description || String(err);
  for (const key in window.LU_ERROR_MAP) {
    if (raw.indexOf(key) !== -1) return window.LU_ERROR_MAP[key];
  }
  // حالات الاتصال/الشبكة (لا نصنّف أي TypeError برمجي كخطأ اتصال)
  if (/Failed to fetch|NetworkError|Network request failed|fetch failed|network|ECONN|ERR_INTERNET/i.test(raw)) {
    return 'تعذر الاتصال بالخادم — تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.';
  }
  // النظام غير مهيأ بعد
  if (/Could not find the table|relation .* does not exist/i.test(raw)) {
    return 'النظام غير جاهز حالياً — يرجى المحاولة لاحقاً.';
  }
  // أي نص تقني آخر لا يُعرض على المستخدم إطلاقاً
  return fallback || 'حدث خطأ غير متوقع — حاول مرة أخرى.';
};
