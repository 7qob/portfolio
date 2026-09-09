/* Shared behaviour, loaded by every page. Every init below is a no-op when the
   page has none of its elements, so one file serves all of them. ES5 on
   purpose: no build step, and it has to run straight off disk over file://. */
/* ---- Language ----------------------------------------------------------
   Two languages, no dictionary file. The English is the markup; the German sits
   next to it in a data-de attribute, so a sentence and its translation are
   edited in the same place and cannot drift apart. Strings that exist only in
   JS use t(en, de) for the same reason.

   The swap is innerHTML because a data-de carries the same inline markup its
   element does. It is author-written, from this repo, exactly as trusted as the
   tag it sits on — never point it at anything a user typed. Do not nest data-de
   inside data-de: the outer swap replaces the inner element. */
/* ---- Shared builders ----------------------------------------------------
   el() already existed in admin.js with this exact signature, and this file
   hand-wrote the same three lines at forty call sites instead of borrowing
   it. Same name and same arguments in both, so moving between the two files
   does not mean changing habits. */
function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/* A decorative glyph: sized by its class, hidden from assistive tech because
   the words next to it already say what it means. The innerHTML is safe for
   the one reason innerHTML is ever safe here, and the reason is not "it is an
   icon": every string passed to this is a literal in this file. Never point
   it at anything that came from a server or a form. */
function iconSpan(className, svg) {
  var node = el("span", className);
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = svg;
  return node;
}

/* ---- Storage ------------------------------------------------------------
   Storage throws outright rather than returning null when a browser has it
   disabled, in private mode, or blocked by a third-party-cookie policy, so
   every read and write goes through these two instead of repeating the same
   try/catch at nine call sites. A site whose theme toggle throws is worse
   than a site that forgets the theme. */
function recall(area, key) {
  try { return area.getItem(key); } catch (e) { return null; }
}

function remember(area, key, value) {
  try { area.setItem(key, value); } catch (e) {}
}

var LANG_KEY = "lang";
var lang = readLang();
var langHooks = [];   // redraws for text JS wrote; markup re-swaps itself

/* The German attribute, and the attribute it stands in for. */
var LANG_ATTRS = [
  ["data-de-label", "aria-label"],
  ["data-de-alt", "alt"],
  ["data-de-title", "title"]
];

function readLang() {
  return recall(localStorage, LANG_KEY) === "de" ? "de" : "en";
}

function t(en, de) {
  return lang === "de" ? de : en;
}

function onLangChange(fn) {
  langHooks.push(fn);
}

/* Text written by JS rather than by the markup: set now, and again on a switch. */
function setText(el, en, de) {
  if (!el) return;
  var write = function () { el.textContent = t(en, de); };
  write();
  onLangChange(write);
}

function applyLang() {
  document.documentElement.setAttribute("lang", lang);

  var nodes = document.querySelectorAll("[data-de]");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.langEn === undefined) el.langEn = el.innerHTML;
    el.innerHTML = lang === "de" ? el.getAttribute("data-de") : el.langEn;
  }

  for (var a = 0; a < LANG_ATTRS.length; a++) {
    var from = LANG_ATTRS[a][0];
    var to = LANG_ATTRS[a][1];
    var cache = "langEn_" + to;
    var tagged = document.querySelectorAll("[" + from + "]");

    for (var j = 0; j < tagged.length; j++) {
      var node = tagged[j];
      if (node[cache] === undefined) node[cache] = node.getAttribute(to) || "";
      node.setAttribute(to, lang === "de" ? node.getAttribute(from) : node[cache]);
    }
  }
}

/* Built here rather than written into every page, for the same reason the
   projects filter is: without JS it could not switch anything, and a button
   that does nothing is worse than no button. */
function initLangToggle() {
  // The single page ships its own button in the markup, so there is nothing to
  // build there — only to bind. Everywhere else the button is created, for the
  // same reason the projects filter is: without JS it could switch nothing.
  var existing = document.getElementById("lang-toggle");
  var header = document.querySelector(".site-header");
  if (!existing && !header) return;

  var btn = existing || el("button", "icon-btn lang-btn");
  btn.type = "button";

  function sync() {
    // The button names the language it switches to, not the one in use.
    btn.textContent = lang === "de" ? "EN" : "DE";
    btn.setAttribute("aria-label", t("Switch to German", "Zu Englisch wechseln"));
  }
  sync();

  btn.addEventListener("click", function () {
    lang = lang === "de" ? "en" : "de";
    remember(localStorage, LANG_KEY, lang);

    applyLang();
    sync();
    for (var i = 0; i < langHooks.length; i++) langHooks[i]();
  });

  if (existing) return;   // already in the markup, and already in the right place

  /* The header's right-hand column. Every switch lives in it, so the header
     grid keeps its three tracks however many switches there are. */
  var controls = header.querySelector(".site-controls") || header;
  controls.insertBefore(btn, controls.firstChild);
}

/* Run at parse time, not on DOMContentLoaded: this file is the last thing in
   the body, so the markup is already there, and a German visitor never sees the
   English flash past. The theme does the same trick in each page's <head>. */
applyLang();

document.addEventListener("DOMContentLoaded", function () {

  var year = document.getElementById("year");
  if (year) {
    year.textContent = new Date().getFullYear();
  }

  renderContributions();
  initThemeToggle();
  initLangToggle();
  initFigures();
  initClipToggles();
  initBoxScroll();
  initProjectFilter();

  initAuth();
  initVault();
  initLogin();

  // The single page's own: the rail animation, the inline vault, the editor
  // that is only fetched for an admin, and the footer's real uptime.
  initSplitters();
  initVaultPanel();
  loadEditor();
  initUptime();
});

