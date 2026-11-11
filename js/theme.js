/* ============================================================================
   theme.js — نظام الوضع النهاري والداكن (يُطبق على كل صفحات النظام)
   نظام الشكاوى والمقترحات — جامعة اللوتس
============================================================================ */

window.LUTheme = {
  KEY: 'lu_theme',          // مفتاح اختيار المستخدم في LocalStorage
  _default: 'light',        // الافتراضي من إعدادات الإدارة (يُحدَّث إن توفر)

  // تطبيق الوضع على الصفحة
  apply(theme) {
    if (theme !== 'dark' && theme !== 'light') theme = 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.dispatchEvent(new CustomEvent('lu:themechange', { detail: { theme } }));
    this._syncButtons(theme);
  },

  current() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  },

  // التبديل والتخزين (اختيار المستخدم يتقدم على الافتراضي الإداري دائماً)
  toggle() {
    const next = this.current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(this.KEY, next); } catch (e) {}
    this.apply(next);
  },

  // تشغيل النظام: يقرأ اختيار المستخدم، وإلا يستخدم الافتراضي الإداري
  init(defaultTheme) {
    if (defaultTheme === 'dark' || defaultTheme === 'light') this._default = defaultTheme;
    let saved = null;
    try { saved = localStorage.getItem(this.KEY); } catch (e) {}
    this.apply(saved || this._default);

    // ربط جميع أزرار التبديل في الصفحة (المستقبل متاح للعناصر المضافة لاحقاً)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-toggle]');
      if (btn) { e.preventDefault(); this.toggle(); }
    });

    this._syncButtons(this.current());
  },

  // تحديث أيقونات أزرار التبديل (شمس/قمر)
  _syncButtons(theme) {
    document.querySelectorAll('[data-theme-toggle] .lu-theme-icon').forEach((i) => {
      i.className = theme === 'dark'
        ? 'lu-theme-icon bi bi-sun-fill'
        : 'lu-theme-icon bi bi-moon-stars-fill';
    });
    document.querySelectorAll('[data-theme-toggle] .lu-theme-label').forEach((el) => {
      el.textContent = theme === 'dark' ? 'نهاري' : 'داكن';
    });
  },
};
