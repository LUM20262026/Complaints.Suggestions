/* ============================================================================
   reports.js — صفحة التقارير: فلاتر متقدمة، تصدير Excel/CSV، طباعة رسمية
   نظام الشكاوى والمقترحات — جامعة اللوتس
   التصدير يشمل «كل» السجلات المطابقة للفلاتر وليس الصفحة المعروضة فقط
============================================================================ */

window.LURep = (function () {
  'use strict';

  const PAGE = 50;              // حجم معاينة الرد
  const MAX_EXPORT = 20000;     // سقف التصدير (حماية المتصفح)
  let rows = null;              // آخر نتائج التقرير الكاملة
  let page = 1;
  let meta = null;

  const $ = (id) => document.getElementById(id);

  // شارات الحالات في فلتر التقرير (تُبنى مرة واحدة)
  function buildStatusChecks() {
    $('rStatuses').innerHTML = Object.entries(LU_STATUS).map(([k, v]) =>
      `<div class="form-check form-check-inline mb-0">
         <input class="form-check-input r-status" type="checkbox" value="${k}" id="rSt${k}">
         <label class="form-check-label" for="rSt${k}" style="font-size:0.84rem">${v.label}</label>
       </div>`).join('');
  }

  // قراءة الفلاتر
  function readFilters() {
    const statuses = Array.from(document.querySelectorAll('.r-status:checked')).map((cb) => cb.value);
    const types = [];
    if ($('rTypeC').checked) types.push('complaint');
    if ($('rTypeS').checked) types.push('suggestion');
    return {
      from: $('rFrom').value,
      to: $('rTo').value,
      college: $('rCollege').value,
      types,
      statuses,
      incReply: $('incReply').checked,
      incNotes: $('incNotes').checked,
    };
  }

  // سلسلة استعلام قاعدة البيانات من الفلاتر
  function applyQuery(f, q) {
    if (f.from) q = q.gte('created_at', new Date(f.from + 'T00:00:00').toISOString());
    if (f.to)   q = q.lte('created_at', new Date(f.to + 'T23:59:59.999').toISOString());
    if (f.college) q = q.eq('college_id', Number(f.college));
    if (f.types.length === 1) q = q.eq('submission_type', f.types[0]);
    if (f.statuses.length) q = q.in('status', f.statuses);
    return q;
  }

  async function apply() {
    const f = readFilters();
    const collegeNames = window.LUCollegesCache || [];

    meta = { f };

    $('reportLoading').classList.remove('d-none');
    $('reportWrap').classList.add('d-none');
    $('reportEmpty').classList.add('d-none');

    try {
      // جلب «جميع» السجلات المطابقة دفعة بعد دفعة (1000 لكل دفعة)
      let all = [];
      let done = false;
      for (let offset = 0; offset < MAX_EXPORT && !done; offset += 1000) {
        let q = applyQuery(f, LU_DB.from('submissions')
          .select('id, reference_number, sender_name, college_id, college_name_snapshot, submission_type, message, status, admin_reply, internal_notes, created_at, updated_at, replied_at, resolved_at')
          .order('created_at', { ascending: false })
          .range(offset, offset + 999));
        // الاسم المعروض من اللقطة المحفوظة وقت الإرسال (college_name_snapshot)
        const { data, error } = await q;
        if (error) throw error;
        if (data && data.length) {
          all = all.concat(data);
          if (data.length < 1000) done = true;
        } else {
          done = true;
        }
      }

      rows = all;
      page = 1;
      render(all, f, collegeNames);
      $('reportWrap').classList.remove('d-none');
    } catch (err) {
      console.error('report', err);
      luToast(luErrorMessage(err, 'تعذر إنشاء التقرير'), 'error');
    } finally {
      $('reportLoading').classList.add('d-none');
    }
  }

  // ريباع النتائج كلها في المعاينة + KPI
  function render(all, f, collegeNames) {
    // معلومات المدى
    $('reportMeta').textContent =
      'التقرير: ' + (f.types.length === 1 ? (f.types[0] === 'complaint' ? 'الشكاوى فقط' : 'المقترحات فقط') : 'جميع الرسائل') +
      (f.from || f.to ? ' — الفترة: ' + (f.from || 'بداية') + ' إلى ' + (f.to || 'الآن') : ' — كل الفترات') +
      (f.statuses.length ? ' — الحالات: ' + f.statuses.map((s) => LU_STATUS[s].label).join('،') : '') +
      ' — عدد السجلات: ' + all.length.toLocaleString('ar-EG');

    // KPI عدد
    const c = all.filter((r) => r.submission_type === 'complaint').length;
    const s = all.filter((r) => r.submission_type === 'suggestion').length;
    const named = all.filter((r) => r.sender_name).length;
    const replied = all.filter((r) => r.admin_reply).length;
    $('rKpis').innerHTML = `
      <span class="lu-mini-kpi"><i class="bi bi-inboxes-fill" style="color:#1E7A5B"></i> الإجمالي: ${all.length.toLocaleString('ar-EG')}</span>
      <span class="lu-mini-kpi"><i class="bi bi-exclamation-octagon-fill" style="color:#EF4444"></i> شكاوى: ${c.toLocaleString('ar-EG')}</span>
      <span class="lu-mini-kpi"><i class="bi bi-lightbulb-fill" style="color:#3B82F6"></i> اقتراحات: ${s.toLocaleString('ar-EG')}</span>
      <span class="lu-mini-kpi"><i class="bi bi-person-badge" style="color:#7A5FB5"></i> بالاسم: ${named.toLocaleString('ar-EG')}</span>
      <span class="lu-mini-kpi"><i class="bi bi-chat-heart" style="color:#8B5CF6"></i> لديها رد رسمي: ${replied.toLocaleString('ar-EG')}</span>`;

    // صفوف المعاينة (50)
    const tbody = $('reportTbody');
    tbody.innerHTML = '';
    const slice = all.slice((page - 1) * PAGE, page * PAGE);
    if (!slice.length) {
      $('reportRangeInfo').textContent = '';
      $('reportEmpty').classList.remove('d-none');
    } else {
      $('reportEmpty').classList.add('d-none');
      slice.forEach((r) => {
        tbody.insertAdjacentHTML('beforeend',
          `<tr>
            <td><span class="lu-ref">${luEscape(r.reference_number)}</span></td>
            <td style="white-space:nowrap">${luDate(r.created_at)}</td>
            <td>${r.submission_type === 'complaint' ? 'شكوى' : 'اقتراح'}</td>
            <td>${luEscape(r.college_name_snapshot || window.LU_NO_COLLEGE)}</td>
            <td>${r.sender_name ? luEscape(r.sender_name) : '<span class="text-muted">بدون اسم</span>'}</td>
            <td><span class="lu-cell-msg" title="${luEscape(r.message)}">${luEscape(r.message.slice(0, 120))}${r.message.length > 120 ? '…' : ''}</span></td>
            <td>
              <span class="lu-badge" style="color:#fff;background:${(LU_STATUS[r.status] || { color: '#64748B' }).color}">
                ${(LU_STATUS[r.status] || { label: r.status }).label}
              </span>
            </td>
          </tr>`);
      });
      const pages = Math.max(1, Math.ceil(all.length / PAGE));
      renderPaginationReport(all.length, page, PAGE, pages);
      $('reportRangeInfo').textContent = `معاينة ${(page - 1) * PAGE + 1} - ${Math.min(page * PAGE, all.length)} من ${all.length.toLocaleString('ar-EG')} سجل`;
    }
  }

  function renderPaginationReport(total, p, size, pages) {
    const ul = $('rPagination');
    ul.innerHTML = '';
    if (pages <= 1) return;
    let start = Math.max(1, p - 2);
    let end = Math.min(pages, start + 4);
    start = Math.max(1, end - 4);
    const add = (label, pg, active, disabled) => {
      ul.insertAdjacentHTML('beforeend',
        `<li class="page-item ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}">
          <button class="page-link" ${pg ? 'data-page="' + pg + '"' : ''}>${label}</button></li>`);
    };
    add('<i class="bi bi-chevron-right"></i>', p > 1 ? p - 1 : null, false, p <= 1);
    for (let i = start; i <= end; i++) add(i, i, i === p, false);
    add('<i class="bi bi-chevron-left"></i>', p < pages ? p + 1 : null, false, p >= pages);
    ul.querySelectorAll('button[data-page]').forEach((b) =>
      b.addEventListener('click', () => { page = Number(b.dataset.page); render(rows, meta.f, window.LUCollegesCache || []); })
    );
  }

  // ---------------------------------------------------------------------------
  // صف مُكرر لكن بيانات معالجة للتصدير (تفرع حسب خيارات التضمين)
  // ---------------------------------------------------------------------------
  function exportRow(r, f) {
    const base = [
      r.reference_number,
      luDate(r.created_at) + ' ' + luTimeHHmm(r.created_at),
      r.submission_type === 'complaint' ? 'شكوى' : 'اقتراح',
      r.college_name_snapshot || window.LU_NO_COLLEGE,
      r.sender_name || 'بدون اسم',
      (LU_STATUS[r.status] || { label: r.status }).label,
      r.message,
    ];
    if (f.incReply) base.push(r.admin_reply || '');
    if (f.incNotes) base.push(r.internal_notes || '');
    return base;
  }

  function exportHeader(f) {
    const base = ['الرقم المرجعي', 'التاريخ والوقت', 'النوع', 'الكلية', 'الاسم', 'الحالة', 'نص الرسالة'];
    if (f.incReply) base.push('الرد الرسمي');
    if (f.incNotes) base.push('ملاحظات داخلية (سرية)');
    return base;
  }

  // ---------------------------------------------------------------------------
  // تصدير Excel (SheetJS)
  // ---------------------------------------------------------------------------
  async function exportXlsx() {
    if (!rows || !rows.length) { luToast('أنشئ التقرير أولاً عبر «إنشاء التقرير»', 'warning'); return; }
    const f = meta.f;
    luToast('جاري تجهيز ملف Excel (' + rows.length + ' سجل)...', 'info');
    try {
      const okLib = await (window.luEnsureXLSX ? window.luEnsureXLSX() : !!(window.XLSX && window.XLSX.utils));
      if (!okLib || !(window.XLSX && window.XLSX.utils)) {
        const header = exportHeader(f);
        const data = rows.map((r) => exportRow(r, f));
        window.luExportCsv ? window.luExportCsv(header, data, 'lotus-report-' + luDateISO() + '.xlsx')
          : luToast('تعذر إنشاء ملف Excel', 'error');
        return;
      }
      const wsData = [exportHeader(f)].concat(rows.map((r) => exportRow(r, f)));
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      // أعمدة أعرض قليلاً
      ws['!cols'] = exportHeader(f).map((_, i) => ({ wch: i === 6 || i > 7 ? 60 : 16 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'تقرير الشكاوى والمقترحات');
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(wb, 'lotus-report-' + luDateISO() + '.xlsx');
      logExport('xlsx', rows.length);
    } catch (err) {
      console.error('[LU] xlsx', err);
      try {
        const header = exportHeader(f);
        const data = rows.map((r) => exportRow(r, f));
        if (window.luExportCsv) { window.luExportCsv(header, data, 'lotus-report-' + luDateISO() + '.xlsx'); logExport('csv', rows.length); return; }
      } catch (e2) { console.error('[LU] csv fallback', e2); }
      console.error('[LU] xlsx', err);
      luToast(luErrorMessage(err, 'تعذر إنشاء ملف Excel — حاول مرة أخرى.'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // تصدير CSV (بترميز UTF-8 بـ BOM لكي تفتحه مايكروسوفت سليمة)
  // ---------------------------------------------------------------------------
  function exportCsv() {
    if (!rows || !rows.length) { luToast('أنشئ التقرير أولاً عبر «إنشاء التقرير»', 'warning'); return; }
    const f = meta.f;
    const esc = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const lines = [exportHeader(f).map(esc).join(',')];
    rows.forEach((r) => lines.push(exportRow(r, f).map(esc).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lotus-report-' + luDateISO() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    logExport('csv', rows.length);
  }

  // تسجيل عملية التصدير في سجل العمليات
  function logExport(kind, count) {
    try {
      LU_DB.rpc('log_admin_action', {
        p_action: 'report_export',
        p_table_name: 'submissions',
        p_record_id: null,
        p_details: { format: kind, rows_count: count },
      }).then(() => {}).catch(() => {});
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // الطباعة الرسمية (A4) —.report كامل
  // ---------------------------------------------------------------------------
  function printReport() {
    if (!rows) { luToast('أنشئ التقرير أولاً', 'warning'); return; }
    const f = meta.f;
    const st = window.LUSettingsCache || {};
    const headers = exportHeader(f);
    const tableRows = rows.map((r) => {
      const cells = [];
      exportRow(r, f).forEach((v, i) => {
        const isLong = i >= 6; // الأعمدة النصية الطويلة
        cells.push(`<td class="${isLong ? 'pn-msg' : ''}"><span class="${isLong ? 'pn-ellipsis' : ''}">${luEscape(v)}</span></td>`);
      });
      return '<tr>' + cells.join('') + '</tr>';
    }).join('');

    try {
    if (typeof window.printSheetFill !== 'function') throw new Error('تعذر تجهيز ورقة الطباعة');
    window.printSheetFill({
      title: 'تقرير ' + (f.types.length === 1 ? (f.types[0] === 'complaint' ? 'الشكاوى' : 'المقترحات') : 'الشكاوى والمقترحات'),
      meta: [
        ['الفترة المحددة', (f.from || 'بداية السجلات') + '  —  ' + (f.to || 'الحالي')],
        ['عدد السجلات', String(rows.length)],
      ],
      table: { headers, rowsHtml: tableRows },
      footer: 'الجامعة: ' + (st.university_name || 'جامعة اللوتس'),
      signature: 'ختم واعتماد: ________________',
    });
    setTimeout(() => window.print(), 150);
    logExport('print', rows.length);
    } catch (err) {
      console.error('[LU] print report', err);
      console.error('[LU] print report', err);
      luToast(luErrorMessage(err, 'تعذر الطباعة — حاول مرة أخرى.'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // أحداث الصفحة
  // ---------------------------------------------------------------------------
  let inited = false;
  function init(colleges) {
    $('rCollege').innerHTML = '<option value="">جميع الكليات</option>' +
      (colleges || []).map((c) => `<option value="${c.id}">${luEscape(c.name)}</option>`).join('');
    if (inited) return;
    inited = true;
    buildStatusChecks();

    $('rApply').addEventListener('click', apply);
    $('rClear').addEventListener('click', () => {
      $('rFrom').value = ''; $('rTo').value = ''; $('rCollege').value = '';
      $('rTypeC').checked = true; $('rTypeS').checked = true;
      document.querySelectorAll('.r-status').forEach((cb) => (cb.checked = false));
      rows = null; page = 1;
      $('reportTbody').innerHTML = '';
      $('rKpis').innerHTML = '';
      $('reportMeta').textContent = 'التقرير: جميع الرسائل — كل الفترات';
      $('reportRangeInfo').textContent = '';
      $('reportEmpty').classList.add('d-none');
      $('rPagination').innerHTML = '';
    });

    $('btnXlsx').addEventListener('click', exportXlsx);
    $('btnCsv').addEventListener('click', exportCsv);
    $('btnPrint').addEventListener('click', printReport);
  }

  function refreshColleges(colleges) {
    $('rCollege').innerHTML = '<option value="">جميع الكليات</option>' +
      (colleges || []).map((c) => `<option value="${c.id}">${luEscape(c.name)}</option>`).join('');
  }

  return { init, refreshColleges, apply };
})();