/* Overflow is measured, never assumed: .has-overflow drives the fade mask and
   an overflowing region gets tabindex so it can be scrolled by keyboard. */
function initBoxScroll() {
  var regions = document.querySelectorAll(".is-home .box__body, .is-home .link-box__note");
  if (!regions.length) return;

  function update(el) {
    var overflows = el.scrollHeight - el.clientHeight > 1;
    var atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

    el.classList.toggle("has-overflow", overflows);
    el.classList.toggle("is-end", overflows && atEnd);

    if (overflows) el.setAttribute("tabindex", "0");
    else el.removeAttribute("tabindex");
  }

  function updateAll() {
    for (var i = 0; i < regions.length; i++) update(regions[i]);
  }

  for (var i = 0; i < regions.length; i++) {
    (function (el) {
      el.addEventListener("scroll", function () { update(el); }, { passive: true });

      if (window.ResizeObserver) {
        new ResizeObserver(function () { update(el); }).observe(el);
      }
    })(regions[i]);
  }

  updateAll();
  if (!window.ResizeObserver) window.addEventListener("resize", updateAll);
}

function initFigures() {
  var imgs = document.querySelectorAll(
    ".figure img, .mediarow img, .mediarow video, .project-card__shot img"
  );
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    var hide = (function (image) {
      return function () {
        var fig = image.closest(".figure, .mediarow");
        /* A card cover that 404s leaves the card, not the other way round: the
           project still belongs in the index, it has just lost its picture.
           Removing it uncovers the .shot-plate underneath, so the grid keeps
           its rhythm instead of dropping a cell. */
        if (!fig) return image.remove();
        fig.hidden = true;

        var band = image.closest(".reveal");
        if (band && !band.querySelector(".mediarow:not([hidden])")) {
          band.hidden = true;
        }
      };
    })(img);
    if (img.complete && img.naturalWidth === 0) hide();
    else img.addEventListener("error", hide);
  }
}

/* Projects index filter. The technologies come out of the chips already in the
   cards, so the list is never maintained twice, and the bar is only built when
   there is something to choose between — no JS, no bar, whole grid. */
/* Two columns and a wide first card leave a hole whenever an even number of
   cards is on screen: the last one would sit alone in its row. It takes the
   width instead. Measured from what is actually showing, so a filter that
   hides two cards closes the grid again rather than punching a gap in it. */
function layoutCards(rows) {
  var shown = [];
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.remove("project-card--wide");
    if (!rows[i].hidden) shown.push(rows[i]);
  }
  if (!shown.length) return;

  shown[0].classList.add("project-card--wide");
  if (shown.length % 2 === 0) shown[shown.length - 1].classList.add("project-card--wide");
}

function initProjectFilter() {
  var list = document.querySelector(".project-grid");
  if (!list) return;

  var rows = list.querySelectorAll(".project-card");
  layoutCards(rows);
  if (rows.length < 2) return;

  var techs = [];      // every distinct chip label, in reading order
  var owned = [];      // parallel to rows: the labels each row carries

  for (var i = 0; i < rows.length; i++) {
    var chips = rows[i].querySelectorAll(".chips .chip");
    var mine = [];
    for (var j = 0; j < chips.length; j++) {
      var text = chips[j].textContent.trim();
      if (!text || mine.indexOf(text) !== -1) continue;
      mine.push(text);
      if (techs.indexOf(text) === -1) techs.push(text);
    }
    owned.push(mine);
  }
  if (techs.length < 2) return;

  /* How many cards each technology would leave showing. Written on the chip,
     so the cost of a filter is legible before it is paid rather than after. */
  function countFor(tech) {
    if (tech === "") return rows.length;
    var n = 0;
    for (var i = 0; i < owned.length; i++) if (owned[i].indexOf(tech) !== -1) n++;
    return n;
  }

  var bar = el("div", "project-filter");

  var toggle = el("button", "project-filter__toggle");
  toggle.type = "button";
  toggle.id = "project-filter-label";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "project-filter-chips");

  // "Filter" is the same word in both languages, so it never needs redrawing.
  var state = el("span", "project-filter__state");
  toggle.appendChild(el("span", "project-filter__word", "Filter"));
  toggle.appendChild(state);
  toggle.appendChild(iconSpan("project-filter__mark", ICON_CHEVRON));
  bar.appendChild(toggle);

  var chipList = el("ul", "chips");
  chipList.id = "project-filter-chips";
  chipList.setAttribute("aria-labelledby", "project-filter-label");
  chipList.hidden = true;
  bar.appendChild(chipList);

  var buttons = [];
  var active = "";

  /* Only whether the panel is open is remembered. The filter itself is not:
     coming back to a page that silently hides most of it is a bug report
     waiting to happen, and the panel state costs nothing to be wrong about. */
  var OPEN_KEY = "projectFilterOpen";

  function setOpen(open) {
    chipList.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    remember(localStorage, OPEN_KEY, open ? "1" : "0");
  }

  function isOpen() {
    return toggle.getAttribute("aria-expanded") === "true";
  }

  /* The collapsed bar still says what is on. Without this the panel could be
     shut over an active filter and the grid would look like the whole set. */
  function syncState() {
    state.textContent = (active === "" ? t("All", "Alle") : active) +
                        " · " + countFor(active);
    bar.classList.toggle("is-filtered", active !== "");
    toggle.setAttribute("aria-label", active === ""
      ? t("Filter projects, showing all", "Projekte filtern, alle werden gezeigt")
      : t("Filter projects, showing ", "Projekte filtern, gezeigt wird ") + active);
  }

  /* Clicking the chip that is already on clears it, so the filter can always
     be undone where it was set rather than only from the All chip. */
  function apply(tech) {
    active = tech === active ? "" : tech;
    for (var i = 0; i < rows.length; i++) {
      rows[i].hidden = active !== "" && owned[i].indexOf(active) === -1;
    }
    for (var k = 0; k < buttons.length; k++) {
      var on = buttons[k].getAttribute("data-tech") === active;
      buttons[k].setAttribute("aria-pressed", on ? "true" : "false");
    }
    syncState();
    layoutCards(rows);
  }

  function addChip(tech, label) {
    var chip = el("button", "chip chip--filter");
    chip.type = "button";
    chip.setAttribute("data-tech", tech);
    chip.setAttribute("aria-pressed", "false");

    var name = el("span", null, label);
    chip.appendChild(name);
    chip.appendChild(el("span", "chip__count", countFor(tech)));
    chip.addEventListener("click", function () { apply(tech); });

    var item = el("li");
    item.appendChild(chip);
    chipList.appendChild(item);
    buttons.push(chip);
    return name;
  }

  var allLabel = addChip("", t("All", "Alle"));

  /* The technologies are product names — React, Rust — so they read the same
     in either language and are never translated. */
  for (var n = 0; n < techs.length; n++) addChip(techs[n], techs[n]);

  toggle.addEventListener("click", function () { setOpen(!isOpen()); });

  /* Escape backs out one step at a time: the filter first, then the panel. */
  bar.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" && e.keyCode !== 27) return;
    if (active !== "") apply(active);
    else setOpen(false);
    toggle.focus();
  });

  onLangChange(function () {
    allLabel.textContent = t("All", "Alle");
    syncState();
  });

  var wasOpen = recall(localStorage, OPEN_KEY) === "1";

  list.parentNode.insertBefore(bar, list);
  setOpen(wasOpen);
  apply("");
}

