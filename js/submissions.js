/* ============================================================================
   submissions.js — إدارة الرسائل: الجدول، الفلاتر، التفاصيل، الحالات، الردود،
   الملاحظات الداخلية، الأرشفة، الطباعة، وترقيم الصفحات
   نظام الشكاوى والمقترحات — جامعة اللوتس
   كل عمليات البحث والفرز والتقسيم تُنفذ على مستوى قاعدة البيانات
============================================================================ */

window.LUSub = (function () {
  'use strict';

  // تعريف مشاهدات القائمة الجانبية (كلها تُولّد فلاتر ثابتة إضافتاً بالفلاتر الحرة)
  const VIEW_DEFS = {
    'messages-all':        { title: 'جميع الرسائل',  icon: 'bi-inboxes-fill' },
    'messages-complaints': { title: 'الشكاوى',       icon: 'bi-exclamation-octagon-fill', baseType: 'complaint' },
    'messages-suggestions':{ title: 'المقترحات',     icon: 'bi-lightbulb-fill', baseType: 'suggestion' },
    'messages-new':        { title: 'الرسائل الجديدة', icon: 'bi-envelope-plus-fill', baseStatuses: ['new'] },
    'messages-review':     { title: 'قيد المراجعة',  icon: 'bi-eye-fill', baseStatuses: ['in_review', 'in_progress'] },
    'messages-replied':    { title: 'تم الرد عليها', icon: 'bi-chat-left-text-fill', baseStatuses: ['replied'] },
    'messages-resolved':   { title: 'تم الحل',       icon: 'bi-check-circle-fill', baseStatuses: ['resolved'] },
    'messages-archived':   { title: 'الأرشيف',      icon: 'bi-archive-fill', baseStatuses: ['archived'] },
  };

  const SSTORE = 'lu_msg_state_v1';   // حفظ الفلاتر بين التنقلات (sessionStorage)
  let states = {};
  let currentView = 'messages-all';
  let currentId = null;               // الرسالة المفتوحة في نافذة التفاصيل
  let loading = false;

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // إدارة الحالة لكل شاشة
  // ---------------------------------------------------------------------------
  function defaultState() {
    return { search: '', college: '', type: '', status: '', from: '', to: '', sort: 'desc', page: 1, pageSize: 25 };
  }

  function st() {
    if (!states[currentView]) states[currentView] = defaultState();
    return states[currentView];
  }

  function loadPersist() {
    try { states = JSON.parse(sessionStorage.getItem(SSTORE) || '{}') || {}; }
    catch (e) { states = {}; }
  }

  function persist() {
    try { sessionStorage.setItem(SSTORE, JSON.stringify(states)); } catch (e) {}
  }

  // إفراغ كل البيانات المخزّنة محلياً عند تسجيل الخروج
  // (منع بقاء نصوص الرسائل على جهاز مشترك بعد الخروج)
  function clearSensitiveCache() {
    try { sessionStorage.removeItem(SSTORE); } catch (e) {}
    states = {};
    lastRows = [];
    currentId = null;
    detailRow = null;
  }

  // هل الأعمدة الإضافية متاحة في قاعدة البيانات؟ (يتعرف عليها تلقائياً)
  let trackVisibleOk = null;
  let seenOk = null;
  const COLS_MIN = 'id, reference_number, sender_name, college_id, college_name_snapshot, submission_type, message, status, admin_reply, internal_notes, created_at, updated_at, replied_at, resolved_at, archived_at';
  const COLS_TRACK = COLS_MIN.replace('internal_notes,', 'internal_notes, track_visible,');
  const COLS_SEEN = COLS_MIN.replace('internal_notes,', 'internal_notes, admin_seen_at,');
  const COLS_BOTH = COLS_MIN.replace('internal_notes,', 'internal_notes, track_visible, admin_seen_at,');
  function pickCols() {
    if (trackVisibleOk !== false && seenOk !== false) return COLS_BOTH;
    if (trackVisibleOk !== false) return COLS_TRACK;
    if (seenOk !== false) return COLS_SEEN;
    return COLS_MIN;
  }

  // ---------------------------------------------------------------------------
  // بناء الطلب على قاعدة البيانات (الفلاتر كلها Server-side)
  // ---------------------------------------------------------------------------
  function buildQuery(countMode, rangeOverride) {
    const def = VIEW_DEFS[currentView];
    const s = st();
    const cols = pickCols();
    let q = LU_DB.from('submissions').select(cols, { count: 'exact', head: !!countMode });

    // نوع الرسالة: مقفول في مشاهدات الشكاوى/المقترحات
    const typeVal = def.baseType || s.type;
    if (typeVal) q = q.eq('submission_type', typeVal);

    // الحالة: مقفولة في مشاهدات الحالة، وإلا اختيار حر
    const stats = def.baseStatuses || (s.status ? [s.status] : null);
    if (stats && stats.length) q = q.in('status', stats);

    if (s.college) q = q.eq('college_id', Number(s.college));
    if (s.from) q = q.gte('created_at', new Date(s.from + 'T00:00:00').toISOString());
    if (s.to)   q = q.lte('created_at', new Date(s.to + 'T23:59:59.999').toISOString());

    // البحث النصي: رقم مرجعي / اسم / نص الرسالة — يُنفذ على قاعدة البيانات
    const term = (s.search || '').trim();
    if (term.length >= 2) {
      const safe = term.replace(/[,()\\%*_]/g, ' ').replace(/\s+/g, ' ').trim();
      if (safe) {
        q = q.or(
          `reference_number.ilike.%${safe}%,` +
          `sender_name.ilike.%${safe}%,` +
          `message.ilike.%${safe}%`
        );
      }
    }

    q = q.order('created_at', { ascending: s.sort === 'asc' });

    if (!countMode) {
      if (rangeOverride) {
        q = q.range(rangeOverride[0], rangeOverride[1]);
      } else {
        const p = Math.max(0, (s.page - 1));
        q = q.range(p * s.pageSize, p * s.pageSize + s.pageSize - 1);
      }
    }

    return q;
  }

  // الصفوف المعروضة حالياً (احتياط للتصدير/الطباعة عند تعذّر جلب الكل)
  let lastRows = [];

  // سبب الخطأ بصيغة عربية — لا نعرض أي نص تقني من الخادم على المستخدم
  // (السبب الكامل يُسجَّل في وحدة التحكم عبر console.error للفحص)
  function why(err) {
    if (!err) return '';
    return luErrorMessage(err, 'تعذر إتمام العملية — حاول مرة أخرى.');
  }

  function reportErr(prefix, err) {
    console.error('[LU] ' + prefix, err);
    const r = why(err);
    luToast(prefix + (r ? ' — ' + r : ''), 'error');
  }

  // جلب كل السجلات المطابقة للفلاتر (للتصدير/الطباعة)
  async function fetchAllRows() {
    const all = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      let res;
      try {
        res = await buildQuery(false, [offset, offset + 999]);
      } catch (e) {
        console.error('[LU] buildQuery', e);
        break;
      }
      if (!res) break;
      if (res.error) {
        const m = res.error.message || '';
        console.error('[LU] fetch page error', res.error);
        if (/track_visible/i.test(m) && trackVisibleOk !== false) { trackVisibleOk = false; continue; }
        if (/admin_seen_at/i.test(m) && seenOk !== false) { seenOk = false; continue; }
        throw res.error;
      }
      const data = res.data || [];
      if (data.length) { all = all.concat(data); if (data.length < 1000) break; }
      else break;
    }
    return all;
  }

  // جلب السجلات، وإن تعذّر نرجع إلى الصفوف المعروضة حتى لا يتوقف التصدير
  async function rowsForExport() {
    try {
      const rows = await fetchAllRows();
      return { rows: rows || [], partial: false };
    } catch (e) {
      console.error('[LU] fetchAllRows', e);
      window.__luExportErr = e;
    }
    if (lastRows.length) return { rows: lastRows, partial: true };
    throw (window.__luExportErr || new Error('تعذر جلب السجلات'));
  }

  // ---------------------------------------------------------------------------
  // مكتبة Excel — تُحمَّل عند الحاجة من أكثر من مصدر مع بديل CSV
  // ---------------------------------------------------------------------------
  // مصادر مكتبة Excel — كلها مثبّتة الإصدار ومحمية بصمة تحقق (SRI)
  const XLSX_SOURCES = [
    { src: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
      integrity: 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT' },
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
      integrity: 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw' },
    { src: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
      integrity: 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw' },
  ];

  function loadScriptOnce(item) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = item.src;
      s.async = true;
      if (item.integrity) { s.integrity = item.integrity; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; }
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      s.onload = () => finish(true);
      s.onerror = () => finish(false);
      document.head.appendChild(s);
      setTimeout(() => finish(false), 9000);
    });
  }

  async function ensureXLSX() {
    if (window.XLSX && window.XLSX.utils && window.XLSX.writeFile) return true;
    for (const item of XLSX_SOURCES) {
      try {
        if (await loadScriptOnce(item) && window.XLSX && window.XLSX.utils) return true;
      } catch (e) { /* المصدر التالي */ }
    }
    return !!(window.XLSX && window.XLSX.utils);
  }
  window.luEnsureXLSX = ensureXLSX;

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // تصدير CSV (يفتح في Excel مباشرة) — بديل إن تعذّر تحميل مكتبة Excel
  function exportCsvFallback(header, data, filename) {
    const esc = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const lines = [header.map(esc).join(',')];
    data.forEach((row) => lines.push(row.map(esc).join(',')));
    downloadBlob(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }), filename.replace(/\.xlsx$/, '.csv'));
    luToast('تم تنزيل الملف بصيغة CSV (يفتح في Excel)', 'success');
  }
  window.luExportCsv = exportCsvFallback;
  window.luDownloadBlob = downloadBlob;

  // ---------------------------------------------------------------------------
  // الشارات الملونة
  // ---------------------------------------------------------------------------
  function statusBadge(status) {
    const meta = LU_STATUS[status] || { label: status, color: '#64748B', icon: 'bi-question' };
    return `<span class="lu-badge" style="color:#fff;background:${meta.color}">
      <i class="bi ${meta.icon}"></i> ${luEscape(meta.label)}</span>`;
  }

  function typeBadge(type, collegeLabels) {
    const labels = collegeLabels || (window.LUSettingsCache || {});
    const key = type === 'complaint' ? 'label_complaint' : 'label_suggestion';
    const label = labels[key] || LU_TYPES[type].label;
    const color = type === 'complaint' ? '#EF4444' : '#3B82F6';
    const icon = type === 'complaint' ? 'bi-exclamation-octagon-fill' : 'bi-lightbulb-fill';
    return `<span class="lu-badge" style="color:#fff;background:${color}"><i class="bi ${icon}"></i> ${luEscape(label)}</span>`;
  }

  // ---------------------------------------------------------------------------
  // تحميل القائمة
  // ---------------------------------------------------------------------------
  async function refresh() {
    if (loading) return;
    loading = true;
    const def = VIEW_DEFS[currentView];
    const s = st();
    const isAdminViewer = LUAuth.hasRoleAt('viewer');
    const canManage = LUAuth.hasRoleAt('admin');

    $('pageTitleTop').textContent = def.title;
    $('messagesTitle').innerHTML = `<i class="bi ${def.icon} ms-1" style="color:var(--lu-primary)"></i> ${def.title}`;
    $('viewerNote').classList.toggle('d-none', canManage);
    $('applyFilters').disabled = !isAdminViewer;

    $('messagesLoading').classList.remove('d-none');
    $('messagesWrap').classList.add('d-none');
    $('messagesEmpty').classList.add('d-none');

    try {
      let res = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await buildQuery(false);
        if (!res.error) break;
        const m = res.error.message || '';
        if (/track_visible/i.test(m) && trackVisibleOk !== false) { trackVisibleOk = false; continue; }
        if (/admin_seen_at/i.test(m) && seenOk !== false) { seenOk = false; continue; }
        break;
      }
      const { data, count, error } = res || {};
      if (error) throw error;
      lastRows = data || [];

      const total = count || 0;
      $('resultsCount').textContent = total.toLocaleString('ar-EG');

      const tbody = $('messagesTbody');
      tbody.innerHTML = '';

      if (!data || data.length === 0) {
        $('messagesEmpty').classList.remove('d-none');
      } else {
        // أقواس الكليات من قاعدة البيانات لعرض الاسم بدقة
        data.forEach((r, i) => {
          const serial = (s.page - 1) * s.pageSize + i + 1;
          const replyFlag = r.admin_reply ? '<i class="bi bi-chat-dots text-success ms-1" title="يوجد رد رسمي"></i>' : '';
          const unread = (seenOk !== false && r.admin_seen_at == null);
          tbody.insertAdjacentHTML('beforeend',
            `<tr data-id="${r.id}" class="${unread ? 'lu-unread' : ''}">
              <td><span class="lu-ref">${luEscape(r.reference_number)}</span>${unread ? '<span class="lu-unread-dot" title="غير مقروءة"></span>' : ''}</td>
              <td style="white-space:nowrap">${luDateTime(r.created_at)}</td>
              <td>${r.sender_name ? luEscape(r.sender_name) : '<span class="text-muted">بدون اسم</span>'}</td>
              <td>${luEscape(r.college_name_snapshot || window.LU_NO_COLLEGE)}</td>
              <td>${typeBadge(r.submission_type)}</td>
              <td><span class="lu-cell-msg" title="${luEscape(r.message)}">${luEscape(r.message)}</span>${replyFlag}</td>
              <td>${statusBadge(r.status)}</td>
              <td class="text-center" style="white-space:nowrap">
                <button class="lu-act" data-act="view" data-id="${r.id}" title="عرض التفاصيل"><i class="bi bi-eye-fill"></i></button>
                ${canManage ? `<button class="lu-act" data-act="archive" data-id="${r.id}" title="${r.status === 'archived' ? 'إزالة الأرشفة' : 'أرشفة'}"><i class="bi bi-archive-fill"></i></button>` : ''}
                ${canManage ? `<button class="lu-act text-danger" data-act="delete" data-id="${r.id}" title="حذف نهائي"><i class="bi bi-trash3-fill"></i></button>` : ''}
              </td>
            </tr>`);
        });

        renderPagination(total, s.page, s.pageSize, 'pagination', (p) => {
          s.page = p; persist(); refresh();
        });
      }

      // معلومات الصفحة
      const from = total === 0 ? 0 : (s.page - 1) * s.pageSize + 1;
      const to = total === 0 ? 0 : Math.min(total, s.page * s.pageSize);
      $('pagesInfo') && ($('pagesInfo').textContent = '');
      $('resultsCount').textContent = `${from} - ${to} من ${total.toLocaleString('ar-EG')}`;

      $('messagesWrap').classList.remove('d-none');
    } catch (err) {
      console.error('submissions load', err);
      $('messagesEmpty').classList.remove('d-none');
      luToast(luErrorMessage(err, 'تعذر تحميل الرسائل'), 'error');
    } finally {
      loading = false;
      $('messagesLoading').classList.add('d-none');
    }
  }

  // ---------------------------------------------------------------------------
  // ترقيم صفحات متزلز
  // ---------------------------------------------------------------------------
  function renderPagination(total, page, size, ulId, goto) {
    const ul = $(ulId);
    ul.innerHTML = '';
    const pages = Math.max(1, Math.ceil(total / size));
    if (pages <= 1) return;

    // نافذة أرقام متزلز حول الصفحة الحالية
    let start = Math.max(1, page - 2);
    let end = Math.min(pages, start + 4);
    start = Math.max(1, end - 4);

    const li = (label, p, active, disabled, aria) =>
      `<li class="page-item ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}">
         <button class="page-link" ${aria ? 'aria-label="' + aria + '"' : ''} ${p ? 'data-page="' + p + '"' : ''}>${label}</button>
       </li>`;

    ul.insertAdjacentHTML('beforeend', li('<i class="bi bi-chevron-double-right"></i>', page > 1 ? 1 : null, false, page <= 1, 'الأولى'));
    ul.insertAdjacentHTML('beforeend', li('<i class="bi bi-chevron-right"></i>', page > 1 ? page - 1 : null, false, page <= 1, 'السابقة'));
    for (let p = start; p <= end; p++) ul.insertAdjacentHTML('beforeend', li(p, p, p === page, false));
    ul.insertAdjacentHTML('beforeend', li('<i class="bi bi-chevron-left"></i>', page < pages ? page + 1 : null, false, page >= pages, 'التالية'));
    ul.insertAdjacentHTML('beforeend', li('<i class="bi bi-chevron-double-left"></i>', page < pages ? pages : null, false, page >= pages, 'الأخيرة'));

    ul.querySelectorAll('button[data-page]').forEach((b) =>
      b.addEventListener('click', () => goto(Number(b.dataset.page)))
    );
  }

  // ---------------------------------------------------------------------------
  // مزامنة عناصر الفلتر مع الحالة (مع قفل الحقول الجامدة بكل شاشة)
  // ---------------------------------------------------------------------------
  function syncFilterInputs(colleges) {
    const def = VIEW_DEFS[currentView];
    const s = st();

    $('fSearch').value = s.search || '';
    $('fFrom').value = s.from || '';
    $('fTo').value = s.to || '';
    $('fSort').value = s.sort || 'desc';
    $('pageSize').value = String(s.pageSize || 25);

    // الكليات
    $('fCollege').innerHTML = '<option value="">الكل</option>' +
      (colleges || []).map((c) => `<option value="${c.id}">${luEscape(c.name)}</option>`).join('');
    $('fCollege').value = s.college || '';

    // شرائح الحالة المتاحة (كل الحالات)
    $('fStatus').innerHTML = '<option value="">الكل</option>' +
      Object.entries(LU_STATUS).map(([k, v]) =>
        `<option value="${k}">${v.label}</option>`).join('');
    $('fStatus').value = (!def.baseStatuses) ? (s.status || '') : '';

    // تعتمد الأنواع على مخزن أنواع الإعدادات
    const labels = window.LUSettingsCache || {};
    $('fType').innerHTML = `
      <option value="">الكل</option>
      <option value="complaint">${luEscape(labels.label_complaint || LU_TYPES.complaint.label)}</option>
      <option value="suggestion">${luEscape(labels.label_suggestion || LU_TYPES.suggestion.label)}</option>`;
    $('fType').value = (!def.baseType) ? (s.type || '') : '';

    // قفل الحقول المتخصصة بالشاشة
    $('fType').disabled = !!def.baseType;
    $('fStatus').disabled = !!def.baseStatuses;
  }

  // تغيير وجهة القائمة (بند السايدبور)
  function setView(view) {
    currentView = view;
    syncFilterInputs(window.LUCollegesCache || []);
    refresh();
  }

  // ---------------------------------------------------------------------------
  // فتح نافذة التفاصيل + سجل التغييرات
  // ---------------------------------------------------------------------------
  async function open(id) {
    currentId = id;
    // تمييز الصف المفتوح في القائمة
    document.querySelectorAll('#messagesTbody tr.lu-opened').forEach((r) => r.classList.remove('lu-opened'));
    const openedRow = document.querySelector(`#messagesTbody tr[data-id="${id}"]`);
    if (openedRow) openedRow.classList.add('lu-opened');
    const modalEl = $('detailModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    const canManage = LUAuth.hasRoleAt('admin');

    await loadDetail();

    // التاريخ الفعلي لسجل التغييرات من قاعدة البيانات
    try {
      const { data: hist, error } = await LU_DB.from('submission_history')
        .select('id, admin_id, old_status, new_status, action, details, created_at')
        .eq('submission_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      const tb = $('dHistoryTbody');
      if (error || !hist || hist.length === 0) {
        tb.innerHTML = '<tr><td colspan="3" class="text-muted small">لا يوجد سجل بعد</td></tr>';
      } else {
        tb.innerHTML = hist.map((h) => {
          const actions = {
            created: { label: 'إنشاء الرسالة', icon: 'bi-plus-circle' },
            status_change: { label: 'تغيير الحالة', icon: 'bi-arrow-repeat' },
            admin_reply: { label: 'رد إداري', icon: 'bi-chat-heart' },
            internal_notes: { label: 'ملاحظات داخلية', icon: 'bi-sticky' },
          }[h.action] || { label: h.action, icon: 'bi-dot' };
          const det = h.action === 'status_change' && h.details
            ? `${LU_STATUS[h.details.old]?.label || h.details.old} → ${LU_STATUS[h.details.new]?.label || h.details.new}`
            : '';
          return `<tr>
            <td class="small text-nowrap">${luDateTime(h.created_at)}</td>
            <td class="small text-nowrap"><i class="bi ${actions.icon} ms-1"></i>${actions.label}</td>
            <td class="small">${luEscape(det)}</td>
          </tr>`;
        }).join('');
      }
    } catch (e) {
      $('dHistoryTbody').innerHTML = '<tr><td colspan="3" class="text-danger small">تعذر تحميل السجل</td></tr>';
    }
  }

  // تحميل حقول التفاصيل
  async function loadDetail() {
    try {
      const { data: r, error } = await LU_DB.from('submissions').select('*').eq('id', currentId).maybeSingle();
      if (error || !r) throw error || new Error('NOT_FOUND');

      const canManage = LUAuth.hasRoleAt('admin');

      $('dRef').textContent = r.reference_number;
      $('dTypeBadge').innerHTML = typeBadge(r.submission_type);
      $('dStatusBadge').innerHTML = statusBadge(r.status);

      // علامة القراءة + تسجيل الفتح
      const seenBadge = document.getElementById('dSeenBadge');
      const isUnread = (seenOk !== false && r.admin_seen_at == null);
      if (seenBadge) {
        seenBadge.innerHTML = isUnread
          ? '<span class="badge" style="background:var(--lu-danger)">غير مقروءة</span>'
          : '<span class="badge" style="background:var(--lu-success)">مقروءة</span>';
      }
      if (isUnread) {
        const tr = document.querySelector(`#messagesTbody tr[data-id="${currentId}"]`);
        if (tr) tr.classList.remove('lu-unread');
        const dot = tr && tr.querySelector('.lu-unread-dot'); if (dot) dot.remove();
        LU_DB.from('submissions').update({ admin_seen_at: new Date().toISOString() }).eq('id', currentId)
          .then(() => {}).catch(() => {});
      }
      $('dDate').textContent = luDateTime(r.created_at);
      $('dUpdated').textContent = luDateTime(r.updated_at);
      $('dSender').textContent = r.sender_name || 'بدون اسم (رسالة سرية)';
      $('dCollege').textContent = r.college_name_snapshot || window.LU_NO_COLLEGE;
      $('dTypeT').textContent = r.submission_type === 'complaint'
        ? ((window.LUSettingsCache || {}).label_complaint || 'شكوى')
        : ((window.LUSettingsCache || {}).label_suggestion || 'اقتراح');
      $('dMessage').textContent = r.message;

      // أزرار الإدارة للإطباق بالمقياس
      $('dAdminArea').classList.toggle('d-none', !canManage);
      $('dPrint').classList.remove('d-none');
      $('dArchive').classList.toggle('d-none', !canManage);
      const dDel = document.getElementById('dDelete');
      if (dDel) dDel.classList.toggle('d-none', !canManage);

      $('dArchive').innerHTML = r.status === 'archived'
        ? '<i class="bi bi-box-arrow-up ms-1"></i> إزالة الأرشفة'
        : '<i class="bi bi-archive-fill ms-1"></i> أرشفة الرسالة';

      if (canManage) {
        $('dStatusSel').innerHTML = Object.entries(LU_STATUS)
          .map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v.label}</option>`).join('');
        $('dReply').value = r.admin_reply || '';
        $('dNotes').value = r.internal_notes || '';
        $('dSaveReply').dataset.status = r.status;
        const tv = document.getElementById('dTrackVisible');
        if (tv) { tv.checked = (r.track_visible !== false); tv.closest('.form-switch').style.display = (trackVisibleOk === false) ? 'none' : ''; }
      }
      detailRow = r;
    } catch (err) {
      luToast(luErrorMessage(err, 'تعذر تحميل تفاصيل الرسالة'), 'error');
    }
  }

  let detailRow = null;

  // ---------------------------------------------------------------------------
  // الإجراءات: تغيير الحالة / الرد / الملاحظات / أرشفة
  // ---------------------------------------------------------------------------
  async function changeStatus(newStatus) {
    if (!detailRow || !newStatus || detailRow.status === newStatus) return;
    try {
      const { error } = await LU_DB.from('submissions')
        .update({ status: newStatus })
        .eq('id', detailRow.id);
      if (error) throw error;
      luToast('تم تحديث الحالة إلى «' + (LU_STATUS[newStatus] || {}).label + '»', 'success');
      await loadDetail();
      refresh();
      document.dispatchEvent(new CustomEvent('lu:submissions-changed'));
    } catch (err) {
      luToast(luErrorMessage(err, 'تعذر تغيير الحالة'), 'error');
      await loadDetail();
    }
  }

  async function saveReply() {
    if (!detailRow) return;
    const text = $('dReply').value.trim();
    const auto = $('dAutoReply').checked && ['new', 'in_review', 'in_progress'].includes(detailRow.status);

    try {
      const patch = { admin_reply: text.length ? text : null };
      if (auto && text.length) patch.status = 'replied';
      const { error } = await LU_DB.from('submissions').update(patch).eq('id', detailRow.id);
      if (error) throw error;
      if (auto && text.length) {
        luToast('تم حفظ الرد — انتقلت الحالة إلى «تم الرد»', 'success');
      } else {
        luToast('تم حفظ الرد الرسمي', 'success');
      }
      await loadDetail();
      refresh();
      document.dispatchEvent(new CustomEvent('lu:submissions-changed'));
    } catch (err) {
      luToast(luErrorMessage(err, 'تعذر حفظ الرد'), 'error');
    }
  }

  function luConfirmNotice() {
    luToast('تم حفظ الرد — الرسالة انتقلت لتصنيف «تم الرد»', 'success');
  }
  async function saveNotes() {
    if (!detailRow) return;
    try {
      const t = $('dNotes').value.trim();
      const { error } = await LU_DB.from('submissions').update({ internal_notes: t.length ? t : null }).eq('id', detailRow.id);
      if (error) throw error;
      luToast('تم حفظ الملاحظات الداخلية', 'success');
      await loadDetail();
    } catch (err) {
      luToast(luErrorMessage(err, 'تعذر حفظ الملاحظات'), 'error');
    }
  }

  async function toggleArchive() {
    if (!detailRow) return;
    const okc = await luConfirm({
      title: detailRow.status === 'archived' ? 'إزالة الأرشفة؟' : 'أرشفة الرسالة؟',
      text: detailRow.status === 'archived'
        ? 'ستعود الرسالة لتصنيف مفتوح وستظهر في القوائم المعتادة.'
        : 'سيتم إخفاء الرسالة من القوائم الافتراضية مع الاحتفاظ بها في السجل.',
      confirmText: 'متابعة',
    });
    if (!okc) return;
    try {
      let next;
      if (detailRow.status === 'archived') {
        next = detailRow.admin_reply ? 'replied' : 'new';
      } else {
        next = 'archived';
      }
      const { error } = await LU_DB.from('submissions').update({ status: next }).eq('id', detailRow.id);
      if (error) throw error;
      luToast(next === 'archived' ? 'تمت الأرشفة' : 'تمت إزالة الأرشفة', 'success');
      await loadDetail();
      refresh();
      document.dispatchEvent(new CustomEvent('lu:submissions-changed'));
    } catch (err) {
      luToast(luErrorMessage(err, 'تعذر تنفيذ الأرشفة'), 'error');
    }
  }

  async function deleteSubmission(id) {
    if (!id) return;
    const okc = await luConfirm({
      title: 'حذف الرسالة؟',
      text: 'هل أنت متأكد من حذف هذه الرسالة؟',
      confirmText: 'حذف',
      icon: 'warning',
    });
    if (!okc) return;
    try {
      const { error } = await LU_DB.rpc('delete_submission', { p_id: Number(id) });
      if (error) throw error;
      luToast('تم حذف الرسالة', 'success');
      try { bootstrap.Modal.getOrCreateInstance($('detailModal')).hide(); } catch (e) {}
      refresh();
      document.dispatchEvent(new CustomEvent('lu:submissions-changed'));
    } catch (err) {
      console.error('delete submission', err);
      luToast(luErrorMessage(err, 'تعذر حذف الرسالة'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // تصدير Excel لكل السجلات المطابقة للفلاتر الحالية
  // ---------------------------------------------------------------------------
  async function exportView() {
    luToast('جاري تجهيز ملف Excel...', 'info');
    try {
      const { rows, partial } = await rowsForExport();
      if (!rows.length) { luToast('لا توجد سجلات مطابقة للفلاتر', 'warning'); return; }
      const header = ['الرقم المرجعي', 'التاريخ والوقت', 'النوع', 'الكلية', 'الاسم', 'الحالة', 'نص الرسالة', 'الرد الرسمي'];
      const data = rows.map((r) => [
        r.reference_number,
        luDate(r.created_at) + ' ' + luTimeHHmm(r.created_at),
        r.submission_type === 'complaint' ? 'شكوى' : 'اقتراح',
        r.college_name_snapshot || window.LU_NO_COLLEGE,
        r.sender_name || 'بدون اسم',
        (LU_STATUS[r.status] || { label: r.status }).label,
        r.message,
        r.admin_reply || ''
      ]);

      const okLib = await ensureXLSX();
      if (!okLib) { exportCsvFallback(header, data, 'lotus-messages-' + luDateISO() + '.xlsx'); return; }

      const ws = XLSX.utils.aoa_to_sheet([header].concat(data));
      ws['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 26 }, { wch: 20 }, { wch: 14 }, { wch: 60 }, { wch: 50 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الرسائل');
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(wb, 'lotus-messages-' + luDateISO() + '.xlsx');
      luToast(partial ? 'تم التصدير بالصفوف المعروضة حالياً' : 'تم تنزيل ملف Excel', 'success');
    } catch (err) {
      // آخر محاولة: CSV دائماً ينجح بدون أي مكتبات
      try {
        const header = ['الرقم المرجعي', 'التاريخ', 'النوع', 'الكلية', 'الاسم', 'الحالة', 'نص الرسالة', 'الرد الرسمي'];
        const data = lastRows.map((r) => [
          r.reference_number, luDate(r.created_at), r.submission_type === 'complaint' ? 'شكوى' : 'اقتراح',
          r.college_name_snapshot || window.LU_NO_COLLEGE, r.sender_name || 'بدون اسم',
          (LU_STATUS[r.status] || { label: r.status }).label, r.message, r.admin_reply || ''
        ]);
        if (data.length) { exportCsvFallback(header, data, 'lotus-messages-' + luDateISO() + '.xlsx'); return; }
      } catch (e2) { console.error('[LU] csv fallback', e2); }
      reportErr('تعذر التصدير', err);
    }
  }

  // ---------------------------------------------------------------------------
  // طباعة كل السجلات المطابقة للفلاتر الحالية (A4 رسمي)
  // ---------------------------------------------------------------------------
  async function printView() {
    try {
      const { rows, partial } = await rowsForExport();
      if (!rows.length) { luToast('لا توجد سجلات مطابقة للفلاتر', 'warning'); return; }
      if (partial) luToast('تمت الطباعة بالصفوف المعروضة حالياً', 'info');
      const settings = window.LUSettingsCache || {};
      const header = ['الرقم المرجعي', 'التاريخ', 'النوع', 'الكلية', 'الاسم', 'الحالة', 'نص الرسالة'];
      const tableRows = rows.map((r) => {
        const cells = [
          r.reference_number,
          luDate(r.created_at),
          r.submission_type === 'complaint' ? 'شكوى' : 'اقتراح',
          r.college_name_snapshot || window.LU_NO_COLLEGE,
          r.sender_name || 'بدون اسم',
          (LU_STATUS[r.status] || { label: r.status }).label,
          r.message
        ].map((v, i) => `<td class="${i === 6 ? 'pn-msg' : ''}"><span class="${i === 6 ? 'pn-ellipsis' : ''}">${luEscape(v)}</span></td>`).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');

      if (typeof window.printSheetFill === 'function') {
        window.printSheetFill({
          title: 'كشف الرسائل',
          meta: [
            ['عدد السجلات', String(rows.length)],
          ],
          table: { headers: header, rowsHtml: tableRows },
          footer: 'الجامعة: ' + (settings.university_name || 'جامعة اللوتس'),
          signature: 'ختم واعتماد: ________________',
        });
      } else {
        throw new Error('تعذر تجهيز ورقة الطباعة');
      }
      setTimeout(() => window.print(), 150);
    } catch (err) {
      reportErr('تعذر الطباعة', err);
    }
  }

  // ---------------------------------------------------------------------------
  // طباعة رسالة مفردة (رسمي A4)
  // ---------------------------------------------------------------------------
  function printCurrent() {
    if (!detailRow) return;
    try {
    const r = detailRow;
    const settings = window.LUSettingsCache || {};
    if (typeof window.printSheetFill !== 'function') throw new Error('تعذر تجهيز ورقة الطباعة');
    window.printSheetFill({
      title: 'رسالة ' + ((r.submission_type === 'complaint' ? (settings.label_complaint || 'شكوى') : (settings.label_suggestion || 'اقتراح'))),
      meta: [
        ['الرقم المرجعي', r.reference_number],
        ['التاريخ والوقت', luDateTime(r.created_at)],
        ['الكلية', r.college_name_snapshot || window.LU_NO_COLLEGE],
        ['اسم صاحب الرسالة', r.sender_name || 'بدون اسم'],
        ['حالة الرسالة', (LU_STATUS[r.status] || {}).label || r.status],
      ],
      sections: [
        { heading: 'نص الرسالة', content: r.message },
        r.admin_reply ? { heading: 'الرد الإداري', content: r.admin_reply } : null,
        r.internal_notes ? { heading: 'ملاحظات داخلية (سرية)', content: r.internal_notes } : null,
      ].filter(Boolean),
      footer: 'الجامعة: ' + (settings.university_name || 'جامعة اللوتس'),
      signature: 'توقيع الإدارة المختصة: ________________',
    });
    setTimeout(() => window.print(), 120);
    } catch (err) {
      reportErr('تعذر الطباعة', err);
    }
  }

  // ---------------------------------------------------------------------------
  // الأحداث المشتركة للجدول
  // ---------------------------------------------------------------------------
  let eventsInited = false;
  function initEvents(colleges) {
    syncFilterInputs(colleges);
    if (eventsInited) return;
    eventsInited = true;
    syncFilterInputs(colleges);

    // بحث فوري مع تأخير بسيط
    const debSearch = luDebounce(() => {
      st().search = $('fSearch').value;
      st().page = 1; persist(); refresh();
    }, 450);
    $('fSearch').addEventListener('input', debSearch);
    $('fSearch').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('applyFilters').click(); }
    });

    $('applyFilters').addEventListener('click', () => {
      const s = st();
      s.search = $('fSearch').value;
      s.college = $('fCollege').value;
      s.type = $('fType').disabled ? '' : $('fType').value;
      s.status = $('fStatus').disabled ? '' : $('fStatus').value;
      s.from = $('fFrom').value;
      s.to = $('fTo').value;
      s.sort = $('fSort').value;
      s.page = 1;
      persist(); refresh();
    });

    $('clearFilters').addEventListener('click', () => {
      states[currentView] = defaultState();
      persist();
      syncFilterInputs(window.LUCollegesCache || []);
      refresh();
    });

    $('pageSize').addEventListener('change', () => {
      st().pageSize = Number($('pageSize').value);
      st().page = 1; persist(); refresh();
    });

    // نقر الصفوف وأزرار الإجراءات
    $('messagesTbody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      if (btn) {
        const act = btn.dataset.act;
        if (act === 'view') open(id);
        else if (act === 'archive') { currentId = id; loadDetail().then(toggleArchive); }
        else if (act === 'delete') { deleteSubmission(id); }
        return;
      }
      open(id);
    });

    $('fSort').addEventListener('change', () => $('applyFilters').click());
    $('fFrom').addEventListener('change', () => $('applyFilters').click());
    $('fTo').addEventListener('change', () => $('applyFilters').click());
    $('fCollege').addEventListener('change', () => $('applyFilters').click());
    $('fType').addEventListener('change', () => $('applyFilters').click());
    $('fStatus').addEventListener('change', () => $('applyFilters').click());

    // نافذة التفاصيل
    $('dStatusSel').addEventListener('change', () => changeStatus($('dStatusSel').value));
    $('dSaveReply').addEventListener('click', saveReply);
    $('dSaveNotes').addEventListener('click', saveNotes);
    $('dArchive').addEventListener('click', toggleArchive);
    const dDel = document.getElementById('dDelete');
    if (dDel) dDel.addEventListener('click', () => { if (detailRow) deleteSubmission(detailRow.id); });
    const dTrack = document.getElementById('dTrackVisible');
    if (dTrack) dTrack.addEventListener('change', async () => {
      if (!detailRow || trackVisibleOk === false) return;
      try {
        const { error } = await LU_DB.from('submissions').update({ track_visible: dTrack.checked }).eq('id', detailRow.id);
        if (error) throw error;
        detailRow.track_visible = dTrack.checked;
        luToast(dTrack.checked ? 'تم إظهار حالة الرسالة في صفحة المتابعة' : 'تم إخفاء حالة الرسالة عن صفحة المتابعة', 'success');
      } catch (err) {
        dTrack.checked = !dTrack.checked;
        luToast(luErrorMessage(err, 'تعذر حفظ الإعداد'), 'error');
      }
    });
    $('dPrint').addEventListener('click', printCurrent);
    const btnExportView = document.getElementById('btnExportView');
    if (btnExportView) btnExportView.addEventListener('click', exportView);
    const btnPrintView = document.getElementById('btnPrintView');
    if (btnPrintView) btnPrintView.addEventListener('click', printView);

    // رسائل جديدة فوراً → تحديث الجدول إذا كان معروضنا
    document.addEventListener('lu:new-submission', () => {
      if ($('sec-messages').classList.contains('active')) refresh();
    });
    document.addEventListener('lu:colleges-changed', () => {
      syncFilterInputs(window.LUCollegesCache || []);
    });
  }

  return {
    initEvents, setView, refresh, open, VIEW_DEFS,
    loadPersistPublic: loadPersist,
    clearSensitiveCache,
    get currentView() { return currentView; },
  };
})();
