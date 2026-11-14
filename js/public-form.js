/* ============================================================================
   public-form.js — واجهة المستخدم العامة (إرسال شكوى/اقتراح)
   نظام الشكاوى والمقترحات — جامعة اللوتس
   نظرة: 1) تحميل الإعدادات والكليات 2) رسم النموذج حسب الإعدادات
         3) تحقق كامل 4) إرسال آمن عبر دالة RPC 5) تحديثات فورية للإعدادات
============================================================================ */

(function () {
  'use strict';

  // حالة الشاشة
  const state = {
    settings: null,        // الإعدادات المحملة
    colleges: [],          // الكليات المفعلة
    submitting: false,     // منع الإرسال المتكرر أثناء العملية
    startMs: 0,            // زمن بداية ملء النموذج (حماية من الروبوتات)
    online: navigator.onLine,
  };

  const form   = document.getElementById('luForm');
  if (!form) return; // الصفحة العامة فقط

  // عناصر الصفحة
  const el = {
    brandLogo:   document.getElementById('brandLogo'),
    uniName:     document.getElementById('uniName'),
    pageTitle:   document.getElementById('pageTitle'),
    welcomeText: document.getElementById('welcomeText'),
    descText:    document.getElementById('descText'),
    footerText:  document.getElementById('footerText'),
    collegeSel:  document.getElementById('collegeSelect'),
    nameWrap:    document.getElementById('nameWrap'),
    nameInput:   document.getElementById('senderName'),
    nameHint:    document.getElementById('nameHint'),
    msgText:     document.getElementById('messageText'),
    charCounter: document.getElementById('charCounter'),
    typeComplaint: document.getElementById('typeComplaint'),
    typeSuggestion: document.getElementById('typeSuggestion'),
    cardComplaint: document.getElementById('cardComplaint'),
    cardSuggestion: document.getElementById('cardSuggestion'),
    submitBtn:   document.getElementById('submitBtn'),
    formBody:    document.getElementById('formBody'),
    closedBox:   document.getElementById('closedBox'),
    closedMsg:   document.getElementById('closedMsg'),
    initBox:     document.getElementById('initBox'),
    offlineBox:  document.getElementById('offlineBox'),
  };

  const FALLBACK_SETTINGS = {
    university_name: 'جامعة اللوتس',
    page_title: 'منصة الشكاوى والمقترحات',
    welcome_text: 'أهلاً بك — صوتك مسموع ومهم',
    description: 'منصة رسمية لاستقبال شكاوى ومقترحات منتسبي الجامعة بسرية تامة.',
    submit_button_text: 'إرسال الرسالة',
    success_message: 'تم إرسال رسالتك بنجاح إلى إدارة الجامعة',
    footer_text: 'جميع الحقوق محفوظة لجامعة اللوتس',
    logo_url: null,
    primary_color: '#1E7A5B',
    secondary_color: '#7A5FB5',
    label_complaint: 'شكوى',
    label_suggestion: 'اقتراح',
    placeholder_complaint: 'اكتب تفاصيل الشكوى هنا...',
    placeholder_suggestion: 'اكتب مقترحك هنا...',
    is_form_enabled: true,
    allow_complaints: true,
    allow_suggestions: true,
    show_name_field: true,
    name_required: false,
    require_college: true,
    message_min_length: 10,
    message_max_length: 2000,
    default_theme: 'dark',
  };

  // ---------------------------------------------------------------------------
  // 1) تحميل الإعدادات والكليات من قاعدة البيانات
  // ---------------------------------------------------------------------------
  async function loadAll() {
    const [settingsRes, collegesRes] = await Promise.allSettled([
      LU_DB.from('app_settings').select('*').eq('id', 1).single(),
      LU_DB.from('colleges').select('id, name').eq('is_active', true).order('display_order'),
    ]);

    if (settingsRes.status === 'fulfilled' && settingsRes.value.data) {
      state.settings = settingsRes.value.data;
    } else if (
      settingsRes.status === 'fulfilled' &&
      settingsRes.value.error &&
      /Could not find the table|initializ/i.test(settingsRes.value.error.message || '')
    ) {
      state.settings = null; // قاعدة البيانات غير مهيأة
    }

    if (collegesRes.status === 'fulfilled' && !collegesRes.value.error) {
      state.colleges = collegesRes.value.data || [];
    }

    applySettings();
    applyColleges();
    // الصفحة العامة تفتح في الوضع الداكن دائماً (زر التبديل يعمل داخل الجلسة)
    LUTheme.init((state.settings && state.settings.default_theme) || 'dark', true);
  }

  // ---------------------------------------------------------------------------
  // 2) تطبيق الإعدادات على الواجهة (كل النصوص قابلة للتحكم من لوحة الإدارة)
  // ---------------------------------------------------------------------------
  function applySettings() {
    const s = state.settings;

    // قاعدة البيانات غير مهيأة → تنبيه واضح وإيقاف النموذج
    if (!s) {
      el.initBox.classList.remove('d-none');
      el.formBody.classList.add('d-none');
      document.title = 'منصة الشكاوى والمقترحات | جامعة اللوتس';
      return;
    }

    document.title = `${s.page_title} | ${s.university_name}`;
    el.uniName.textContent = s.university_name;
    el.pageTitle.textContent = s.page_title;
    el.welcomeText.textContent = s.welcome_text;
    el.descText.textContent = s.description;
    el.footerText.textContent = s.footer_text;

    // الألوان (الهوية البصرية) — تنفذ فوراً دون تعديل أكواد
    document.documentElement.style.setProperty('--lu-primary', s.primary_color);
    document.documentElement.style.setProperty('--lu-secondary', s.secondary_color);

    // الشعار: صورة عند توفرها وإلا شعار الجامعة الافتراضي
    if (s.logo_url) { el.brandLogo.src = s.logo_url; el.brandLogo.classList.remove('lu-logo-fallback'); }
    else { el.brandLogo.src = 'assets/images/lotus-logo.svg'; el.brandLogo.classList.add('lu-logo-fallback'); }

    // بطاقتا النوع (شكوى / اقتراح) — وأسماء النصوص من الإعدادات
    el.cardComplaint.querySelector('.type-t').textContent = s.label_complaint || 'شكوى';
    el.cardSuggestion.querySelector('.type-t').textContent = s.label_suggestion || 'اقتراح';
    el.cardComplaint.title = s.label_complaint || 'شكوى';
    el.cardSuggestion.title = s.label_suggestion || 'اقتراح';
    // إخفاء بطاقة النوع المعطل من الإعدادات
    el.cardComplaint.classList.toggle('d-none', s.allow_complaints === false);
    el.cardSuggestion.classList.toggle('d-none', s.allow_suggestions === false);

    el.msgText.maxLength = Math.max(s.message_max_length || 2000, 10);
    el.submitBtn.querySelector('span').textContent = s.submit_button_text || 'إرسال الرسالة';

    // حقل الاسم
    el.nameWrap.classList.toggle('d-none', !s.show_name_field);
    el.nameInput.required = !!s.name_required;
    el.nameHint.textContent = s.name_required ? '(إجباري)' : '(اختياري)';

    // نموذج مغلقة؟
    if (!s.is_form_enabled) {
      el.closedMsg.textContent = s.closed_message || 'تم إيقاف استقبال الرسائل مؤقتاً.';
      el.closedBox.classList.remove('d-none');
      el.formBody.classList.add('d-none');
      return;
    }

    el.initBox.classList.add('d-none');
    el.closedBox.classList.add('d-none');
    el.formBody.classList.remove('d-none');

    // لا يوجد أي نوع مسموح حالياً؟
    if (!s.allow_complaints && !s.allow_suggestions) {
      el.closedMsg.textContent = s.closed_message || 'استقبال الرسائل متوقف حالياً.';
      el.closedBox.classList.remove('d-none');
      el.formBody.classList.add('d-none');
    }
  }

  // ---------------------------------------------------------------------------
  // 3) إظهار الكليات في القائمة (مرتبة من قاعدة البيانات)
  // ---------------------------------------------------------------------------
  function applyColleges() {
    const s = state.settings || FALLBACK_SETTINGS;
    const selected = el.collegeSel.value;
    el.collegeSel.innerHTML = '';

    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = s.require_college ? '— اختر الكلية —' : '— غير محدد —';
    el.collegeSel.appendChild(ph);

    state.colleges.forEach((c) => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      el.collegeSel.appendChild(o);
    });

    // استعادة الاختيار إن كان من الأسطر المحملة (تحديثات فورية)
    if (selected && state.colleges.some((c) => String(c.id) === String(selected))) {
      el.collegeSel.value = selected;
    }
  }

  // ---------------------------------------------------------------------------
  // 4) تحديث الحقل الإرشادي وعداد الأحرف حسب نوع الرسالة
  // ---------------------------------------------------------------------------
  function selectedType() {
    if (el.typeComplaint.checked) return 'complaint';
    if (el.typeSuggestion.checked) return 'suggestion';
    return null;
  }

  // تحديث إبراز بطاقة النوع المختارة + الحقل الإرشادي
  function syncTypeCards() {
    el.cardComplaint.classList.toggle('selected', el.typeComplaint.checked);
    el.cardSuggestion.classList.toggle('selected', el.typeSuggestion.checked);
  }

  function refreshPlaceholder() {
    const s = state.settings || FALLBACK_SETTINGS;
    refreshTypeBtnText();
    const t = selectedType();
    if (t === 'complaint')  el.msgText.placeholder = s.placeholder_complaint || 'اكتب تفاصيل الشكوى هنا...';
    if (t === 'suggestion') el.msgText.placeholder = s.placeholder_suggestion || 'اكتب مقترحك هنا...';
    syncTypeCards();
  }

  function refreshTypeBtnText() {
    const s = state.settings || FALLBACK_SETTINGS;
    el.cardComplaint.querySelector('.type-t').textContent = s.label_complaint || 'شكوى';
    el.cardSuggestion.querySelector('.type-t').textContent = s.label_suggestion || 'اقتراح';
  }

  function refreshCounter() {
    const max = el.msgText.maxLength;
    const len = el.msgText.value.length;
    el.charCounter.textContent = `${len} / ${max}`;
    el.charCounter.classList.toggle('text-danger', len > max - 200);
  }

  // ---------------------------------------------------------------------------
  // 5) التحقق المحلي قبل الإرسال
  // ---------------------------------------------------------------------------
  function validate() {
    const s = state.settings || FALLBACK_SETTINGS;
    const t = selectedType();
    if (!t) {
      Swal.fire({ icon: 'warning', direction: 'rtl', title: 'اختيار نوع الرسالة مطلوب', text: 'اختر شكوى أو اقتراح قبل الإرسال.' });
      return null;
    }
    if (t === 'complaint' && !s.allow_complaints)  { luToast('الشكاوى معطلة حالياً', 'warning'); return null; }
    if (t === 'suggestion' && !s.allow_suggestions) { luToast('المقترحات معطلة حالياً', 'warning'); return null; }

    if (s.require_college && !el.collegeSel.value) {
      Swal.fire({ icon: 'warning', direction: 'rtl', title: 'الكلية مطلوبة', text: 'يرجى اختيار الكلية قبل الإرسال.' });
      el.collegeSel.classList.add('is-invalid');
      el.collegeSel.focus();
      return null;
    }

    const msg = el.msgText.value;
    if (!msg.trim()) {
      Swal.fire({ icon: 'warning', direction: 'rtl', title: 'النص فارغ', text: 'لا يمكن إرسال رسالة فارغة — اكتب التفاصيل أولاً.' });
      el.msgText.classList.add('is-invalid');
      el.msgText.focus();
      return null;
    }
    const min = Math.max(s.message_min_length || 10, 1);
    if (msg.trim().length < min) {
      Swal.fire({ icon: 'warning', direction: 'rtl', title: 'النص قصير جداً', text: `الحد الأدنى ${min} حرفاً (حالياً ${msg.trim().length}).` });
      el.msgText.classList.add('is-invalid');
      el.msgText.focus();
      return null;
    }

    let name = null;
    if (s.show_name_field) {
      name = el.nameInput.value.trim() || null;
      if (name && name.length > 120) {
        Swal.fire({ icon: 'warning', direction: 'rtl', title: 'الاسم طويل جداً', text: 'الحجم الأقصى 120 حرفاً.' });
        el.nameInput.classList.add('is-invalid');
        el.nameInput.focus();
        return null;
      }
      if (s.name_required && !name) {
        Swal.fire({ icon: 'warning', direction: 'rtl', title: 'الاسم مطلوب', text: 'حسب سياسة النظام الحالية يجب إدخال الاسم.' });
        el.nameInput.classList.add('is-invalid');
        el.nameInput.focus();
        return null;
      }
    }

    return {
      sender_name: name,
      college_id: el.collegeSel.value ? Number(el.collegeSel.value) : null,
      submission_type: t,
      message: msg,
      website: form.querySelector('input[name="website"]').value, // حقل الفخ (يجب أن يكون فارغاً)
      elapsed_ms: state.startMs ? (Date.now() - state.startMs) : 5000,
      client_token: luClientToken(),
    };
  }

  // ---------------------------------------------------------------------------
  // 6) إرسال الرسالة عبر الدالة الآمنة في قاعدة البيانات
  // ---------------------------------------------------------------------------
  async function submitForm(e) {
    e.preventDefault();

    if (state.submitting) return               // منع الضغط المتكرر
    if (!state.online) { luToast('لا يوجد اتصال بالإنترنت — يتم استعادة الاتصال تلقائياً عند عودته', 'error'); return; }
    if (!state.settings) { luToast('النظام غير جاهز حالياً — يرجى المحاولة لاحقاً.', 'error'); return; }

    const payload = validate();
    if (!payload) return;

    // القفل البصري
    state.submitting = true;
    const oldHtml = el.submitBtn.innerHTML;
    el.submitBtn.disabled = true;
    el.submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm ms-2 me-2"></span><span>جاري الإرسال...</span>';

    try {
      const { data, error } = await LU_DB.rpc('submit_public_message', { payload });

      if (error) throw error;

      // نجاح حقيقي مسجل في قاعدة البيانات
      const s = state.settings || FALLBACK_SETTINGS;
      const ref = (data && data.reference_number) || '';
      await Swal.fire({
        title: 'رسالتك وصلت',
        icon: 'success',
        html: `<div style="margin-top:.4rem">${luEscape(s.success_message || 'تم إرسال رسالتك بنجاح إلى إدارة الجامعة')}</div>` +
          (ref ? `<div dir="ltr" style="margin-top:.7rem;font-size:1.1rem;font-weight:800;letter-spacing:.5px">${luEscape(ref)}</div>` : ''),
        direction: 'rtl',
        confirmButtonText: 'حسناً',
        confirmButtonColor: '#1E7A5B',
        timer: 5000,
        timerProgressBar: true,
        iconColor: '#10B981',
        showClass: { popup: 'animate__animated lu-check-pop' },
      });

      resetForm(true); // تفريغ النموذج فقط بعد نجاح الحفظ
      const trackRef = document.getElementById('trackRef');
      if (trackRef && ref) { trackRef.value = ref; trackSubmission(); }

    } catch (err) {
      console.error('submit_public_message failed', err);
      // **مهاجمة**: الإرسال فشل → رسالة واضحة + الاحتفاظ بالنص الذي كتبه المستخدم
      Swal.fire({
        icon: 'error',
        title: 'الإرسال لم يكتمل',
        text: luErrorMessage(err, 'تعذر إرسال الرسالة — حاول مرة أخرى.'),
        direction: 'rtl',
        confirmButtonText: 'فهمت',
        confirmButtonColor: '#EF4444',
      });
    } finally {
      state.submitting = false;
      el.submitBtn.disabled = false;
      el.submitBtn.innerHTML = oldHtml;
    }
  }

  // ---------------------------------------------------------------------------
  // 7) تفريغ النموذج وإعادته لحالته الأولى
  // ---------------------------------------------------------------------------
  function resetForm(toInitial) {
    form.reset();
    el.msgText.classList.remove('is-invalid');
    el.collegeSel.classList.remove('is-invalid');
    el.nameInput.classList.remove('is-invalid');
    refreshCounter();
    refreshPlaceholder();
    if (toInitial) state.startMs = Date.now(); // عد جديدة من الآن
  }

  // ---------------------------------------------------------------------------
  // 8) مراقبة الاتصال (تعامل مع انقطاع الإنترنت)
  // ---------------------------------------------------------------------------
  window.addEventListener('online', () => {
    state.online = true;
    el.offlineBox.classList.add('d-none');
  });
  window.addEventListener('offline', () => {
    state.online = false;
    el.offlineBox.classList.remove('d-none');
  });

  // ---------------------------------------------------------------------------
  // 9) التحديثات الفورية: تغيير الإعدادات أو الكليات من اللوحة يظهر مباشرة
  // ---------------------------------------------------------------------------
  function subscribeRealtime() {
    LU_DB
      .channel('lu_public_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, async () => {
        try {
          const { data } = await LU_DB.from('app_settings').select('*').eq('id', 1).single();
          if (data) { state.settings = data; applySettings(); refreshPlaceholder(); refreshCounter(); }
        } catch (e) { console.warn('settings realtime', e); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'colleges' }, async () => {
        try {
          const { data, error } = await LU_DB.from('colleges').select('id, name').eq('is_active', true).order('display_order');
          if (!error && data) { state.colleges = data; applyColleges(); }
        } catch (e) { console.warn('colleges realtime', e); }
      })
      .subscribe();
  }

  // ---------------------------------------------------------------------------
  // 10) متابعة رسالة بالرقم المرجعي
  // ---------------------------------------------------------------------------
  async function trackSubmission() {
    const refInput = document.getElementById('trackRef');
    const out = document.getElementById('trackResult');
    if (!refInput || !out) return;
    const ref = (refInput.value || '').trim();
    out.classList.remove('d-none');
    if (!ref) {
      out.innerHTML = '<div class="alert alert-warning mb-0">يرجى إدخال الرقم المرجعي.</div>';
      return;
    }
    out.innerHTML = '<div class="text-muted"><span class="spinner-border spinner-border-sm ms-2"></span> جاري البحث...</div>';
    try {
      const { data, error } = await LU_DB.rpc('track_submission', { p_ref: ref });
      if (error) throw error;
      if (!data || !data.ok) {
        const reason = data && data.reason;
        const msg = reason === 'HIDDEN'
          ? 'لا يمكن عرض حالة هذه الرسالة حالياً.'
          : 'لم يتم العثور على رسالة بهذا الرقم المرجعي.';
        out.innerHTML = `<div class="alert alert-warning mb-0">${msg}</div>`;
        return;
      }
      const st = (window.LU_STATUS && window.LU_STATUS[data.status]) || { label: data.status || '—' };
      const reply = data.admin_reply
        ? `<div class="mt-3"><div class="fw-bold mb-1">الرد:</div><div class="p-3 rounded-3" style="background:var(--lu-soft);white-space:pre-wrap">${luEscape(data.admin_reply)}</div></div>`
        : '<div class="mt-3 text-muted">لا يوجد رد حتى الآن.</div>';
      out.innerHTML = `
        <div class="card border-0" style="background:var(--lu-card-solid,rgba(255,255,255,.06))">
          <div class="card-body">
            <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
              <span class="badge" style="background:var(--lu-primary)">${luEscape(data.reference_number)}</span>
              <span class="badge bg-secondary">${luEscape(st.label)}</span>
            </div>
            <div class="small text-muted">تاريخ الإرسال: ${luDateTime ? luDateTime(data.created_at) : luEscape(data.created_at || '')}</div>
            ${data.college_name ? `<div class="small text-muted">الكلية: ${luEscape(data.college_name)}</div>` : ''}
            ${reply}
          </div>
        </div>`;
    } catch (err) {
      console.error('track', err);
      out.innerHTML = '<div class="alert alert-danger mb-0">تعذر التحقق حالياً. حاول مرة أخرى لاحقاً.</div>';
    }
  }

  const trackBtn = document.getElementById('trackBtn');
  if (trackBtn) trackBtn.addEventListener('click', trackSubmission);
  const trackRef = document.getElementById('trackRef');
  if (trackRef) trackRef.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); trackSubmission(); } });

  // ضمان ظهور الشعار دائماً: لو صورة الشعار المخصصة لم تُحمَّل
  // (رابط قديم أو انقطاع) نرجع فوراً للشعار المحلي
  const LOGO_FALLBACK = 'assets/images/lotus-logo.svg';
  el.brandLogo.addEventListener('error', function () {
    if (el.brandLogo.src.indexOf(LOGO_FALLBACK) === -1) {
      el.brandLogo.src = LOGO_FALLBACK;
      el.brandLogo.classList.add('lu-logo-fallback');
    }
  });

  // ---------------------------------------------------------------------------
  // 11) الأحداث
  // ---------------------------------------------------------------------------
  form.addEventListener('submit', submitForm);
  el.typeComplaint.addEventListener('change', refreshPlaceholder);
  el.typeSuggestion.addEventListener('change', refreshPlaceholder);  el.msgText.addEventListener('input', refreshCounter);
  el.msgText.addEventListener('input', () => el.msgText.classList.remove('is-invalid'), { once: true });
  el.collegeSel.addEventListener('change', () => el.collegeSel.classList.remove('is-invalid'), { once: true });
  el.nameInput.addEventListener('input', () => el.nameInput.classList.remove('is-invalid'), { once: true });

  // بدء عد زمن الملء من أول تفاعل (يد أو ماوس)
  const startTimer = () => { if (!state.startMs) state.startMs = Date.now(); };
  ['focus', 'click', 'keydown', 'touchstart'].forEach((evt) =>
    form.addEventListener(evt, startTimer, { once: false, passive: true })
  );
  state.startMs = Date.now(); // تحفظي احتياطي للصور بلا تفاعل

  // ---------------------------------------------------------------------------
  // التشغيل
  // ---------------------------------------------------------------------------
  refreshCounter();
  loadAll().then(subscribeRealtime).catch((e) => {
    console.error('init failed', e);
    el.initBox.classList.remove('d-none');
    el.formBody.classList.add('d-none');
  });
})();