function initClipToggles() {
  var frames = document.querySelectorAll(".mediarow__frame");
  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (var i = 0; i < frames.length; i++) {
    (function (frame) {
      var video = frame.querySelector("video");
      if (!video) return;

      var toggle = frame.querySelector("[data-clip-toggle]");
      var full = frame.querySelector("[data-clip-fullscreen]");
      var fill = frame.querySelector("[data-clip-fill]");

      if (toggle) {
        var pause = toggle.querySelector('[data-clip-icon="pause"]');
        var play = toggle.querySelector('[data-clip-icon="play"]');

        var syncPlay = function () {
          pause.hidden = video.paused;
          play.hidden = !video.paused;
          toggle.setAttribute("aria-label", video.paused
            ? t("Play clip", "Clip abspielen")
            : t("Pause clip", "Clip pausieren"));
        };
        onLangChange(syncPlay);

        toggle.addEventListener("click", function () {
          if (video.paused) video.play();
          else video.pause();
        });

        video.addEventListener("play", syncPlay);
        video.addEventListener("pause", syncPlay);

        if (still) {
          video.autoplay = false;
          video.pause();
        }
        syncPlay();
      }

      if (full) {
        var enter = full.querySelector('[data-clip-icon="enter"]');
        var exit = full.querySelector('[data-clip-icon="exit"]');

        var syncFull = function () {
          var on = document.fullscreenElement === frame;
          enter.hidden = on;
          exit.hidden = !on;
          full.setAttribute("aria-label", on
            ? t("Exit fullscreen", "Vollbild verlassen")
            : t("Fullscreen", "Vollbild"));
        };
        onLangChange(syncFull);

        full.addEventListener("click", function () {
          if (document.fullscreenElement === frame) document.exitFullscreen();
          else if (frame.requestFullscreen) frame.requestFullscreen();
        });

        document.addEventListener("fullscreenchange", syncFull);
        syncFull();
      }

      if (fill) {
        video.addEventListener("timeupdate", function () {
          var d = video.duration;
          fill.style.width = d ? (video.currentTime / d) * 100 + "%" : 0;
        });
      }
    })(frames[i]);
  }
}

var API_BASE = "/api";

function api(path, options) {
  var opts = options || {};
  var headers = { "X-Requested-With": "fetch" };

  var isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;

  if (opts.body && !isForm) headers["Content-Type"] = "application/json";
  if (opts.headers) {
    for (var key in opts.headers) headers[key] = opts.headers[key];
  }

  return fetch(API_BASE + path, {
    method: opts.method || "GET",
    credentials: "same-origin",
    headers: headers,
    body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined
  });
}

/* No API here: over file:// or on GitHub Pages the backend does not exist, and
   a failed call would replace a working static page with an error. */
function isOffline() {
  return location.protocol === "file:" ||
         /(^|\.)github\.io$/.test(location.hostname);
}

/* Who is signed in, once /auth/me has answered. The vault names them in its
   guard bar, and one call serves both rather than each page asking again. */
var authUser = null;
var authHooks = [];

function onAuth(fn) {
  if (authUser) fn(authUser);
  else authHooks.push(fn);
}

function initAuth() {
  // Only where there is a header to decorate. Every onAuth consumer lives on a
  // page that has one; the single page has its own session button instead, and
  // asking here would put an API call on every anonymous visit to buy nothing.
  if (isOffline() || !document.querySelector(".site-nav")) return;

  me().then(function (user) {
    if (!user) return;
    authUser = user;
    showSignedIn(authUser);
    for (var i = 0; i < authHooks.length; i++) authHooks[i](authUser);
    authHooks = [];
  });
}

