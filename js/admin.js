/* ============================================================================
   admin.js — نواة لوحة الإدارة: الجلسة، التوجيه، الإشعارات الفورية،
   إدارة حسابات المديرين، سجل العمليات، والطباعة
   نظام الشكاوى والمقترحات — جامعة اللوتس
============================================================================ */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const modalOf = (el) => bootstrap.Modal.getOrCreateInstance(el);

  // ---------------------------------------------------------------------------
  // تعريف الطرق (Routes): البند → الشاشة العنوان الدور المطلوب
  // ---------------------------------------------------------------------------
  const ROUTES = {
    'dashboard':            { sec: 'sec-dashboard', title: 'الرئيسية', min: 'viewer' },
    'messages-all':         { sec: 'sec-messages', title: 'جميع الرسائل', min: 'viewer', msgView: 'messages-all' },
    'messages-complaints':  { sec: 'sec-messages', title: 'الشكاوى', min: 'viewer', msgView: 'messages-complaints' },
    'messages-suggestions': { sec: 'sec-messages', title: 'المقترحات', min: 'viewer', msgView: 'messages-suggestions' },
    'messages-new':         { sec: 'sec-messages', title: 'الرسائل الجديدة', min: 'viewer', msgView: 'messages-new' },
    'messages-review':      { sec: 'sec-messages', title: 'قيد المراجعة', min: 'viewer', msgView: 'messages-review' },
    'messages-replied':     { sec: 'sec-messages', title: 'تم الرد عليها', min: 'viewer', msgView: 'messages-replied' },
    'messages-resolved':    { sec: 'sec-messages', title: 'تم الحل', min: 'viewer', msgView: 'messages-resolved' },
    'messages-archived':    { sec: 'sec-messages', title: 'الأرشيف', min: 'viewer', msgView: 'messages-archived' },
    'reports':              { sec: 'sec-reports', title: 'التقارير والإحصائيات', min: 'viewer' },
    'colleges':             { sec: 'sec-colleges', title: 'إدارة الكليات', min: 'admin' },
    'settings':             { sec: 'sec-settings', title: 'إعدادات واجهة المستخدم', min: 'admin' },
    'admins':               { sec: 'sec-admins', title: 'إدارة المديرين والصلاحيات', min: 'super_admin' },
  };

  // ---------------------------------------------------------------------------
  // ورقة الطباعة المشتركة (تقارير ورسائل وفترات) — تنسيق رسمي A4
  // ---------------------------------------------------------------------------
  window.printSheetFill = function ({ title, meta = [], sections = null, table = null, footer, signature }) {
    const s = window.LUSettingsCache || {};
    const logo = s.logo_url || 'assets/images/lotus-logo.svg';
    const uni = s.university_name || 'جامعة اللوتس';

    const head =
      `<div class="pn-head">
         <img class="pn-logo" src="${luEscape(logo)}" alt="">
         <h1>${luEscape(uni)}</h1>
         <h2>${luEscape(title)}</h2>
       </div>`;

    const metaHtml = `<div class="pn-meta">` +
      meta.map(([k, v]) => `<span><b>${luEscape(k)}:</b> ${luEscape(v)}</span>`).join('') +
      `</div>`;

    let bodyHtml = '';
    if (sections && sections.length) {
      bodyHtml = sections.map((sec) =>
        `<div class="pn-single-box">
           <div class="row-l"><b>${luEscape(sec.heading)}</b></div>
           <div style="line-height:1.9;white-space:pre-wrap">${luEscape(sec.content)}</div>
         </div>`).join('');
    }
    if (table) {
      bodyHtml += `<table class="pn-table">
        <thead><tr>${table.headers.map((h) => `<th>${luEscape(h)}</th>`).join('')}</tr></thead>
        <tbody>${table.rowsHtml}</tbody>
      </table>`;
    }

    const foot = `<div class="pn-foot">
       <span>${luEscape(footer || '')}</span>
       <span>${luEscape(signature || '')}</span>
     </div>`;

    $('printSheet').innerHTML = head + metaHtml + bodyHtml + foot;
  };

  // ---------------------------------------------------------------------------
  // شريط الجرس: عدّ الرسائل الجديدة (يُحدّث فوراً مع Realtime)
  // ---------------------------------------------------------------------------
  let bellCount = 0;

  async function refreshBell() {
    try {
      const { count, error } = await LU_DB.from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new');
      if (error) throw error;
      bellCount = count || 0;
      updateBellUI();
    } catch (e) { console.warn('bell', e); }
  }

  function updateBellUI() {
    const badge = $('bellBadge');
    const side = $('sideNewBadge');
    if (bellCount > 0) {
      badge.classList.remove('d-none');
      badge.textContent = bellCount > 99 ? '99+' : bellCount;
      side.classList.remove('d-none');
      side.textContent = bellCount > 99 ? '99+' : bellCount;
    } else {
      badge.classList.add('d-none');
      side.classList.add('d-none');
    }
  }

  function isOn(route) {
    return (location.hash || '').replace('#/', '') === route;
  }

  // ---------------------------------------------------------------------------
  // إشعارات Realtime: رسالة جديدة في أي وقت أثناء صلاحية المدير
  // ---------------------------------------------------------------------------
  let liveChannel = null;

  function subscribeLive() {
    unsubscribeLive();
    liveChannel = LU_DB
      .channel('lu-admin-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions' }, (payload) => {
        bellCount += 1;
        updateBellUI();
        document.dispatchEvent(new CustomEvent('lu:new-submission', { detail: payload.new }));
        // تنبيه لطيف (داخل اللوحة — ليست إشعار حاسب خارجي)
        const row = payload.new || {};
        luToast('وصلت رسالة جديدة' + (row.sender_name ? ' من: ' + luEscape(row.sender_name) : '') + ' — تُظهرها الآن في قائمة الرسائل الجديدة', 'info');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions' }, () => {
        // عند تغيير حالات (ممن من جهاز آخر) — إعادة عناية إحصائيات أجندة الجدار
        refreshBell();
        document.dispatchEvent(new CustomEvent('lu:submissions-changed'));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => {
        refreshSettingsCache();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'colleges' }, () => {
        refreshCollegesCache();
      })
      .subscribe();
  }

  function unsubscribeLive() {
    if (liveChannel) {
      try { LU_DB.removeChannel(liveChannel); } catch (e) {}
      liveChannel = null;
    }
  }

  // مخازن مشتركة
  async function refreshSettingsCache() {
    try {
      const { data } = await LU_DB.from('app_settings').select('*').eq('id', 1).single();
      if (data) {
        window.LUSettingsCache = data;
        const labels = { 'label_complaint': data.label_complaint, 'label_suggestion': data.label_suggestion };
        // تحديث ملصقات الفلاتر الحية دون تحديث كامل الصفحة
        $('fType').innerHTML = `
          <option value="">الكل</option>
          <option value="complaint">${luEscape(labels.label_complaint || 'شكوى')}</option>
          <option value="suggestion">${luEscape(labels.label_suggestion || 'اقتراح')}</option>`;
      }
    } catch (e) { console.warn('settings cache', e); }
  }

  async function refreshCollegesCache() {
    try {
      const { data, error } = await LU_DB.from('colleges').select('id, name, is_active, display_order').order('display_order');
      if (!error && data) {
        window.LUCollegesCache = data;
        document.dispatchEvent(new CustomEvent('lu:colleges-changed'));
      }
    } catch (e) { console.warn('colleges cache', e); }
  }

  // ---------------------------------------------------------------------------
  // إدارة حسابات المديرين (داخل admin.js لأنها واجهة صغيرة)
  // ---------------------------------------------------------------------------
  const AdminsCtl = {
    inited: false,
    async refresh() {
      $('adminsLoading').classList.remove('d-none');
      $('adminsWrap').classList.add('d-none');
      try {
        const { data, error } = await LU_DB.from('admin_profiles')
          .select('*').order('created_at', { ascending: true });
        if (error) throw error;
        const rows = data || [];
        this.rows = rows;
        const me = LUAuth.profile;

        $('adminsTbody').innerHTML = rows.map((a) => {
          const isMe = a.id === me.id;
          return `<tr data-id="${a.id}">
            <td style="font-weight:800">${luEscape(a.full_name)} ${isMe ? '<span class="badge" style="background:var(--lu-soft);color:var(--lu-primary)">أنت</span>' : ''}</td>
            <td class="small" dir="ltr" style="text-align:right">${luEscape(a.email)}</td>
            <td>
              <select class="form-select form-select-sm" data-act="role" style="width:auto" ${isMe ? 'disabled' : ''}>
                <option value="viewer" ${a.role === 'viewer' ? 'selected' : ''}>عرض (viewer)</option>
                <option value="admin" ${a.role === 'admin' ? 'selected' : ''}>مدير (admin)</option>
                <option value="super_admin" ${a.role === 'super_admin' ? 'selected' : ''}>سوبر أدمن</option>
              </select>
            </td>
            <td>
              <div class="form-check form-switch mb-0">
                <input class="form-check-input" type="checkbox" role="switch" data-act="active" ${a.is_active ? 'checked' : ''}>
              </div>
            </td>
            <td class="small" style="white-space:nowrap">${luDate(a.created_at)}</td>
            <td class="text-center">
              <button class="lu-act" data-act="del" ${isMe ? 'disabled title="لا تحذف حسابك بنفسك"' : 'title="إزالة المدير"'}><i class="bi bi-person-dash-fill"></i></button>
            </td>
          </tr>`;
        }).join('');
        $('adminsEmpty').classList.toggle('d-none', rows.length > 0);
      } catch (err) {
        luToast(luErrorMessage(err, 'تعذر تحميل حسابات المديرين'), 'error');
      } finally {
        $('adminsLoading').classList.add('d-none');
        $('adminsWrap').classList.remove('d-none');
      }
    },

    async exportExcel() {
      const rows = this.rows || [];
      if (!rows.length) { luToast('لا يوجد مديرون', 'warning'); return; }
      const header = ['الاسم', 'البريد الإلكتروني', 'الدور', 'نشط', 'تاريخ الإضافة'];
      const roleLabel = { super_admin: 'سوبر أدمن', admin: 'مدير', viewer: 'عرض فقط' };
      const data = rows.map((a) => [a.full_name, a.email, roleLabel[a.role] || a.role, a.is_active ? 'نعم' : 'لا', luDate(a.created_at)]);
      try {
        const okLib = await (window.luEnsureXLSX ? window.luEnsureXLSX() : !!(window.XLSX && window.XLSX.utils));
        if (!okLib) { window.luExportCsv(header, data, 'lotus-admins-' + luDateISO() + '.xlsx'); return; }
        const ws = XLSX.utils.aoa_to_sheet([header].concat(data));
        ws['!cols'] = [{ wch: 24 }, { wch: 34 }, { wch: 16 }, { wch: 10 }, { wch: 16 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'المديرون');
        wb.Workbook = { Views: [{ RTL: true }] };
        XLSX.writeFile(wb, 'lotus-admins-' + luDateISO() + '.xlsx');
      } catch (err) {
        console.error('[LU] admins xlsx', err);
        try { window.luExportCsv(header, data, 'lotus-admins-' + luDateISO() + '.xlsx'); }
        catch (e2) { console.error('[LU] export', err); luToast(luErrorMessage(err, 'تعذر التصدير — حاول مرة أخرى.'), 'error'); }
      }
    },

    printSheet() {
      const rows = this.rows || [];
      if (!rows.length) { luToast('لا يوجد مديرون', 'warning'); return; }
      try {
      if (typeof window.printSheetFill !== 'function') throw new Error('تعذر تجهيز ورقة الطباعة');
      const header = ['الاسم', 'البريد الإلكتروني', 'الدور', 'نشط'];
      const roleLabel = { super_admin: 'سوبر أدمن', admin: 'مدير', viewer: 'عرض فقط' };
      const tableRows = rows.map((a) => `<tr>
        <td>${luEscape(a.full_name)}</td><td dir="ltr">${luEscape(a.email)}</td>
        <td>${roleLabel[a.role] || luEscape(a.role)}</td><td>${a.is_active ? 'نعم' : 'لا'}</td>
      </tr>`).join('');
      window.printSheetFill({
        title: 'كشف المديرين والصلاحيات',
        meta: [['عدد المديرين', String(rows.length)]],
        table: { headers: header, rowsHtml: tableRows },
        footer: 'الجامعة: ' + ((window.LUSettingsCache || {}).university_name || 'جامعة اللوتس'),
        signature: 'ختم واعتماد: ________________',
      });
      setTimeout(() => window.print(), 150);
      } catch (err) {
        console.error('[LU] print admins', err);
        luToast(luErrorMessage(err, 'تعذر الطباعة — حاول مرة أخرى.'), 'error');
      }
    },

    init() {
      if (this.inited) return;
      this.inited = true;

      $('adminAddBtn').addEventListener('click', () => modalOf($('adminModal')).show());
      const ae = $('adminExportBtn'); if (ae) ae.addEventListener('click', () => this.exportExcel());
      const ap = $('adminPrintBtn'); if (ap) ap.addEventListener('click', () => this.printSheet());
      $('adminSaveBtn').addEventListener('click', async () => {
        const email = $('aEmail').value.trim();
        const name = $('aName').value.trim();
        const role = $('aRole').value;
        if (!email || !name) { luToast('البريد والاسم مطلوبان', 'warning'); return; }
        try {
          const { error } = await LU_DB.rpc('add_admin_by_email', { p_email: email, p_full_name: name, p_role: role });
          if (error) throw error;
          modalOf($('adminModal')).hide();
          $('aEmail').value = ''; $('aName').value = '';
          luToast('تم حفظ بيانات المدير', 'success');
          this.refresh();
        } catch (err) {
          luToast(luErrorMessage(err, 'تعذر حفظ المدير — تأكد من إنشاء الحساب أولاً'), 'error');
        }
      });

      $('adminsTbody').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act="del"]');
        if (!btn) return;
        const tr = btn.closest('tr[data-id]');
        const id = tr.dataset.id;
        if (!await luConfirm({ title: 'إزالة المدير؟', text: 'سيفقد الحساب صلاحيات الدخول للوحة — الحساب نفسه يبقى موجوداً.', confirmText: 'إزالة' })) return;
        try {
          const { error } = await LU_DB.rpc('remove_admin', { p_admin_id: id });
          if (error) throw error;
          luToast('تمت إزالة المدير', 'success');
          this.refresh();
        } catch (err) {
          luToast(luErrorMessage(err, 'تعذر الإزالة'), 'error');
        }
      });

      $('adminsTbody').addEventListener('change', async (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const id = tr.dataset.id;
        if (e.target.matches('select[data-act="role"]')) {
          const role = e.target.value;
          if (!await luConfirm({ title: 'تغيير دور المدير؟', text: 'الدور الجديد: ' + role })) { e.target.blur(); return; }
          try {
            const { error } = await LU_DB.from('admin_profiles').update({ role }).eq('id', id);
            if (error) throw error;
            luToast('تم تحديث الدور', 'success');
          } catch (err) {
            luToast(luErrorMessage(err, 'تعذر تحديث الدور'), 'error');
            this.refresh();
          }
        }
        if (e.target.matches('input[data-act="active"]')) {
          const want = !e.target.checked;
          e.target.checked = !e.target.checked;
          try {
            const { error } = await LU_DB.from('admin_profiles').update({ is_active: want }).eq('id', id);
            if (error) throw error;
            e.target.checked = want;
            luToast(want ? 'الحساب نشط الآن' : 'تم تعطيل الحساب', 'success');
          } catch (err) {
            luToast(luErrorMessage(err, 'تعذر تغيير حالة الحساب'), 'error');
          }
        }
      });
    },
  };

  // ---------------------------------------------------------------------------
  // سجل العمليات
  // ---------------------------------------------------------------------------
  const AuditCtl = {
    page: 1,
    inited: false,
    async refresh() {
      $('auditLoading').classList.remove('d-none');
      $('auditWrap').classList.add('d-none');
      try {
        const term = ($('auditSearch').value || '').trim();
        let q = LU_DB.from('audit_logs')
          .select('id, action, table_name, record_id, details, created_at, admin_id', { count: 'exact' });
        if (term.length >= 2) {
          const safe = term.replace(/[,()\\%*_]/g, ' ').trim();
          q = q.or(`action.ilike.%${safe}%,table_name.ilike.%${safe}%`);
        }
        q = q.range((this.page - 1) * 20, this.page * 20 - 1).order('created_at', { ascending: false });
        const { data, count, error } = await q;
        if (error) throw error;

        const rows = data || [];
        // جلب أسماء المديرين بشكل منفصل (لا توجد علاقة FK مباشرة بين audit_logs و admin_profiles)
        const ids = [...new Set(rows.map(r => r.admin_id).filter(Boolean))];
        let nameById = {};
        if (ids.length) {
          const { data: admins } = await LU_DB.from('admin_profiles').select('id, full_name, email').in('id', ids);
          (admins || []).forEach(a => { nameById[a.id] = a.full_name || a.email || a.id; });
        }

        $('auditTbody').innerHTML = rows.map((l, i) => `<tr>
          <td>${(this.page - 1) * 20 + i + 1}</td>
          <td class="small" style="white-space:nowrap">${luDateTime(l.created_at)}</td>
          <td class="small">${l.admin_id ? luEscape(nameById[l.admin_id] || l.admin_id) : '—'}</td>
          <td><span class="badge" style="background:var(--lu-soft);color:var(--lu-primary)">${luEscape(l.action)}</span></td>
          <td class="small">${luEscape(l.table_name || '—')}${l.record_id ? ' #' + l.record_id : ''}</td>
          <td class="small" dir="ltr" style="text-align:right">${l.details ? luEscape(JSON.stringify(l.details)).slice(0, 120) : '—'}</td>
        </tr>`).join('');

        $('auditEmpty').classList.toggle('d-none', rows.length > 0);
        $('auditInfo').textContent = count ? `${(this.page - 1) * 20 + 1} - ${Math.min(this.page * 20, count)} من ${count.toLocaleString('ar-EG')}` : '';
        LUSub.renderPaginationFor(count, this.page, 20, 'auditPagination', (p) => { this.page = p; this.refresh(); });
      } catch (err) {
        console.error('audit logs', err);
        luToast(luErrorMessage(err, 'تعذر تحميل سجل العمليات'), 'error');
      } finally {
        $('auditLoading').classList.add('d-none');
        $('auditWrap').classList.remove('d-none');
      }
    },

    init() {
      if (this.inited) return;
      this.inited = true;
      $('auditApply').addEventListener('click', () => { this.page = 1; this.refresh(); });
      $('auditSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.page = 1; this.refresh(); } });
    },
  };

  // ---------------------------------------------------------------------------
  // التوجيه (Router)
  // ---------------------------------------------------------------------------
  function navigate() {
    const pro = LUAuth.profile;
    if (!pro) { showLogin(); return; }

    let route = (location.hash || '').replace('#/', '') || 'messages-all';
    if (route === 'dashboard') { location.hash = '#/messages-all'; return; }
    // حماية من مفاتيح موروثة من Object.prototype (مثل #/constructor)
    if (!Object.prototype.hasOwnProperty.call(ROUTES, route)) route = 'messages-all';
    const def = ROUTES[route];
    if (!LUAuth.hasRoleAt(def.min)) {
      luToast('لا تملك صلاحية الدخول لهذه الشاشة', 'warning');
      location.hash = '#/messages-all';
      return;
    }

    // تفعيل الشاشة ومنها
    document.querySelectorAll('.lu-section').forEach((s) => s.classList.remove('active'));
    $(def.sec).classList.add('active');
    $('pageTitleTop').textContent = def.title;

    // تفعيل البند في القائمة
    document.querySelectorAll('.lu-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === route));
    document.body.classList.remove('lu-nav-open');

    // تشغيل العرض لكل قسم
    if (route === 'dashboard') {
      LUDash.init(); LUDash.refresh();
    } else if (def.msgView) {
      LUSub.setView(def.msgView);
    } else if (route === 'reports') {
      LURep.refreshColleges(window.LUCollegesCache || []);
      if (LURep.apply) LURep.apply();
    } else if (route === 'colleges') {
      LUCol.init(); LUCol.loadAll();
    } else if (route === 'settings') {
      LUSet.init(); LUSet.load();
    } else if (route === 'admins') {
      AdminsCtl.init(); AdminsCtl.refresh();
    }
  }

  // ---------------------------------------------------------------------------
  // شاشة الدخول / شاشة النظام
  // ---------------------------------------------------------------------------
  function showLogin() {
    $('loginView').classList.remove('d-none');
    $('appShell').classList.add('d-none');
    document.title = 'لوحة الإدارة | جامعة اللوتس';
    clearSensitiveUI();
  }

  // إفراغ كل بيانات الرسائل من الشاشة والذاكرة عند الخروج
  // (مهم على الأجهزة المشتركة حتى لا تبقى نصوص شكوى ظاهرة بعد الخروج)
  function clearSensitiveUI() {
    try {
      ['messagesTbody', 'reportTbody', 'collegesTbody', 'adminsTbody', 'auditTbody', 'dHistoryTbody']
        .forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
      ['dMessage', 'dReply', 'dNotes'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { if ('value' in el) el.value = ''; else el.innerHTML = ''; }
      });
      const k = document.getElementById('rKpis'); if (k) k.innerHTML = '';
      document.querySelectorAll('.lu-section').forEach((s) => s.classList.remove('active'));
      if (window.LUSub && LUSub.clearSensitiveCache) LUSub.clearSensitiveCache();
      window.LUCollegesCache = [];
    } catch (e) { console.warn('clear UI', e); }
  }

  async function showApp(pro) {
    $('loginView').classList.add('d-none');
    $('appShell').classList.remove('d-none');

    // معلومات المدير
    const roleLabel = { super_admin: 'سوبر أدمن', admin: 'مدير', viewer: 'عرض فقط' }[pro.role] || pro.role;
    $('userChipName').textContent = pro.full_name;
    $('userChipRole').textContent = roleLabel;
    $('userChipAvatar').textContent = (pro.full_name || 'م').trim().charAt(0);
    const nm = $('userChipNameMobile'); if (nm) nm.textContent = pro.full_name;
    const rm = $('userChipRoleMobile'); if (rm) rm.textContent = roleLabel;

    if (!LUAuth.hasRoleAt('admin')) {
      $('viewerNote').classList.remove('d-none');
    }

    // الفلاتر مخزن الكليات + الملصقات
    await Promise.all([refreshCollegesCache(), refreshSettingsCache()]);

    // القائمة: إخفاء بنود أعلى من صلاحية المستخدم
    document.querySelectorAll('.lu-nav-item[data-min-role]').forEach((b) => {
      const need = b.dataset.minRole;
      b.classList.toggle('d-none', !LUAuth.hasRoleAt(need));
    });

    // تشغيل الإشعات الفورية + الجرس
    subscribeLive();
    refreshBell();
  }

  // ---------------------------------------------------------------------------
  // تشغيل الصفحة
  // ---------------------------------------------------------------------------
  async function boot() {
    loadStatePersist();

    // 1) الوضع الافتراضي من الإعدادات (الوصفة متاحة للزائر أيضاً)
    try {
      const { data } = await LU_DB.from('app_settings').select('default_theme').eq('id', 1).maybeSingle();
      LUTheme.init((data || {}).default_theme || 'light');
    } catch (e) { LUTheme.init('light'); }

    // 2) أحداث دخول عامة
    bindLoginEvents();
    bindMenuEvents();

    // 3) فحص الجلسة الحالية
    const pro = await LUAuth.ensureAdmin();
    if (pro) {
      await showApp(pro);
      LUSub.initEvents(window.LUCollegesCache || []);
      LURep.init(window.LUCollegesCache || []);
      navigate();
    } else {
      showLogin();
    }

    // 4) متابعة حالة الاتى (خروج/متابعة جلسة)
    LU_DB.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        unsubscribeLive();
        showLogin();
        location.hash = '';
      }
    });

    // 5) التوجيه على تغيّر الرابط
    window.addEventListener('hashchange', navigate);
  }

  function loadStatePersist() {
    // الفلاتر لرسائل تعيد فتحها بعد التنقل — التنفيذ داخل LUSub.loadPersist()
    LUSub.loadPersistPublic && LUSub.loadPersistPublic();
  }

  // ---------------------------------------------------------------------------
  // أحداث تسجيل الدخول
  // ---------------------------------------------------------------------------
  function bindLoginEvents() {
    // إظهار/إخفاء كلمة المرور
    $('togglePwd').addEventListener('click', () => {
      const inp = $('loginPassword');
      const isPw = inp.type === 'password';
      inp.type = isPw ? 'text' : 'password';
      $('togglePwdIcon').className = 'bi ' + (isPw ? 'bi-eye-slash-fill' : 'bi-eye-fill');
    });

    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      // للتحقق من اكتمال الحقول قبل إرسال الطلب إلى Supabase (لا نداء للـAPI ببريد فارغ)
      const formEl = e.target;
      if (typeof formEl.checkValidity === 'function' && !formEl.checkValidity() && !formEl.noValidate) {
        if (formEl.reportValidity) formEl.reportValidity();
        return;
      }
      const email = $('loginEmail').value.trim();
      const password = $('loginPassword').value;
      const btn = $('loginBtn');

      $('loginError').classList.add('d-none');
      btn.disabled = true;
      const old = btn.innerHTML;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span><span>جارٍ التحقق...</span>';

      try {
        const pro = await LUAuth.login(email, password);

        // سجل عملية الدخول في سجل العمليات
        try {
          await LU_DB.rpc('log_admin_action', { p_action: 'login', p_table_name: 'auth_users', p_record_id: null, p_details: { email: pro.email } });
        } catch (le) {}

        await showApp(pro);
        LUSub.initEvents(window.LUCollegesCache || []);
        LURep.init(window.LUCollegesCache || []);
        location.hash = '#/messages-all';
        navigate();
        luToast('مرحباً بعودتك ' + pro.full_name, 'success');
      } catch (err) {
        console.error('login', err);
        // تشخيص للمطوّر فقط في وحدة التحكم — لا يُعرض أي تفاصيل تقنية للمستخدم
        if (navigator.onLine && (err instanceof TypeError || /fetch|network/i.test(err && err.message || ''))) {
          console.warn('[LU] الخادم لم يستجب — تحقق من اتصال الشبكة ومن طريقة فتح الصفحة.');
        }
        $('loginErrorText').textContent = LUAuth.loginError(err);
        $('loginError').classList.remove('d-none');
      } finally {
        btn.disabled = false;
        btn.innerHTML = old;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // نسخة احتياطية كاملة (JSON) لكل الجداول
  // ---------------------------------------------------------------------------
  async function backupAll() {
    const okc = await luConfirm({
      title: 'نسخة احتياطية؟',
      text: 'سيتم تنزيل ملف JSON يحتوي كل بيانات النظام (الرسائل، الكليات، الإعدادات، المديرون، السجلات).',
      confirmText: 'تنزيل',
    });
    if (!okc) return;
    luToast('جاري تجهيز النسخة الاحتياطية...', 'info');
    try {
      const tables = ['submissions', 'submission_history', 'colleges', 'app_settings', 'admin_profiles', 'audit_logs'];
      const data = {};
      for (const t of tables) {
        let all = [];
        for (let offset = 0; offset < 20000; offset += 1000) {
          const { data: rows, error } = await LU_DB.from(t).select('*').range(offset, offset + 999);
          if (error) throw error;
          if (rows && rows.length) { all = all.concat(rows); if (rows.length < 1000) break; }
          else break;
        }
        data[t] = all;
      }
      const payload = {
        app: 'lotus-complaints',
        version: 1,
        exported_at: new Date().toISOString(),
        data,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lotus-backup-' + luDateISO() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      luToast('تم تنزيل النسخة الاحتياطية', 'success');
    } catch (err) {
      console.error('backup', err);
      luToast(luErrorMessage(err, 'تعذر إنشاء النسخة الاحتياطية'), 'error');
    }
  }

  function bindMenuEvents() {
    $('menuBtn').addEventListener('click', () => document.body.classList.toggle('lu-nav-open'));
    $('navBackdrop').addEventListener('click', () => document.body.classList.remove('lu-nav-open'));

    // تنقل القائمة الجانبية
    document.getElementById('sidebarNav').addEventListener('click', (e) => {
      const btn = e.target.closest('.lu-nav-item[data-route]');
      if (!btn) return;
      e.preventDefault();
      location.hash = '#/' + btn.dataset.route;
    });

    // الخروج (سايدبور + الرمز العلوي)
    const doLogout = async () => {
      if (!await luConfirm({ title: 'تسجيل الخروج؟', text: 'ستحتاج لتسجيل الدخول مرة أخرى لاستخدام اللوحة.', confirmText: 'خروج' })) return;
      try { await LU_DB.rpc('log_admin_action', { p_action: 'logout', p_table_name: 'auth_users', p_record_id: null, p_details: {} }); } catch (e) {}
      await LUAuth.logout();
    };
    $('logoutBtn').addEventListener('click', doLogout);
    $('topLogout').addEventListener('click', doLogout);

    // زر الجرس: فتح الرسائل الجديدة
    $('liveBell').addEventListener('click', () => { location.hash = '#/messages-new'; });

    // نسخة احتياطية من كل البيانات
    const backupBtn = $('backupBtn');
    if (backupBtn) backupBtn.addEventListener('click', backupAll);

    // تغيير كلمة المرور (متاح من القائمة العلوية)
    const openPw = () => {
      const m = document.getElementById('pwModal');
      if (m) bootstrap.Modal.getOrCreateInstance(m).show();
    };
    const topPw = $('topPwBtn');
    if (topPw) topPw.addEventListener('click', openPw);
    const savePwBtn = $('savePw');
    if (savePwBtn && !savePwBtn.dataset.bound) {
      savePwBtn.dataset.bound = '1';
      savePwBtn.addEventListener('click', async () => {
        const cur = ($('pwCurrent') ? $('pwCurrent').value : '');
        const a = $('pwNew').value, b = $('pwNew2').value;
        if (!cur) { luToast('أدخل كلمة المرور الحالية', 'warning'); return; }
        if (a.length < 8) { luToast('كلمة المرور 8 أحرف على الأقل', 'warning'); return; }
        if (a !== b) { luToast('كلمتا المرور غير متطابقتين', 'error'); return; }
        if (cur === a) { luToast('كلمة المرور الجديدة يجب أن تختلف عن الحالية', 'warning'); return; }
        const btn = savePwBtn;
        const oldHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        try {
          // التحقق من كلمة المرور الحالية أولاً (منع تغيير كلمة المرور دون إثبات الهوية)
          const email = LUAuth.profile && LUAuth.profile.email;
          if (!email) throw new Error('NO_EMAIL');
          const { error: authErr } = await LU_DB.auth.signInWithPassword({ email, password: cur });
          if (authErr) {
            luToast('كلمة المرور الحالية غير صحيحة', 'error');
            return;
          }
          const { error } = await LU_DB.auth.updateUser({ password: a });
          if (error) throw error;
          bootstrap.Modal.getInstance($('pwModal')).hide();
          $('pwCurrent').value = ''; $('pwNew').value = ''; $('pwNew2').value = '';
          luToast('تم تحديث كلمة المرور بنجاح', 'success');
          try { await LU_DB.rpc('log_admin_action', { p_action: 'password_change', p_table_name: 'auth_users', p_record_id: null, p_details: {} }); } catch (e) {}
        } catch (err) {
          console.error('[LU] password change', err);
          luToast(luErrorMessage(err, 'تعذر تغيير كلمة المرور'), 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = oldHtml;
        }
      });
    }
  }

  // التشغيل
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
