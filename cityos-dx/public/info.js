// Help and website policies page: same display settings as the portal (text size, contrast, language), remembered in this browser only.
'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };
  const SIZES = [14, 16, 18, 20];
  let size = Math.max(0, SIZES.indexOf(Number(store.get('portal-size')) || 16));
  let lang = store.get('portal-lang') === 'hi' ? 'hi' : 'en';
  const setSize = i => { size = Math.min(SIZES.length - 1, Math.max(0, i)); document.documentElement.style.fontSize = SIZES[size] + 'px'; store.set('portal-size', SIZES[size]); };
  const setContrast = on => { if (on) document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast; $('#contrast').setAttribute('aria-pressed', String(on)); store.set('portal-contrast', on ? '1' : ''); };
  const setLang = l => {
    lang = l; store.set('portal-lang', l); document.documentElement.lang = l;
    document.querySelectorAll('[data-l]').forEach(el => { el.hidden = el.dataset.l !== l; });
    const b = $('#lang'); b.textContent = l === 'en' ? 'हिंदी' : 'English'; b.lang = l === 'en' ? 'hi' : 'en';
    document.title = l === 'en' ? 'Help and website policies · City Data Portal (demo)' : 'सहायता और वेबसाइट नीतियाँ · सिटी डेटा पोर्टल (डेमो)';
  };
  document.addEventListener('DOMContentLoaded', () => {
    setSize(size); setContrast(store.get('portal-contrast') === '1'); setLang(lang);
    $('#fs-dn').onclick = () => setSize(size - 1); $('#fs-up').onclick = () => setSize(size + 1); $('#fs-0').onclick = () => setSize(1);
    $('#contrast').onclick = () => setContrast(!document.documentElement.dataset.contrast);
    $('#lang').onclick = () => setLang(lang === 'en' ? 'hi' : 'en');
  });
})();