function showSignedIn(user) {
  var nav = document.querySelector(".site-nav");
  if (!nav) return;

  if (user.role === "admin" && !nav.querySelector("[data-admin-link]")) {
    var admin = el("a", null, "Admin");
    admin.href = "/admin.html";
    admin.setAttribute("data-admin-link", "");
    if (location.pathname === "/admin.html") admin.setAttribute("aria-current", "page");
    nav.appendChild(admin);
  }

  var header = nav.parentNode;
  if (header && !header.querySelector("[data-signout]")) {
    var out = el("button", "icon-btn site-header__signout");
    out.type = "button";
    var nameOut = function () {
      out.title = t("Sign out", "Abmelden");
      out.setAttribute("aria-label", out.title);
    };
    nameOut();
    onLangChange(nameOut);
    out.setAttribute("data-signout", "");
    out.innerHTML = ICON_DOOR;
    out.addEventListener("click", function () {
      api("/auth/logout", { method: "POST" })
        .then(function () { location.href = "/index.html"; })
        .catch(function () { location.href = "/index.html"; });
    });
    var controls = header.querySelector(".site-controls") || header;
    controls.appendChild(out);
  }
}

/* ---- The Vault ----------------------------------------------------------
   Three things are sensitive on this page, and they are not the same thing.

   1. Whether a document exists. That never leaves the server unauthenticated:
      the markup ships empty and /api/vault/items answers a session or nothing.
      Already true, and the reason vault/index.html has no rows in it.
   2. What a document is called. "Zeugnis Sek II" tells a bystander, a screen
      share or a beamer what the file is without anyone getting past the
      password, and the list sits open on screen far longer than it is read.
      So the names arrive and are not painted: each row wears a redaction bar
      until the visitor asks, and asking is one click.
   3. Who read what. That one is handled by saying so: the guard bar states
      that every download is recorded, because it is.

   The cover is display, not access. A revealed list lasts the tab and not the
   machine (sessionStorage, never localStorage), and covers itself again once
   the tab has been away long enough to have been left rather than glanced
   away from. */

var VAULT_REVEAL_KEY = "vaultRevealed";

/* Long enough that switching tabs to copy an email address is not punished,
   short enough that a walk to the coffee machine is. A cover that fires on
   every blur gets revealed once and resented; this one is rarely wrong. */
var VAULT_RECOVER_MS = 20000;

/* ---- Icons --------------------------------------------------------------
   One block rather than two scattered ones, all from the same 24x24 stroked
   set, all sized by the class of the span that holds them rather than by a
   width attribute. The stylesheet has a single rule that makes an svg fill
   its span, so a new glyph needs no CSS of its own. */
var ICON_DOC = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
var ICON_DOWN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
var ICON_EYE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
var ICON_EYE_OFF = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
var ICON_CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
var ICON_MOON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
var ICON_SUN = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
var ICON_DOOR = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

/* The bar stands for the title without measuring it. Quantised to steps of
   four and capped, so a long name and a longer one look the same, while the
   rows still vary enough not to read as a column of identical smudges. */
function redactionBar(text) {
  var len = Math.min(Math.max(Math.round((text || "").length / 4) * 4, 8), 24);
  return new Array(len + 1).join("\u2588");
}

function initVault() {
  var list = document.getElementById("vault-list");
  var status = document.getElementById("vault-status");
  var guard = document.getElementById("vault-guard");
  var actions = document.getElementById("vault-actions");
  if (!list) return;

  if (isOffline()) {
    setText(status,
      "The Vault needs the live site. It cannot be opened from a local file.",
      "Der Vault braucht die Live-Seite. Aus einer lokalen Datei l\u00e4sst er sich nicht \u00f6ffnen.");
    return;
  }

  api("/vault/items")
    .then(function (res) {
      if (res.status === 401) {
        location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
        throw new Error("redirecting");
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      var items = (data && data.items) || [];

      if (!items.length) {
        setText(status, "No documents are published right now.",
                        "Zurzeit sind keine Dokumente ver\u00f6ffentlicht.");
        return;
      }

      var ready = 0;    // documents with a file behind them
      var bytes = 0;
      items.forEach(function (item) {
        if (!item.available) return;
        ready++;
        bytes += item.sizeBytes || 0;
      });

      var revealed = recall(sessionStorage, VAULT_REVEAL_KEY) === "1";

      var note = el("p", "doc-guard__note");

      var eye = el("button", "doc-guard__btn");
      eye.type = "button";
      eye.setAttribute("aria-controls", "vault-list");
      eye.addEventListener("click", function () { setRevealed(!revealed); });

      var eyeMark = iconSpan("doc-guard__mark", "");
      var eyeWord = el("span");

      eye.appendChild(eyeMark);
      eye.appendChild(eyeWord);
      guard.appendChild(note);
      guard.appendChild(eye);
      guard.hidden = false;

      /* Count and size are not sensitive and stay legible while the names are
         covered: a visitor needs to know there is something worth fetching
         before deciding whether to uncover anything. */
      function drawGuard() {
        var who = authUser ? authUser.username : "";
        var count = items.length + " " + (items.length === 1
          ? t("document", "Dokument")
          : t("documents", "Dokumente"));

        note.textContent =
          (who ? t("Signed in as ", "Angemeldet als ") + who + " \u00b7 " : "") +
          count + " \u00b7 " +
          t("every download is recorded.", "jeder Download wird protokolliert.");

        eyeMark.innerHTML = revealed ? ICON_EYE_OFF : ICON_EYE;
        eyeWord.textContent = revealed
          ? t("Cover names", "Namen verdecken")
          : t("Show names", "Namen zeigen");
        eye.setAttribute("aria-pressed", revealed ? "true" : "false");
      }

      /* One file per document means a reader clicking six times and answering
         six save dialogs. The archive is built server-side and logs a download
         per document, so the record stays as detailed as it was. */
      function drawActions() {
        if (ready < 2) return;
        actions.textContent = "";

        var size = formatBytes(bytes);
        var all = el("a", "doc-all");
        all.href = API_BASE + "/vault/archive";
        all.setAttribute("download", "vault-documents.zip");

        all.appendChild(iconSpan("doc-all__icon", ICON_DOWN));
        all.appendChild(el("span", "doc-all__label",
          t("Download all", "Alle herunterladen")));
        all.appendChild(el("span", "doc-all__meta",
          "ZIP \u00b7 " + ready + " " + t("files", "Dateien") +
          (size ? " \u00b7 " + size : "")));

        actions.appendChild(all);
        actions.hidden = false;
      }

      /* Redrawn rather than relabelled on a switch: a row carries a size, a
         state and a cover, and rebuilding it is shorter than reaching into
         each part. */
      function draw() {
        list.textContent = "";
        items.forEach(function (item) {
          list.appendChild(vaultRow(item, revealed));
        });
        drawGuard();
        drawActions();
      }

      function setRevealed(on) {
        revealed = on;
        remember(sessionStorage, VAULT_REVEAL_KEY, on ? "1" : "0");
        draw();
        eye.focus();
      }

      var leftAt = 0;
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) { leftAt = Date.now(); return; }
        if (revealed && leftAt && Date.now() - leftAt > VAULT_RECOVER_MS) {
          revealed = false;
          remember(sessionStorage, VAULT_REVEAL_KEY, "0");
          draw();
        }
      });

      draw();
      onLangChange(draw);
      onAuth(drawGuard);

      list.hidden = false;
      if (status) status.remove();
    })
    .catch(function (err) {
      if (err && err.message === "redirecting") return;
      setText(status, "The document list could not be loaded. Please reload.",
                      "Die Dokumentliste konnte nicht geladen werden. Bitte neu laden.");
    });
}

