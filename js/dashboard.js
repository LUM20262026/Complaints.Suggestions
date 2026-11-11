/* ============================================================================
   dashboard.js — لوحة الإحصائيات والرسوم البيانية (Chart.js)
   نظام الشكاوى والمقترحات — جامعة اللوتس
   تتحدث كل الرسوم بطاقة إحصائية يعيد حسابها من قاعدة البيانات عبر RPC
============================================================================ */

window.LUDash = (function () {
  'use strict';

  let inited = false;
  let filters = {};               // نطاق الزمن الحالي (all/7/30/month)
  let trendMode = 'day';          // نمط الرسم الزمني (أيام/شهور)
  let charts = {};                // كائنات الرسم الحية
  let refreshTimer = null;
  let lastRes = null;             // آخر نتيجة إحصائيات (لإعادة الرسم عند تبديل الثيم)

  const KPI_COLORS = {
    total: '#1E7A5B', complaints: '#EF4444', suggestions: '#3B82F6',
    new: '#3B82F6', review: '#F59E0B', replied: '#8B5CF6', resolved: '#10B981',
  };

  // لوحة ألوان الرسوم متسقة مع الثيم الحالي
  function baseColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      primary: cs.getPropertyValue('--lu-primary').trim() || '#1E7A5B',
      secondary: cs.getPropertyValue('--lu-secondary').trim() || '#7A5FB5',
      text: cs.getPropertyValue('--lu-text').trim() || '#16233A',
      muted: cs.getPropertyValue('--lu-text-muted').trim() || '#5A6B85',
      border: cs.getPropertyValue('--lu-border').trim() || 'rgba(0,0,0,.1)',
      danger: '#EF4444', warn: '#F59E0B', info: '#3B82F6', success: '#10B981',
      purple: '#8B5CF6', gray: '#64748B', orange: '#F97316',
    };
  }

  function labels() {
    const st = (window.LUSettingsCache || {});
    return {
      complaint: st.label_complaint || LU_TYPES.complaint.label,
      suggestion: st.label_suggestion || LU_TYPES.suggestion.label,
    };
  }

  // إعدادات عامة للرسم (خط عربي + اتجاه RTL)
  function chartDefaults(text, muted) {
    Chart.defaults.font.family = "'Cairo', Tahoma, sans-serif";
    Chart.defaults.color = text;
    Chart.defaults.borderColor = muted || 'rgba(0,0,0,.1)';
  }

  function destroyCharts() {
    Object.values(charts).forEach((c) => { try { c.destroy(); } catch (e) {} });
    charts = {};
  }

  // بناء كل الرسوم من بيانات JSON المرسلة من قاعدة البيانات
  function renderCharts(res) {
    const c = baseColors();
    chartDefaults(c.text, c.muted);
    destroyCharts();
    const t = labels();

    const emptyWrap = (el, isEmpty) => {
      const box = el.parentElement;
      let note = box.querySelector('.lu-chart-empty');
      if (isEmpty && !note) {
        note = document.createElement('div');
        note.className = 'lu-chart-empty';
        note.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;font-weight:700;color:' + c.muted + ';font-size:.86rem';
        note.textContent = 'لا توجد بيانات مطابقة للفلاتر الحالية';
        box.appendChild(note);
      } else if (!isEmpty && note) note.remove();
    };

    // 1) الشكاوى مقابل المقترحات (دائري)
    const e1 = document.getElementById('typeChart');
    const d1 = [ Number(res.complaints || 0), Number(res.suggestions || 0) ];
    emptyWrap(e1, d1[0] + d1[1] === 0);
    charts.type = new Chart(e1, {
      type: 'doughnut',
      data: {
        labels: [t.complaint, t.suggestion],
        datasets: [{ data: d1, backgroundColor: [c.danger, c.info], borderWidth: 2, borderColor: c.primary === '#1E7A5B' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.2)' }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { weight: '700' } } } },
      },
    });

    // 2) حسب الكلية (أفقي)
    const e2 = document.getElementById('collegeChart');
    const bc2 = res.by_college || [];
    const top2 = bc2.slice(0, 8);
    emptyWrap(e2, top2.length === 0);
    charts.college = new Chart(e2, {
      type: 'bar',
      data: {
        labels: top2.map((x) => x.name),
        datasets: [{ label: 'عدد الرسائل', data: top2.map((x) => Number(x.count)), backgroundColor: c.primary, borderRadius: 8, maxBarThickness: 26 }],
      },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: c.border }, ticks: { precision: 0 } },
          y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } },
        },
      },
    });

    // 3) الحالات (دائري) — status_review من RPC تجمع in_review + in_progress
    const e3 = document.getElementById('statusChart');
    const st3 = [
      { k: 'new',      v: res.status_new,      c: c.info,   label: (LU_STATUS.new && LU_STATUS.new.label) || 'جديدة' },
      { k: 'review',   v: res.status_review,   c: c.warn,   label: 'قيد المراجعة' },
      { k: 'replied',  v: res.status_replied,  c: c.purple, label: (LU_STATUS.replied && LU_STATUS.replied.label) || 'تم الرد' },
      { k: 'resolved', v: res.status_resolved, c: c.success,label: (LU_STATUS.resolved && LU_STATUS.resolved.label) || 'تم الحل' },
      { k: 'rejected', v: res.status_rejected, c: c.danger, label: (LU_STATUS.rejected && LU_STATUS.rejected.label) || 'مرفوضة' },
      { k: 'archived', v: res.status_archived, c: c.gray,   label: (LU_STATUS.archived && LU_STATUS.archived.label) || 'مؤرشفة' },
    ].filter((x) => Number(x.v) > 0);
    emptyWrap(e3, st3.length === 0);
    charts.status = new Chart(e3, {
      type: 'doughnut',
      data: {
        labels: st3.map((x) => x.label),
        datasets: [{ data: st3.map((x) => Number(x.v)), backgroundColor: st3.map((x) => x.c), borderWidth: 2 }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { weight: '700' } } } } },
    });

    // 4) التطور الزمني (أيام/شهور)
    const e4 = document.getElementById('trendChart');
    const series = trendMode === 'day' ? (res.by_day || []) : (res.by_month || []);
    const lbl = series.map((x) => trendMode === 'day' ? (x.date || '').slice(5) : (x.month || ''));
    emptyWrap(e4, lbl.length === 0);
    charts.trend = new Chart(e4, {
      type: 'line',
      data: {
        labels: lbl,
        datasets: [
          { label: t.complaint, data: series.map((x) => Number(x.complaints)), borderColor: c.danger, backgroundColor: c.danger, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
          { label: t.suggestion, data: series.map((x) => Number(x.suggestions)), borderColor: c.info, backgroundColor: c.info, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { font: { weight: '700' } } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: c.border } }, x: { grid: { display: false } } },
      },
    });

    // 5) مقارنة الفترات (مجمّع)
    const e5 = document.getElementById('compareChart');
    const cmp = res.compare || {};
    const wk = cmp.week || { a: {}, b: {} };
    const mo = cmp.month || { a: {}, b: {} };
    emptyWrap(e5, (Number(wk.a.total) + Number(wk.b.total) + Number(mo.a.total) + Number(mo.b.total)) === 0);
    charts.compare = new Chart(e5, {
      type: 'bar',
      data: {
        labels: ['الأسبوع الحالي', 'الأسبوع السابق', 'الشهر الحالي', 'الشهر السابق'],
        datasets: [
          { label: t.complaint, data: [wk.a.complaints, wk.b.complaints, mo.a.complaints, mo.b.complaints], backgroundColor: c.danger, borderRadius: 7 },
          { label: t.suggestion, data: [wk.a.suggestions, wk.b.suggestions, mo.a.suggestions, mo.b.suggestions], backgroundColor: c.info, borderRadius: 7 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { weight: '700' } } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: c.border } }, x: { grid: { display: false } } },
      },
    });
  }

  // تحديث بطاقات KPI
  function renderKpis(res) {
    document.getElementById('kpiTotal').textContent = res.total || 0;
    document.getElementById('kpiComplaints').textContent = res.complaints || 0;
    document.getElementById('kpiSuggestions').textContent = res.suggestions || 0;
    document.getElementById('kpiNew').textContent = res.status_new || 0;
    document.getElementById('kpiReview').textContent = res.status_review || 0;
    document.getElementById('kpiReplied').textContent = res.status_replied || 0;
    document.getElementById('kpiResolved').textContent = res.status_resolved || 0;
  }

  // استدعاء الإحصائيات من قاعدة البيانات (فقالت الفلاتر الزمنية)
  async function refresh() {
    const loading = document.getElementById('dashLoading');
    const body = document.getElementById('dashBody');
    loading.classList.remove('d-none');
    body.classList.add('d-none');

    try {
      const payload = {};
      if (filters.range === '7')  payload.date_from = new Date(Date.now() - 7 * 864e5).toISOString();
      if (filters.range === '30') payload.date_from = new Date(Date.now() - 30 * 864e5).toISOString();
      if (filters.range === 'month') {
        const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
        payload.date_from = d.toISOString();
      }

      const { data, error } = await LU_DB.rpc('get_dashboard_stats', { filters: payload });
      if (error) throw error;

      renderKpis(data);
      renderCharts(data);
      lastRes = data;
      body.classList.remove('d-none');
    } catch (err) {
      console.error('dashboard stats', err);
      loading.classList.add('d-none');
      luToast(luErrorMessage(err, 'تعذر تحميل الإحصائيات'), 'error');
    } finally {
      loading.classList.add('d-none');
    }
  }

  // تهيئة الأحداث (مرة واحدة)
  function init() {
    if (inited) return;
    inited = true;

    // شرائح نطاق الزمن
    document.getElementById('rangeChips').addEventListener('click', (e) => {
      const b = e.target.closest('.lu-chip'); if (!b) return;
      document.querySelectorAll('#rangeChips .lu-chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      filters.range = b.dataset.range;
      refresh();
    });

    // نمط الرسم الزمني
    document.getElementById('trendChips').addEventListener('click', (e) => {
      const b = e.target.closest('.lu-chip'); if (!b) return;
      document.querySelectorAll('#trendChips .lu-chip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      trendMode = b.dataset.trendmode;
      refresh();
    });

    // الضغط على بطاقة إحصائية → فتح الرسائل المقابلة
    document.getElementById('kpiGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.lu-kpi'); if (!card) return;
      const target = card.dataset.goto;
      if (target) location.hash = '#/' + target;
    });

    // إعادة بناء الألوان عند تبديل الوضع الداكن/النهاري
    document.addEventListener('lu:themechange', () => {
      if (!inited) return;
      if (document.getElementById('sec-dashboard').classList.contains('active') && lastRes) {
        try { renderCharts(lastRes); } catch (e) {}
      }
    });

    // استقبال رسالة جديدة فورياً (Realtime) — تحديث خفيف ومتكرر
    document.addEventListener('lu:new-submission', () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (document.getElementById('sec-dashboard').classList.contains('active')) refresh();
      }, 1200);
    });

    // استقبال تحديث رسالة (تغيير حالات) — إعادة الرسم
    document.addEventListener('lu:submissions-changed', () => {
      if (document.getElementById('sec-dashboard').classList.contains('active')) refresh();
    });
  }

  return { init, refresh };
})();
