/* ============================================================================
   colleges.js — إدارة الكليات: إضافة/تعديل/إخفاء/ترتيب/حذف
   نظام الشكاوى والمقترحات — جامعة اللوتس
   الحماية: لا يمكن حذف كلية مرتبطة برسائل — الحذف عبر الدالة delete_college
============================================================================ */

window.LUCol = (function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // تحميل الكليات مع عدّ الرسائل المرتبطة (استعلام واحد)
  // ---------------------------------------------------------------------------
  async function loadAll() {
    try {
      const { data, error } = await LU_DB.from('colleges')
        .select('id, name, is_active, display_order, created_at, submissions(count)')
        .order('display_order', { ascending: true });
      if (error) throw error;

      window.LUCollegesCache = (data || []).map((x) => ({
        id: x.id,
        name: x.name,
        is_active: x.is_active,
        display_order: x.display_order,
        created_at: x.created_at,
        messages_count: Array.isArray(x.submissions) && x.submissions.length ? Number(x.submissions[0].count) : 0,
      }));

      render();
      document.dispatchEvent(new CustomEvent('lu:colleges-changed'));
    } catch (err) {
      console.error('colleges load', err);
      luToast(luErrorMessage(err, 'تعذر تحميل الكليات'), 'error');
    }
  }

  function render() {
    const list = window.LUCollegesCache || [];
    const tbody = $('collegeTbody');
    tbody.innerHTML = '';

    list.forEach((c, i) => (
      tbody.insertAdjacentHTML('beforeend',
        `<tr data-id="${c.id}">
          <td>
            <div class="btn-group btn-group-sm" role="group" aria-label="تغيير الترتيب">
              <button class="btn btn-outline-secondary" data-act="up" ${i === 0 ? 'disabled' : ''} title="رفع"><i class="bi bi-arrow-up"></i></button>
              <button class="btn btn-outline-secondary" data-act="down" ${i === list.length - 1 ? 'disabled' : ''} title="خفض"><i class="bi bi-arrow-down"></i></button>
            </div>
            <span class="ms-1" style="font-variant-numeric:tabular-nums">${c.display_order}</span>
          </td>
          <td style="font-weight:800">${luEscape(c.name)}</td>
          <td>
            <div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" role="switch" data-act="active" ${c.is_active ? 'checked' : ''}>
              <label class="form-check-label small">${c.is_active ? 'ظاهرة' : 'مخفية'}</label>
            </div>
          </td>
          <td><span class="lu-ref">${c.messages_count.toLocaleString('ar-EG')}</span></td>
          <td class="text-center" style="white-space:nowrap">
            <button class="lu-act" data-act="edit" title="تعديل"><i class="bi bi-pencil-fill"></i></button>
            <button class="lu-act" data-act="del" ${c.messages_count > 0 ? 'title="مرتبطة برسائل — استخدام الإخفاء بدل الحذف" disabled' : 'title="حذف نهائي"'}><i class="bi bi-trash-fill"></i></button>
          </td>
        </tr>`)
    ));

    $('collegesEmpty').classList.toggle('d-none', list.length > 0);
    $('collegesLoading') && $('collegesLoading').classList.add('d-none');
    $('collegesWrap') && $('collegesWrap').classList.remove('d-none');
  }

  // ---------------------------------------------------------------------------
  // إضافة / تعديل
  // ---------------------------------------------------------------------------
  function openModal(row) {
    if (row) {
      $('collegeModalTitle').textContent = 'تعديل كلية';
      $('collegeIdInput').value = row.id;
      $('collegeNameInput').value = row.name;
      $('collegeOrderInput').value = row.display_order;
    } else {
      $('collegeModalTitle').textContent = 'إضافة كلية';
      $('collegeIdInput').value = '';
      $('collegeNameInput').value = '';
      $('collegeOrderInput').value = (window.LUCollegesCache?.length || 0) + 1;
    }
    bootstrap.Modal.getOrCreateInstance($('collegeModal')).show();
  }

  async function save() {
    const name = $('collegeNameInput').value.trim();
    const order = Number($('collegeOrderInput').value || 0);
    const id = $('collegeIdInput').value ? Number($('collegeIdInput').value) : null;

    if (!name) { luToast('اسم الكلية مطلوب', 'warning'); return; }

    try {
      let res, err;
      if (id) {
        ({ error: err, data: res } = await LU_DB.from('colleges').update({ name, display_order: order }).eq('id', id).select().single());
      } else {
        ({ error: err, data: res } = await LU_DB.from('colleges').insert({ name, display_order: order, is_active: true }).select().single());
      }
      if (err) throw err;

      bootstrap.Modal.getInstance($('collegeModal')).hide();
      luToast(id ? 'تم تحديث الكلية' : 'تمت إضافة الكلية', 'success');

      try {
        await LU_DB.rpc('log_admin_action', {
          p_action: id ? 'college_update' : 'college_add',
          p_table_name: 'colleges', p_record_id: res.id, p_details: { name, display_order: order },
        });
      } catch (e) { /* تسجيل اختياري */ }

      await loadAll();
    } catch (err) {
      if (/duplicate key|unique/i.test(err.message || '')) {
        luToast('يوجد كلية بنفس الاسم مسبقاً', 'error');
      } else {
        luToast(luErrorMessage(err, 'تعذر حفظ الكلية'), 'error');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // تغيير الترتيب (تبديل قيم الترتيب بين كلية وأخرى بأمان)
  // ---------------------------------------------------------------------------
  async function move(id, dir) {
    const list = (window.LUCollegesCache || []).map((x) => ({ ...x }));
    const i = list.findIndex((x) => Number(x.id) === Number(id));
    const j = i + (dir === 'up' ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return;

    try {
      // خطوات مفردة غير متضاربة: نزحي مؤقت ثم تبديل قيمتي الترتيب
      const a = list[i], b = list[j];
      await LU_DB.from('colleges').update({ display_order: 9999 }).eq('id', a.id);
      const { error: e1 } = await LU_DB.from('colleges').update({ display_order: a.display_order }).eq('id', b.id);
      if (e1) throw e1;
      const { error: e2 } = await LU_DB.from('colleges').update({ display_order: b.display_order }).eq('id', a.id);
      if (e2) throw e2;
      await loadAll();
    } catch (err) {
      luToast(luErrorMessage(err, 'تعذر تغيير الترتيب'), 'error');
      await loadAll();
    }
  }

  // ---------------------------------------------------------------------------
  // تفعيل / إخفاء
  // ---------------------------------------------------------------------------
  async function setActive(id, active) {
    try {
      const { error } = await LU_DB.from('colleges').update({ is_active: !!active }).eq('id', id);
      if (error) throw error;
      luToast(active ? 'تم تفعيل الكلية — ظاهرة الآن في نموذج المستخدم' : 'تم إخفاء الكلية من نموذج المستخدم', 'success');
      try {
        await LU_DB.rpc('log_admin_action', { p_action: active ? 'college_enable' : 'college_disable', p_table_name: 'colleges', p_record_id: Number(id), p_details: {} });
      } catch (e) {}
      await loadAll();
    } catch (err) {
      luToast(luErrorMessage(err, 'تعذر تغيير حالة الكلية'), 'error');
      await loadAll();
    }
  }

  // ---------------------------------------------------------------------------
  // حذف نهائي (فقط لكلية بلا رسائل — حماية إضافية داخل delete_college)
  // ---------------------------------------------------------------------------
  async function del(id) {
    if (!await luConfirm({
      title: 'حذف الكلية نهائياً؟',
      text: 'الحذف متاح فقط للكليات التي لم تُرسل إليها أي رسالة — الحماية مفعلة على مستوى قاعدة البيانات.',
      confirmText: 'حذف نهائي',
    })) return;
    try {
      const { error } = await LU_DB.rpc('delete_college', { p_college_id: Number(id) });
      if (error) throw error;
      luToast('تم حذف الكلية', 'success');
      await loadAll();
    } catch (err) {
      luToast(luErrorMessage(err, 'تعذر الحذف — قد تكون الكلية مرتبطة برسائل'), 'error');
      await loadAll();
    }
  }

  // ---------------------------------------------------------------------------
  // الأحداث
  // ---------------------------------------------------------------------------
  let inited = false;
  async function exportColleges() {
    const rows = window.LUCollegesCache || [];
    if (!rows.length) { luToast('لا توجد كليات', 'warning'); return; }
    const header = ['الترتيب', 'اسم الكلية', 'ظاهرة بالنموذج', 'عدد الرسائل'];
    const data = rows.map((c) => [c.display_order, c.name, c.is_active ? 'نعم' : 'لا', c.messages_count || 0]);
    try {
      const okLib = await (window.luEnsureXLSX ? window.luEnsureXLSX() : !!(window.XLSX && window.XLSX.utils));
      if (!okLib) { window.luExportCsv(header, data, 'lotus-colleges-' + luDateISO() + '.xlsx'); return; }
      const ws = XLSX.utils.aoa_to_sheet([header].concat(data));
      ws['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 18 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الكليات');
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(wb, 'lotus-colleges-' + luDateISO() + '.xlsx');
    } catch (err) {
      console.error('[LU] colleges xlsx', err);
      try { window.luExportCsv(header, data, 'lotus-colleges-' + luDateISO() + '.xlsx'); }
      catch (e2) { console.error('[LU] colleges xlsx', err); luToast(luErrorMessage(err, 'تعذر التصدير — حاول مرة أخرى.'), 'error'); }
    }
  }

  function printColleges() {
    try {
    const rows = window.LUCollegesCache || [];
    if (!rows.length) { luToast('لا توجد كليات', 'warning'); return; }
    if (typeof window.printSheetFill !== 'function') throw new Error('تعذر تجهيز ورقة الطباعة');
    const header = ['الترتيب', 'اسم الكلية', 'ظاهرة بالنموذج', 'عدد الرسائل'];
    const tableRows = rows.map((c) => `<tr>
      <td>${c.display_order}</td><td>${luEscape(c.name)}</td>
      <td>${c.is_active ? 'نعم' : 'لا'}</td><td>${c.messages_count || 0}</td>
    </tr>`).join('');
    window.printSheetFill({
      title: 'كشف الكليات',
      meta: [['عدد الكليات', String(rows.length)]],
      table: { headers: header, rowsHtml: tableRows },
      footer: 'الجامعة: ' + ((window.LUSettingsCache || {}).university_name || 'جامعة اللوتس'),
      signature: 'ختم واعتماد: ________________',
    });
    setTimeout(() => window.print(), 150);
    } catch (err) {
      console.error('[LU] print colleges', err);
      luToast(luErrorMessage(err, 'تعذر الطباعة — حاول مرة أخرى.'), 'error');
    }
  }

  function init() {
    if (inited) return;
    inited = true;
    $('collegeAddBtn').addEventListener('click', () => openModal(null));
    $('collegeSaveBtn').addEventListener('click', save);
    const ce = $('collegeExportBtn'); if (ce) ce.addEventListener('click', exportColleges);
    const cp = $('collegePrintBtn'); if (cp) cp.addEventListener('click', printColleges);

    $('collegeTbody').addEventListener('click', (e) => {
      const sw = e.target.closest('input[data-act="active"]');
      const tr = e.target.closest('tr[data-id]');
      const btn = e.target.closest('button[data-act]');
      if (!tr) return;
      const id = Number(tr.dataset.id);

      // مفتاح الإظهار: نعيد مظهره ثم ينفذ التغيير فعلياً (لو فشل يعود لَهذا)
      if (sw) {
        const want = sw.checked;
        sw.checked = !sw.checked;
        setActive(id, want);
        return;
      }
      if (!btn) return;

      const act = btn.dataset.act;
      const row = (window.LUCollegesCache || []).find((x) => Number(x.id) === Number(id));
      if (act === 'edit') openModal(row);
      if (act === 'up') move(id, 'up');
      if (act === 'down') move(id, 'down');
      if (act === 'del') del(id);
    });
  }

  return { init, loadAll };
})();