function vaultRow(item, revealed) {
  var li = el("li", "doc" + (revealed ? "" : " doc--covered") +
                    (item.available ? "" : " doc--missing"));

  /* An anchor when there is a file behind it, a span when there is not: a
     link that goes nowhere is worse than a row that is plainly inert. */
  var row = el(item.available ? "a" : "span", "doc__link");
  if (item.available) row.href = API_BASE + "/vault/items/" + item.id + "/file";

  var size = item.available ? formatBytes(item.sizeBytes) : "";

  row.appendChild(iconSpan("doc__icon", ICON_DOC));
  row.appendChild(fillCovered(el("span", "doc__name"), item.title, revealed));
  row.appendChild(el("span", "doc__meta", item.available
    ? (size ? "PDF \u00b7 " + size : "PDF")
    : t("Not uploaded", "Nicht hochgeladen")));

  if (item.description) {
    row.appendChild(fillCovered(el("span", "doc__desc"), item.description, revealed));
  }

  if (item.available) row.appendChild(iconSpan("doc__arrow", ICON_DOWN));

  li.appendChild(row);
  return li;
}

/* Covered on screen, intact to a screen reader. The bar is what a room can
   see; the words still reach assistive tech, which is read to one person
   through an earpiece rather than shown to everyone standing behind them.
   Covering it there would take the row's only meaning away and protect nobody. */
function fillCovered(node, text, revealed) {
  if (revealed) {
    node.textContent = text;
    return node;
  }

  var bar = el("span", "doc__redaction", redactionBar(text));
  bar.setAttribute("aria-hidden", "true");

  node.appendChild(bar);
  node.appendChild(el("span", "visually-hidden", text));
  return node;
}

function initLogin() {
  var form = document.getElementById("login-form");
  if (!form) return;

  var error = document.getElementById("login-error");
  var submit = document.getElementById("login-submit");
  var next = safeNext(new URLSearchParams(location.search).get("next"));

  if (isOffline()) {
    showLoginError(error, t(
      "Signing in needs the live site. It cannot be done from a local file.",
      "Die Anmeldung braucht die Live-Seite. Aus einer lokalen Datei geht sie nicht."));
    if (submit) submit.disabled = true;
    return;
  }

  api("/auth/me").then(function (res) {
    if (res.ok) location.replace(next);
  }).catch(function () {});

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var username = form.username.value.trim();
    var password = form.password.value;

    if (!username || !password) {
      showLoginError(error, t("Enter both a username and a password.",
                              "Bitte Benutzername und Passwort eingeben."));
      return;
    }

    if (error) error.hidden = true;
    if (submit) {
      submit.disabled = true;
      submit.textContent = t("Signing in…", "Anmeldung läuft…");
    }

    api("/auth/login", { method: "POST", body: { username: username, password: password } })
      .then(function (res) {
        if (res.ok) {
          location.replace(next);
          return null;
        }
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(loginMessage(res.status, body));
        });
      })
      .catch(function (err) {
        showLoginError(error, err.message ||
          t("Something went wrong. Please try again.",
            "Etwas ist schiefgelaufen. Bitte nochmals versuchen."));
        form.password.value = "";
        form.password.focus();
      })
      .finally(function () {
        if (submit) {
          submit.disabled = false;
          submit.textContent = t("Sign in", "Anmelden");
        }
      });
  });
}

