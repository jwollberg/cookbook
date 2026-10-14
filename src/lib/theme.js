// Light or dark for every Atheos app (README.md, "Light and dark"). Auto follows the device;
// Light or Dark is chosen in any app's account menu and holds for all of them, because it is
// kept in a cookie for the whole of atheosstudios.com (each app has its own address, so its own
// localStorage). Load it in <head>, after the stylesheets, as an ordinary (blocking) script.
//
// It marks <html data-theme>, which the shell's own colors follow, and it switches the
// stylesheets' (prefers-color-scheme) blocks on or off to match, so an app's own dark rules
// follow the choice too without a second copy of each. The switch is any element with
// data-as-theme="auto|light|dark"; a change is announced as the window event "atheos-theme"
// (a map restyles itself on it), and window.atheosTheme.set() changes it from a script.
(() => {
  const root = document.documentElement;
  const YES = "(min-width: 0px)", NO = "(max-width: 0.01px)";
  const original = new WeakMap();
  const read = () => (/(?:^|;\s*)atheos-theme=(light|dark)(?:;|$)/.exec(document.cookie) || [])[1] || "auto";
  let theme = read();

  function rules(list, want) {
    for (const r of list) {
      if (r.media && r.cssRules) {
        if (!original.has(r)) original.set(r, r.media.mediaText);
        const text = original.get(r);
        if (/prefers-color-scheme/.test(text)) {
          const next = want === "auto" ? text : text.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/g, (_, s) => (s === want ? YES : NO));
          if (r.media.mediaText !== next) r.media.mediaText = next;
        }
      }
      if (r.cssRules) rules(r.cssRules, want);
    }
  }

  function apply() {
    if (theme === "auto") { delete root.dataset.theme; root.style.colorScheme = ""; }
    else { root.dataset.theme = theme; root.style.colorScheme = theme; }
    for (const sheet of document.styleSheets) {
      try { rules(sheet.cssRules, theme); } catch { /* another site's sheet (the fonts): nothing of ours */ }
    }
    for (const m of document.querySelectorAll('meta[name="theme-color"][media]')) {
      m.dataset.media ??= m.media;
      m.media = theme === "auto" ? m.dataset.media : m.dataset.media.includes(theme) ? "all" : "not all";
    }
    for (const b of document.querySelectorAll("[data-as-theme]")) b.setAttribute("aria-pressed", String(b.dataset.asTheme === theme));
  }

  function set(next) {
    theme = next === "light" || next === "dark" ? next : "auto";
    const domain = /(^|\.)atheosstudios\.com$/.test(location.hostname) ? "; domain=atheosstudios.com" : "";
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = theme === "auto" ? `atheos-theme=; path=/; max-age=0${domain}` : `atheos-theme=${theme}; path=/; max-age=31536000; SameSite=Lax${secure}${domain}`;
    apply();
    dispatchEvent(new CustomEvent("atheos-theme", { detail: theme }));
  }

  window.atheosTheme = { get: () => theme, set };
  apply();
  document.addEventListener("DOMContentLoaded", apply);
  addEventListener("load", apply);
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-as-theme]");
    if (b) { e.preventDefault(); set(b.dataset.asTheme); }
  });
  // Chosen in another app meanwhile: follow it when this one is looked at again.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || read() === theme) return;
    theme = read();
    apply();
    dispatchEvent(new CustomEvent("atheos-theme", { detail: theme }));
  });
})();
