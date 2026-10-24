// The right-click menu and keyboard shortcuts for every Atheos app (README.md, "Right-click
// menu"). Right-click anything and the app's own actions for it come first (a plan's "Mark
// seen", a recipe's "Add to plan"), then copying a link or the selected text, then the same
// few things everywhere: back, forward, reload, Go to (the app's sections), Switch app, Theme
// and the shortcut list. Shift + right-click, a phone's long press and right-clicking a text
// field keep the browser's own menu.
//
// An app adds its actions with window.atheosMenu.add(selector, (el, ctx) => items): the
// element right-clicked, or the nearest one above it that matches, gets those items. Shortcuts:
// atheosMenu.key("n", "New issue", run). "?" lists them all; "g" then a letter goes to a section.
// Load it in <head> as an ordinary script, like theme.js (it only listens until it is needed).
(() => {
  if (window.atheosMenu) return;
  const doc = document;
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

  // Tabler Icons 3.48.0 (MIT, Paweł Kuna), as the shell's README asks. An app adds its own to
  // atheosMenu.icons, or passes the <path>s as an item's icon.
  const ICON = {
    back: '<path d="M5 12l14 0"/><path d="M5 12l6 6"/><path d="M5 12l6 -6"/>',
    forward: '<path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/>',
    reload: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
    link: '<path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/>',
    copy: '<path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/>',
    external: '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
    search: '<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
    photo: '<path d="M15 8h.01"/><path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z"/><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5"/><path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l2 2"/>',
    compass: '<path d="M8 16l2 -6l6 -2l-2 6l-6 2"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/>',
    apps: '<path d="M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M14 7l6 0"/><path d="M17 4l0 6"/>',
    contrast: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 17a5 5 0 0 0 0 -10v10"/>',
    keyboard: '<path d="M2 8a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z"/><path d="M6 10l0 .01"/><path d="M10 10l0 .01"/><path d="M14 10l0 .01"/><path d="M18 10l0 .01"/><path d="M6 14l0 .01"/><path d="M18 14l0 .01"/><path d="M10 14l4 .01"/>',
    check: '<path d="M5 12l5 5l10 -10"/>',
    chevron: '<path d="M9 6l6 6l-6 6"/>',
    x: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  };
  const svg = (i) => (i ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[i] ?? i}</svg>` : "<span></span>");

  const providers = []; // { sel, fn }
  const keys = []; // { combo, label, run, group, when }
  let finder = null; // { label, run(text) }: "Search for" on selected text
  let pointer = "mouse";
  let menu = null, sub = null, opener = null, restore = null, reclick = null;

  const editable = (el) => el?.closest?.('input:not([type=button],[type=checkbox],[type=radio],[type=submit],[type=reset],[type=range],[type=color],[type=file]),textarea,select,[contenteditable=""],[contenteditable="true"]');
  const short = (s) => (s.length > 24 ? `${s.slice(0, 22).trim()}…` : s);
  const appName = () => doc.querySelector(".as-brand")?.textContent.trim() || "This app";

  // The app's sections, from its bar (or its phone tab bar), each with a "g" letter of its own.
  function navLinks() {
    const seen = new Set(), used = new Set(["g"]), out = [];
    let links = [...doc.querySelectorAll(".as-nav a[href]")];
    if (!links.length) links = [...doc.querySelectorAll(".as-tabbar a[href]")];
    for (const a of links) {
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      // A count badge in the link ("Activity 3") is not part of its name.
      const label = a.dataset.label || a.getAttribute("aria-label") || a.textContent.trim().replace(/\s*\d+$/, "");
      const key = [...label.toLowerCase()].find((c) => c >= "a" && c <= "z" && !used.has(c));
      if (key) used.add(key);
      out.push({ label, href: a.href, key, current: a.getAttribute("aria-current") === "page" });
    }
    return out;
  }
  const searchBox = () => [...doc.querySelectorAll('[data-as-search], input[type="search"]')].find((el) => el.offsetParent !== null);

  // ---------- what the menu holds ----------

  function groups(target) {
    const ctx = { target, selection: String(getSelection() ?? "").trim(), link: target.closest("a[href]"), image: target.closest("img") };
    const out = [], used = new Set();
    // Below a short page the click lands on <html>: start from <body>, so "body" items still show.
    for (let el = target === doc.documentElement ? doc.body : target; el && el !== doc.documentElement; el = el.parentElement) {
      for (const p of providers) {
        if (used.has(p) || !el.matches(p.sel)) continue;
        used.add(p);
        try {
          const items = p.fn(el, ctx)?.filter(Boolean);
          if (items?.length) out.push(items);
        } catch (err) { console.error(err); }
      }
    }
    if (ctx.selection) out.push([
      { label: "Copy", icon: "copy", keys: `${MOD} C`, run: () => copy(ctx.selection, "Copied") },
      finder && { label: `${finder.label} “${short(ctx.selection)}”`, icon: "search", run: () => finder.run(ctx.selection) },
    ].filter(Boolean));
    const href = ctx.link?.href;
    if (href && /^https?:/.test(href)) out.push([
      { label: "Open link in new tab", icon: "external", run: () => open(href, "_blank", "noopener") },
      { label: "Copy link", icon: "link", run: () => copy(href, "Link copied") },
    ]);
    const src = ctx.image?.currentSrc || ctx.image?.src;
    if (src && !src.startsWith("data:")) out.push([
      { label: "Open image in new tab", icon: "photo", run: () => open(src, "_blank", "noopener") },
      { label: "Copy image address", icon: "link", run: () => copy(src, "Image address copied") },
    ]);

    const end = [];
    const nav = navLinks();
    if (nav.length > 1) end.push({ label: "Go to", icon: "compass", items: nav.map((n) => ({ label: n.label, href: n.href, checked: n.current, keys: n.key && `G ${n.key.toUpperCase()}` })) });
    const apps = [...doc.querySelectorAll(".as-menu a.as-app[href]")];
    if (apps.length > 1) end.push({ label: "Switch app", icon: "apps", items: apps.map((a) => ({ label: (a.querySelector("b") ?? a).textContent.trim(), href: a.href, checked: a.getAttribute("aria-current") === "true" })) });
    if (window.atheosTheme) end.push({ label: "Theme", icon: "contrast", items: ["auto", "light", "dark"].map((t) => ({ label: t[0].toUpperCase() + t.slice(1), checked: atheosTheme.get() === t, run: () => atheosTheme.set(t) })) });
    end.push({ label: "Keyboard shortcuts", icon: "keyboard", keys: "?", run: help });
    out.push(end);
    return out;
  }

  const bar = () => [
    { label: "Back", icon: "back", disabled: window.navigation ? !navigation.canGoBack : history.length < 2, run: () => history.back() },
    { label: "Forward", icon: "forward", disabled: window.navigation ? !navigation.canGoForward : false, run: () => history.forward() },
    { label: "Reload", icon: "reload", run: () => location.reload() },
    { label: "Copy page link", icon: "link", run: () => copy(location.href, "Page link copied") },
  ];

  // ---------- drawing it ----------

  function itemEl(it) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = `as-ctx-i${it.danger ? " danger" : ""}`;
    b.tabIndex = -1;
    b.disabled = !!it.disabled;
    const radio = "checked" in it;
    b.setAttribute("role", radio ? "menuitemradio" : "menuitem");
    if (radio) b.setAttribute("aria-checked", String(!!it.checked));
    b.innerHTML = `${svg(radio ? (it.checked ? "check" : "") : it.icon)}<span class="as-ctx-l"></span>${it.items ? svg("chevron") : '<span class="as-ctx-k"></span>'}`;
    b.querySelector(".as-ctx-l").textContent = it.label;
    if (it.keys && !it.items) for (const k of it.keys.split(" ")) b.querySelector(".as-ctx-k").append(Object.assign(doc.createElement("kbd"), { textContent: k }));
    if (it.items) { b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false"); }
    b._item = it;
    return b;
  }

  function box(list, withBar) {
    const m = doc.createElement("div");
    m.className = "as-ctx";
    m.setAttribute("role", "menu");
    m.tabIndex = -1;
    if (withBar) {
      const row = doc.createElement("div");
      row.className = "as-ctx-bar";
      for (const it of bar()) {
        const b = itemEl(it);
        b.className = "as-ctx-b";
        b.title = it.label;
        b.setAttribute("aria-label", it.label);
        b.innerHTML = svg(it.icon);
        row.append(b);
      }
      m.append(row);
    }
    list.forEach((g, i) => {
      if (i) m.append(Object.assign(doc.createElement("div"), { className: "as-ctx-sep", role: "separator" }));
      for (const it of g) {
        if (!it) continue;
        if (it === "-") m.append(Object.assign(doc.createElement("div"), { className: "as-ctx-sep", role: "separator" }));
        else if (it.heading) m.append(Object.assign(doc.createElement("div"), { className: "as-ctx-h", textContent: it.heading }));
        else m.append(itemEl(it));
      }
    });
    m.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) activate(b, e); });
    m.addEventListener("pointermove", (e) => {
      const b = e.target.closest("button");
      if (!b || b === doc.activeElement) return;
      b.focus({ preventScroll: true });
      if (m === menu) {
        if (sub && opener !== b) closeSub();
        if (b._item?.items && !b.disabled) openSub(b);
      }
    });
    return m;
  }

  function place(m, x, y, beside) {
    m.style.left = "0px"; m.style.top = "0px";
    doc.body.append(m);
    const r = m.getBoundingClientRect(), W = innerWidth, H = innerHeight, gap = 8;
    let left = x, top = y;
    if (beside) {
      left = beside.right + 4; top = beside.top - 7;
      if (left + r.width > W - gap) left = beside.left - r.width - 4;
      if (top + r.height > H - gap) top = H - gap - r.height;
    } else {
      if (left + r.width > W - gap) left = x - r.width;
      if (top + r.height > H - gap) top = y - r.height;
    }
    m.style.left = `${Math.max(gap, Math.min(left, W - gap - r.width))}px`;
    m.style.top = `${Math.max(gap, top)}px`;
  }

  function openAt(target, x, y, byKeyboard) {
    close();
    restore = doc.activeElement;
    if (x == null) { const r = target.getBoundingClientRect(); x = r.left; y = r.bottom + 4; }
    menu = box(groups(target), true);
    if (!byKeyboard) menu.append(Object.assign(doc.createElement("div"), { className: "as-ctx-hint", textContent: "Shift + right-click for the browser's menu" }));
    place(menu, x, y);
    menu.focus({ preventScroll: true });
    if (byKeyboard) menu.querySelector(".as-ctx-i:not(:disabled)")?.focus();
    doc.addEventListener("keydown", onKey, true);
  }

  function openSub(b) {
    if (opener === b) return;
    closeSub();
    opener = b;
    b.setAttribute("aria-expanded", "true");
    sub = box([b._item.items]);
    place(sub, 0, 0, b.getBoundingClientRect());
  }
  function closeSub() {
    opener?.setAttribute("aria-expanded", "false");
    sub?.remove();
    sub = opener = null;
  }

  function close() {
    if (!menu) return;
    closeSub();
    menu.remove();
    menu = null;
    doc.removeEventListener("keydown", onKey, true);
    if (restore?.isConnected) restore.focus?.({ preventScroll: true });
    restore = null;
  }

  function activate(b, e) {
    const it = b._item;
    if (!it || b.disabled) return;
    if (it.items) { openSub(b); sub.querySelector("button:not(:disabled)")?.focus(); return; }
    close();
    if (it.href) {
      if (e?.ctrlKey || e?.metaKey || it.newTab) open(it.href, "_blank", "noopener");
      else location.assign(it.href);
      return;
    }
    Promise.resolve().then(() => it.run?.()).catch((err) => { console.error(err); toast(err?.message || "That didn't work", true); });
  }

  function onKey(e) {
    const m = sub?.contains(doc.activeElement) ? sub : menu;
    const list = [...m.querySelectorAll("button:not(:disabled)")];
    const i = list.indexOf(doc.activeElement);
    const go = (n) => list[(n + list.length) % list.length]?.focus();
    const cur = list[i];
    switch (e.key) {
      case "ArrowDown": go(i + 1); break;
      case "ArrowUp": go(i < 0 ? -1 : i - 1); break;
      case "Home": go(0); break;
      case "End": go(-1); break;
      case "ArrowRight":
        if (cur?.classList.contains("as-ctx-b")) go(i + 1);
        else if (cur?._item?.items) activate(cur);
        break;
      case "ArrowLeft":
        if (m === sub) { const o = opener; closeSub(); o.focus(); }
        else if (cur?.classList.contains("as-ctx-b")) go(i - 1);
        break;
      case "Escape":
        if (m === sub) { const o = opener; closeSub(); o.focus(); } else close();
        break;
      case "Enter": case " ": if (cur) activate(cur, e); break;
      case "Tab": close(); break;
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const c = e.key.toLowerCase();
        const next = [...list.slice(i + 1), ...list.slice(0, i + 1)].find((b) => b.querySelector(".as-ctx-l")?.textContent.toLowerCase().startsWith(c));
        next?.focus();
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // ---------- opening and closing ----------

  doc.addEventListener("pointerdown", (e) => {
    pointer = e.pointerType || "mouse";
    if (menu && !menu.contains(e.target) && !sub?.contains(e.target)) {
      reclick = e.target.closest?.("[data-as-more]") === restore ? restore : null;
      close();
    }
  }, true);
  doc.addEventListener("contextmenu", (e) => {
    if (menu && (menu.contains(e.target) || sub?.contains(e.target))) { e.preventDefault(); return; }
    if (e.defaultPrevented || e.shiftKey || pointer === "touch") return;
    const t = e.target instanceof Element ? e.target : e.target.parentElement;
    if (!t || editable(t) || t.closest("[data-as-native-menu], dialog[open]:not(.as-keys)")) return;
    e.preventDefault();
    const byKeyboard = e.button !== 2;
    if (byKeyboard) openAt(t, null, null, true);
    else openAt(t, e.clientX, e.clientY, false);
  });
  // A "more" button (⋯) opens the same menu for what it sits on: the way in on a phone.
  doc.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-as-more]");
    if (!b) return;
    e.preventDefault();
    if (reclick === b) { reclick = null; return; }
    const r = b.getBoundingClientRect();
    openAt(b, r.left, r.bottom + 4, e.detail === 0);
    restore = b;
  });
  addEventListener("scroll", (e) => { if (menu && !menu.contains(e.target) && !sub?.contains(e.target)) close(); }, true);
  addEventListener("resize", close);
  addEventListener("blur", close);
  addEventListener("popstate", close);

  // ---------- keyboard shortcuts ----------

  function shortcuts() {
    const list = keys.filter((k) => !k.when || k.when());
    list.push({ combo: "?", label: "Keyboard shortcuts", group: "Anywhere", run: help });
    const s = searchBox();
    if (s) list.push({ combo: "/", label: "Search", group: "Anywhere", run: () => { s.focus(); s.select?.(); } });
    for (const n of navLinks()) if (n.key) list.push({ combo: `g ${n.key}`, label: n.label, group: "Go to", run: () => location.assign(n.href) });
    return list;
  }

  let prefix = "", prefixTimer = 0;
  doc.addEventListener("keydown", (e) => {
    if (menu || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.key.length !== 1) return;
    if (editable(e.target) || doc.querySelector("dialog[open]")) return;
    const combo = prefix ? `${prefix} ${e.key}` : e.key;
    const all = shortcuts();
    const hit = all.find((s) => s.combo === combo);
    if (hit) {
      e.preventDefault();
      prefix = "";
      Promise.resolve().then(() => hit.run()).catch((err) => { console.error(err); toast(err?.message || "That didn't work", true); });
    } else if (!prefix && all.some((s) => s.combo.startsWith(`${e.key} `))) {
      e.preventDefault();
      prefix = e.key;
      clearTimeout(prefixTimer);
      prefixTimer = setTimeout(() => { prefix = ""; }, 1500);
    } else prefix = "";
  });

  function help() {
    close();
    let d = doc.querySelector("dialog.as-keys");
    if (!d) {
      d = doc.createElement("dialog");
      d.className = "as-keys";
      d.addEventListener("click", (e) => { if (e.target === d || e.target.closest(".as-keys-x")) d.close(); });
      doc.body.append(d);
    }
    const byGroup = new Map();
    for (const s of shortcuts()) {
      const g = s.group || appName();
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push([s.label, s.combo.toUpperCase()]);
    }
    byGroup.set("Mouse", [["Right-click: this menu, for what is under the pointer", ""], ["The browser's own menu", "Shift Right-click"], ["Open a link in a new tab", `${MOD} Click`]]);
    const head = doc.createElement("div");
    head.className = "as-keys-h";
    head.innerHTML = `<h2>Keyboard shortcuts</h2><button type="button" class="as-keys-x" aria-label="Close">${svg("x")}</button>`;
    const body = doc.createElement("div");
    body.className = "as-keys-b";
    for (const [g, rows] of byGroup) {
      const sec = doc.createElement("section");
      sec.append(Object.assign(doc.createElement("h3"), { textContent: g }));
      for (const [label, combo] of rows) {
        const row = doc.createElement("div");
        row.append(Object.assign(doc.createElement("span"), { textContent: label }));
        const k = doc.createElement("span");
        for (const part of combo.split(" ").filter(Boolean)) k.append(Object.assign(doc.createElement("kbd"), { textContent: part === "RIGHT-CLICK" ? "Right-click" : part === "CLICK" ? "Click" : part }));
        row.append(k);
        sec.append(row);
      }
      body.append(sec);
    }
    d.replaceChildren(head, body);
    d.showModal();
  }

  // ---------- a word on what happened ----------

  let toastTimer = 0;
  function toast(text, bad = false) {
    let t = doc.querySelector(".as-toast");
    if (!t) {
      t = Object.assign(doc.createElement("div"), { className: "as-toast", role: "status" });
      t.setAttribute("aria-live", "polite");
      doc.body.append(t);
    }
    t.textContent = text;
    t.classList.toggle("bad", bad);
    t.hidden = false;
    t.style.animation = "none";
    void t.offsetWidth;
    t.style.animation = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 4000 : 2200);
  }

  async function copy(text, said = "Copied") {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = Object.assign(doc.createElement("textarea"), { value: text });
      t.style.position = "fixed"; t.style.opacity = "0";
      doc.body.append(t); t.select(); doc.execCommand("copy"); t.remove();
    }
    toast(said);
  }

  window.atheosMenu = {
    // Items for elements matching `selector`: fn(el, ctx) returns [{ label, icon, keys, run, href,
    // newTab, danger, disabled, checked, items }, "-", { heading }] or nothing. ctx has target,
    // selection, link and image. The nearest match comes first; "body" is for the whole app.
    add(selector, fn) {
      const p = { sel: selector, fn };
      providers.push(p);
      return () => { const i = providers.indexOf(p); if (i >= 0) providers.splice(i, 1); };
    },
    // A shortcut: one key ("n", "E", "?") or two ("g x"). `when` hides it where it can't apply.
    key(combo, label, run, { group, when } = {}) {
      const k = { combo, label, run, group, when };
      keys.push(k);
      return () => { const i = keys.indexOf(k); if (i >= 0) keys.splice(i, 1); };
    },
    // "Search for “…”" on selected text, e.g. atheosMenu.search("Search recipes for", (q) => …).
    search(label, run) { finder = { label, run }; },
    open: openAt,
    close,
    help,
    toast,
    copy,
    icons: ICON,
  };
})();