function loginMessage(status, body) {
  if (status === 429) {
    /* The server's message carries the wait, so it wins over ours — and it is
       the one string on this page the site cannot translate. */
    return (body && body.message) ||
      t("Too many attempts. Please wait and try again.",
        "Zu viele Versuche. Bitte kurz warten und nochmals versuchen.");
  }
  if (status === 401) {
    return t("Invalid username or password.", "Benutzername oder Passwort ist falsch.");
  }
  if (status === 400) {
    return t("Please check the form and try again.",
             "Bitte die Eingaben prüfen und nochmals versuchen.");
  }
  return t("Sign-in is unavailable right now. Please try again shortly.",
           "Die Anmeldung ist gerade nicht verfügbar. Bitte in Kürze nochmals versuchen.");
}

function showLoginError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function safeNext(raw) {
  var fallback = "/vault/";
  if (!raw || raw.charAt(0) !== "/") return fallback;
  if (raw.charAt(1) === "/" || raw.charAt(1) === "\\") return fallback;
  return raw;
}

function formatBytes(value) {
  var bytes = parseInt(value, 10);
  if (!isFinite(bytes) || bytes <= 0) return "";

  var units = ["B", "KB", "MB"];
  var u = 0;
  while (bytes >= 1024 && u < units.length - 1) {
    bytes /= 1024;
    u++;
  }
  return (u > 0 && bytes < 10 ? bytes.toFixed(1) : Math.round(bytes)) + " " + units[u];
}

function initThemeToggle() {
  var root = document.documentElement;
  var toggle = document.getElementById("theme-toggle");
  var icon = toggle && toggle.querySelector("[data-theme-icon], .link-box__icon");

  function apply(light) {
    root.classList.toggle("light", light);
    if (icon) icon.innerHTML = light ? ICON_SUN : ICON_MOON;
    if (toggle) toggle.setAttribute("aria-pressed", String(light));
  }

  apply(recall(localStorage, "theme") === "light");

  if (!toggle) return;

  toggle.addEventListener("click", function () {
    var light = !root.classList.contains("light");
    apply(light);
    remember(localStorage, "theme", light ? "light" : "dark");
  });
}

var GH_CACHE_KEY = "gh:contributions:v1";
var GH_CACHE_TTL = 6 * 60 * 60 * 1000;   // 6h — the source updates daily at best
var GH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var GH_MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
                    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
var GH_ROWS = 7;                         // days in a column

function renderContributions() {
  var root = document.getElementById("gh");
  if (!root) return;

  // The handle lives in the markup only; no copy of it here to drift.
  var user = root.getAttribute("data-gh-user");
  if (!user) return;

  var cached = ghReadCache(user);

  if (cached) ghDraw(root, cached.days);
  if (cached && Date.now() - cached.ts < GH_CACHE_TTL) return;

  ghFetch(user)
    .then(function (days) {
      ghWriteCache(user, days);
      ghDraw(root, days);
    })
    .catch(function (err) {
      console.error("GitHub contributions failed to load:", err);
      if (!cached) ghError(root);
    });
}

function ghFetch(user) {
  var url = "https://github-contributions-api.jogruber.de/v4/" +
            encodeURIComponent(user) + "?y=last";

  return fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      var days = (data && data.contributions) || [];
      if (!days.length) throw new Error("no contribution data");
      return days;
    });
}

function ghReadCache(user) {
  try {
    var v = JSON.parse(localStorage.getItem(GH_CACHE_KEY));
    if (!v || v.user !== user || !v.days || !v.days.length) return null;
    return v;
  } catch (e) {
    return null;   // absent, corrupt, or blocked — all mean "no cache"
  }
}

function ghWriteCache(user, days) {
  try {
    localStorage.setItem(GH_CACHE_KEY, JSON.stringify({
      user: user, ts: Date.now(), days: days
    }));
  } catch (e) {}   // private mode or quota; the graph works without a cache
}

function ghDate(s) {
  return new Date(s + "T00:00:00");
}

function ghWhen(date) {
  var d = ghDate(date);
  if (lang === "de") {
    return d.getDate() + ". " + GH_MONTHS_DE[d.getMonth()] + " " + d.getFullYear();
  }
  return d.getDate() + " " + GH_MONTHS[d.getMonth()] + " " + d.getFullYear();
}

function ghDayText(date, count) {
  var when = ghWhen(date);
  if (!count) return t("No contributions on " + when, "Keine Beiträge am " + when);
  return count + t(count === 1 ? " contribution on " : " contributions on ",
                   count === 1 ? " Beitrag am " : " Beiträge am ") + when;
}

/* Days padded front and back to whole Sunday-first weeks, so a slice at any
   multiple of 7 is still a week boundary. */
function ghSlots(days) {
  var slots = [];
  var lead = ghDate(days[0].date).getDay();

  for (var i = 0; i < lead; i++) slots.push(null);
  for (var j = 0; j < days.length; j++) slots.push(days[j]);
  while (slots.length % GH_ROWS) slots.push(null);

  return slots;
}

/* How many weeks the card can hold, measured rather than assumed: square cells
   that fill the height decide it. Fewer than the year — the oldest weeks are
   dropped rather than squeezed into slivers. More room than weeks — the count
   stands and the 1fr columns stretch, which is what keeps the grid flush. */
function ghWeeks(chart, total) {
  var box = chart.getBoundingClientRect();
  if (!box.width || !box.height) return total;

  var gap = parseFloat(getComputedStyle(chart).getPropertyValue("--gh-gap")) || 0;
  var cell = (box.height - (GH_ROWS - 1) * gap) / GH_ROWS;
  if (cell <= 0) return total;

  return Math.max(1, Math.min(total, Math.floor((box.width + gap) / (cell + gap))));
}

function ghLabel(slots) {
  var total = 0, first = null, last = null;

  for (var i = 0; i < slots.length; i++) {
    if (!slots[i]) continue;
    total += slots[i].count;
    if (!first) first = slots[i].date;
    last = slots[i].date;
  }

  var sum = total.toLocaleString(t("en-US", "de-CH"));
  return sum + t(" contributions, ", " Beiträge, ") +
         ghWhen(first) + t(" to ", " bis ") + ghWhen(last);
}

/* The graph is the whole widget: no month ruler, no weekday column, no legend,
   so the cells get the entire box. What day a cell is comes from its tooltip. */
function ghDraw(root, days) {
  var chart = root.querySelector("[data-gh-chart]");
  if (!chart) return;

  var slots = ghSlots(days);
  var weeks = ghWeeks(chart, slots.length / GH_ROWS);
  if (weeks < slots.length / GH_ROWS) {
    slots = slots.slice(slots.length - weeks * GH_ROWS);
  }

  var cells = el("div", "gh-cells");
  cells.style.setProperty("--gh-weeks", String(weeks));
  cells.setAttribute("role", "img");
  cells.setAttribute("aria-label", ghLabel(slots));

  slots.forEach(function (d) {
    var cell = el("span", "gh-cell");
    if (!d) {
      cell.className = "gh-cell gh-cell--pad";
    } else {
      cell.setAttribute("data-level", d.level);
      cell.setAttribute("data-date", d.date);
      cell.setAttribute("data-count", d.count);
    }
    cells.appendChild(cell);
  });

  chart.textContent = "";
  chart.appendChild(cells);

  ghTooltip(root, cells);
  ghWatch(root, days);
}

/* The week count is a function of the card's size, so it is recomputed when the
   card resizes — once per element, and only when the count actually moves. */
function ghWatch(root, days) {
  root.ghDays = days;

  /* Every date and count in the graph is written by JS, so a switch redraws it
     from the days already in hand rather than fetching them again. */
  if (!root.ghLangHook) {
    root.ghLangHook = true;
    onLangChange(function () {
      if (root.ghDays) ghDraw(root, root.ghDays);
    });
  }

  if (root.ghObserver || !window.ResizeObserver) return;

  var chart = root.querySelector("[data-gh-chart]");
  if (!chart) return;

  root.ghObserver = new ResizeObserver(function () {
    var cells = chart.querySelector(".gh-cells");
    if (!cells) return;

    var total = ghSlots(root.ghDays).length / GH_ROWS;
    if (ghWeeks(chart, total) !== Number(cells.style.getPropertyValue("--gh-weeks"))) {
      ghDraw(root, root.ghDays);
    }
  });
  root.ghObserver.observe(chart);
}

function ghTooltip(root, cells) {
  var tip = root.querySelector(".gh__tip");
  if (!tip) {
    tip = el("span", "gh__tip");
    root.appendChild(tip);
  }
  tip.hidden = true;

  cells.addEventListener("mouseover", function (e) {
    var cell = e.target.closest(".gh-cell[data-date]");
    if (!cell) return;

    tip.textContent = ghDayText(cell.getAttribute("data-date"),
                                Number(cell.getAttribute("data-count")));
    tip.hidden = false;

    var c = cell.getBoundingClientRect();
    var box = root.getBoundingClientRect();
    var x = c.left - box.left + c.width / 2;

    tip.style.left = Math.max(4, Math.min(x, box.width - 4)) + "px";
    tip.style.top = (c.top - box.top) + "px";
  });

  cells.addEventListener("mouseleave", function () {
    tip.hidden = true;
  });
}

function ghError(root) {
  var chart = root.querySelector("[data-gh-chart]");
  if (!chart) return;

  chart.textContent = "";

  var msg = el("p", "gh__status");

  /* The words are their own element: setText writes textContent, which would
     take the retry button with it on a language switch. */
  var words = el("span");
  setText(words, "Activity unavailable.", "Aktivität nicht verfügbar.");
  msg.appendChild(words);

  var retry = el("button", "gh__retry");
  retry.type = "button";
  setText(retry, "Retry", "Erneut versuchen");
  retry.addEventListener("click", function () {
    chart.textContent = "";
    chart.appendChild(el("p", "gh__status",
      t("Loading activity…", "Aktivität wird geladen…")));
    renderContributions();
  });

  msg.appendChild(document.createTextNode(" "));
  msg.appendChild(retry);
  chart.appendChild(msg);
}

var ICON_SIGN_IN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
var ICON_SIGN_OUT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 5 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
var ICON_FILE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
var ICON_DOWNLOAD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

/* One /auth/me per page load, shared by the sign-in button and edit.js. */
var mePromise = null;

/* Response -> value, or an Error carrying what the server said. 204 and an
   unreadable body both become null rather than a throw. */
function ok(res, fallback) {
  if (res.ok) return res.status === 204 ? null : res.json().catch(function () { return null; });
  return res.json().then(
    function (b) { throw new Error(b.message || fallback); },
    function () { throw new Error(fallback); }
  );
}

/** Signing in or out makes the memoized answer wrong; drop it. */
function forgetMe() {
  mePromise = null;
}

function me() {
  if (!mePromise) {
    mePromise = api("/auth/me")
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { return (data && data.user) || null; })
      .catch(function () { return null; });
  }
  return mePromise;
}

function initVaultPanel() {
  var locked = document.getElementById("vault-locked");
  if (!locked) return;

  var form = document.getElementById("vault-form");
  var open = document.getElementById("vault-open");
  var list = document.getElementById("vault-open-list");
  var status = document.getElementById("vault-status");
  var error = document.getElementById("vault-error");
  var toggle = document.getElementById("session-toggle");

  if (isOffline()) {
    status.textContent = "The vault needs the live site. It cannot be opened from a local file.";
    open.hidden = true;
    return;
  }

  function showForm(on) {
    form.hidden = !on;
    open.hidden = on;
    if (on) document.getElementById("vault-user").focus();
  }

  function signedIn(on) {
    list.hidden = !on;
    locked.hidden = on;

    if (!toggle) return;
    toggle.setAttribute("aria-label", on ? "Sign out" : "Sign in");
    toggle.title = on ? "Sign out" : "Sign in";

    var icon = toggle.querySelector("[data-session-icon]");
    if (icon) icon.innerHTML = on ? ICON_SIGN_OUT : ICON_SIGN_IN;
  }

  function openVault() {
    return api("/vault/items")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        vaultDocs((data && data.items) || []);
        remember(localStorage, "vault:seen", "1");
        signedIn(true);
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function signOut() {
    api("/auth/logout", { method: "POST" })
      .catch(function () {})
      .then(function () {
        forgetMe();
        try {
          localStorage.removeItem("vault:seen");
          localStorage.removeItem("admin");
        } catch (e) {}
        document.getElementById("vault-docs").textContent = "";
        signedIn(false);
        showForm(false);
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var username = document.getElementById("vault-user").value.trim();
    var password = document.getElementById("vault-pass").value;
    if (!username || !password) return;

    error.textContent = "Signing in…";

    api("/auth/login", { method: "POST", body: { username: username, password: password } })
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        // The response says which role signed in. Remembering it is what
        // decides whether edit.js is ever fetched, so a visitor never pays for
        // an editor they cannot open.
        return res.json()
          .catch(function () { return null; })
          .then(function (data) {
            forgetMe();
            if (data && data.user && data.user.role === "admin") {
              remember(localStorage, "admin", "1");
              loadEditor();
            }
            return openVault();
          });
      })
      .then(function () {
        error.textContent = "";
        document.getElementById("vault-pass").value = "";
      })
      .catch(function (err) {
        error.textContent = err.message === "401"
          ? "Those details did not work."
          : err.message === "429"
            ? "Too many attempts. Please wait and try again."
            : "The service is not reachable right now.";
        document.getElementById("vault-pass").value = "";
      });
  });

  open.addEventListener("click", function () { showForm(true); });
  document.getElementById("vault-signout").addEventListener("click", signOut);

  if (toggle) {
    toggle.addEventListener("click", function () {
      if (!list.hidden) return signOut();
      showForm(true);
      document.getElementById("vault").scrollIntoView({ block: "center" });
    });
  }

  if (recall(localStorage, "vault:seen")) openVault();   // a returning cookie, not a stored login
}

function vaultDocs(items) {
  var box = document.getElementById("vault-docs");
  box.textContent = "";

  if (!items.length) {
    box.appendChild(el("p", "muted", "Nothing has been shared with this account yet."));
    return;
  }

  items.forEach(function (item) {
    var row = el(item.available ? "a" : "span", "doc");
    if (item.available) row.href = API_BASE + "/vault/items/" + item.id + "/file";

    row.appendChild(iconSpan("icon", ICON_FILE));
    row.appendChild(el("b", null, item.title));

    var size = item.available ? formatBytes(item.sizeBytes) : "";
    row.appendChild(el("span", "doc__size",
      item.available ? (size ? "PDF · " + size : "PDF") : "not uploaded"));

    box.appendChild(row);
  });
}

function loadEditor() {
  if (isOffline()) return;
  if (!document.querySelector("[data-edit]")) return;
  if (recall(localStorage, "admin") !== "1" && !/[?#]edit\b/.test(location.href)) return;

  // Already there: a stale flag loaded it before the session existed, and it
  // gave up. Signing in is the second chance, not a reason to fetch it twice.
  if (window.startEditor) return window.startEditor();
  if (document.getElementById("edit-js")) return;

  var tag = document.createElement("script");
  tag.id = "edit-js";
  tag.src = "edit.js";
  document.body.appendChild(tag);
}

/* Real seconds from /api/health, never a number invented in the browser. The
   call is unauthenticated and the footer simply stays without it on failure. */
function initUptime() {
  var out = document.getElementById("uptime");
  if (!out || isOffline()) return;

  api("/health")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || typeof data.uptimeSeconds !== "number") return;

      var started = Date.now() - data.uptimeSeconds * 1000;
      out.hidden = false;

      function tick() {
        out.textContent = " · uptime " + elapsed(started);
      }

      tick();
      setInterval(tick, 1000);
    })
    .catch(function () {});
}

function elapsed(since) {
  var s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  var d = Math.floor(s / 86400); s %= 86400;
  var h = Math.floor(s / 3600);  s %= 3600;
  var m = Math.floor(s / 60);    s %= 60;

  function pad(n) { return n < 10 ? "0" + n : String(n); }
  return d + "d " + pad(h) + "h " + pad(m) + "m " + pad(s) + "s";
}

function initSplitters() {
  var splits = document.querySelectorAll(".split");
  if (!splits.length) return;

  if (!window.IntersectionObserver) {
    for (var i = 0; i < splits.length; i++) splits[i].classList.add("is-in");
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      entries[i].target.classList.add("is-in");
      io.unobserve(entries[i].target);
    }
  }, { threshold: 0.6 });

  for (var j = 0; j < splits.length; j++) io.observe(splits[j]);
}
