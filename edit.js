/* The on-page editor: a pen on each section, and a form where the words are.

   Not loaded by anybody's browser unless script.js decides the viewer is an
   admin — see loadEditor() there. That is a hint, not a gate: the gate is
   /auth/me below and the guards on every route this file calls. Getting this
   file is not getting anything.

   ES5, like the rest of the front end: no build step, and it is served off the
   same static host as the page it edits. Helpers are local rather than shared
   with admin.js, because the panel's .pe-* chrome is a different visual
   language and an editor sitting inside the page should wear the page's type. */
(function () {
  "use strict";

  var ICON_PEN =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  var dirty = false;

  window.addEventListener("beforeunload", function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  /* me() is memoized in script.js, so this shares the call the sign-in button
     already made rather than asking a second time.

     Exposed, because a stale "admin" flag can load this file before there is a
     session: it gives up, and signing in afterwards calls back in here rather
     than making the author reload to get their pens. */
  window.startEditor = function () {
    me().then(function (user) {
      if (!user || user.role !== "admin") {
        try { localStorage.removeItem("admin"); } catch (err) {}
        return;
      }

      api("/admin/sections")
        .then(function (res) { return ok(res, "Could not load the sections."); })
        .then(function (data) {
          (data && data.rows ? data.rows : []).forEach(addPen);
        })
        .catch(function () {});
    });
  };

  window.startEditor();

  // ---------------------------------------------------------------------------
  // The pen
  // ---------------------------------------------------------------------------

  function addPen(row) {
    var section = document.querySelector('[data-edit="' + row.key + '"]');
    if (!section || section.querySelector(".ed-pen")) return;

    var pen = el("button", "ed-pen");
    pen.type = "button";
    pen.title = "Edit this section";
    pen.setAttribute("aria-label", "Edit the " + row.key + " section");
    pen.appendChild(iconSpan(ICON_PEN));

    // A dot means there is a saved draft the live page is not showing yet.
    if (row.hasDraft) pen.appendChild(el("span", "ed-pen__dot"));

    pen.addEventListener("click", function () { openEditor(row.key, section, pen); });
    section.appendChild(pen);
  }

  // ---------------------------------------------------------------------------
  // The editor
  // ---------------------------------------------------------------------------

  function openEditor(key, section, pen) {
    var region = section.querySelector('[data-region="' + key + '"]');
    if (!region || section.querySelector(".ed")) return;

    pen.hidden = true;

    api("/admin/sections/" + key)
      .then(function (res) { return ok(res, "Could not open that section."); })
      .then(function (data) {
        var blocks = data && data.blocks && data.blocks.length ? data.blocks : readRegion(region);
        build(key, section, region, pen, blocks);
      })
      .catch(function (err) {
        pen.hidden = false;
        alert(err.message);
      });
  }

  /* The first edit of a section has no stored draft, so the page itself is the
     source: whatever markup shipped between the markers becomes the blocks.

     data-en, not textContent. initLang() stashes the English on load and swaps
     textContent in place, so on a page that has been toggled to German
     textContent *is* the German — reading it would quietly translate the site
     into German twice and lose the English for good. */
  function readRegion(region) {
    var blocks = [];

    var h1 = region.querySelector(".hero__title");
    if (h1) blocks.push({ type: "heading", text: pairOf(h1) });

    var proses = region.querySelectorAll(".prose");
    for (var i = 0; i < proses.length; i++) {
      var ps = proses[i].querySelectorAll("p");
      var paragraphs = [];
      var muted = false;

      for (var n = 0; n < ps.length; n++) {
        if (ps[n].className.indexOf("muted") !== -1) muted = true;
        paragraphs.push(pairOf(ps[n]));
      }

      if (paragraphs.length) blocks.push({ type: "text", muted: muted, paragraphs: paragraphs });
    }

    return blocks;
  }

  function pairOf(node) {
    return {
      en: node.getAttribute("data-en") || node.textContent,
      de: node.getAttribute("data-de") || ""
    };
  }

  function build(key, section, region, pen, blocks) {
    var form = el("div", "ed");
    var rows = [];

    var body = el("div", "ed__body");
    form.appendChild(body);

    function repaint() {
      body.textContent = "";
      rows.forEach(function (r) { body.appendChild(r.root); });
    }

    function addRow(kind, value, muted) {
      var entry = fieldRow(kind, value, muted, {
        hint: rows.length === 0,
        up: function () { move(entry, -1); },
        down: function () { move(entry, 1); },
        remove: function () {
          rows.splice(rows.indexOf(entry), 1);
          repaint();
          setDirty(true);
        }
      });
      rows.push(entry);
      return entry;
    }

    function move(entry, by) {
      var i = rows.indexOf(entry);
      var to = i + by;
      if (to < 0 || to >= rows.length) return;
      rows.splice(i, 1);
      rows.splice(to, 0, entry);
      repaint();
      setDirty(true);
    }

    // The stored shape is blocks; the editor shows one flat list of fields,
    // because "a heading and some paragraphs" is what the author is actually
    // looking at. save() folds the list back into blocks.
    var seenMuted = false;
    blocks.forEach(function (block) {
      if (block.type === "heading") return addRow("heading", block.text, false);
      if (block.muted) seenMuted = true;
      (block.paragraphs || []).forEach(function (p) { addRow("text", p, block.muted); });
    });

    repaint();

    var adders = el("div", "ed__adders");
    if (!rows.some(function (r) { return r.kind === "heading"; })) {
      adders.appendChild(btn("+ heading", function () {
        var entry = addRow("heading", { en: "", de: "" }, false);
        rows.splice(rows.indexOf(entry), 1);
        rows.unshift(entry);            // a heading is only ever the first thing
        repaint();
        setDirty(true);
        entry.en.focus();
      }));
    }
    adders.appendChild(btn("+ paragraph", function () {
      var entry = addRow("text", { en: "", de: "" }, seenMuted);
      repaint();
      setDirty(true);
      entry.en.focus();
    }));
    form.appendChild(adders);

    var state = el("span", "ed__state");
    var bar = el("div", "ed__bar");
    bar.appendChild(state);
    bar.appendChild(el("span", "ed__spacer"));

    var cancel = btn("cancel", function () {
      if (dirty && !confirm("Throw away the changes you have not saved?")) return;
      close();
    });

    var save = btn("save", function () {
      run(save, "saving…", function () {
        return api("/admin/sections/" + key, { method: "PUT", body: { blocks: collect() } })
          .then(function (res) { return ok(res, "Could not save."); })
          .then(function () {
            setDirty(false);
            state.textContent = "Saved as a draft — publish to put it on the page.";
          });
      });
    });

    var publish = btn("publish", function () {
      run(publish, "publishing…", function () {
        return api("/admin/sections/" + key, { method: "PUT", body: { blocks: collect() } })
          .then(function (res) { return ok(res, "Could not save."); })
          .then(function () {
            return api("/admin/sections/" + key + "/publish", { method: "POST" });
          })
          .then(function (res) { return ok(res, "Could not publish."); })
          .then(function () {
            // Reload rather than patch the DOM: what you see next is the file
            // nginx is serving, not this file's guess at it.
            dirty = false;
            location.reload();
          });
      });
    });
    publish.className = "ed__btn ed__btn--go";

    bar.appendChild(cancel);
    bar.appendChild(save);
    bar.appendChild(publish);
    form.appendChild(bar);

    function run(button, label, work) {
      var was = button.textContent;
      button.disabled = true;
      button.textContent = label;
      work()
        .catch(function (err) { state.textContent = err.message; })
        .then(function () {
          button.disabled = false;
          button.textContent = was;
        });
    }

    function collect() {
      var blocks = [];
      var text = null;

      rows.forEach(function (r) {
        var value = r.read();
        if (r.kind === "heading") {
          if (value.en) blocks.push({ type: "heading", text: value });
          return;
        }
        if (!text) {
          text = { type: "text", muted: r.muted, paragraphs: [] };
          blocks.push(text);
        }
        text.paragraphs.push(value);
      });

      return blocks;
    }

    function setDirty(on) {
      dirty = on;
      if (on) state.textContent = "Unsaved changes";
    }

    function close() {
      dirty = false;
      form.parentNode.removeChild(form);
      region.hidden = false;
      pen.hidden = false;
    }

    form.addEventListener("input", function () { setDirty(true); });

    region.hidden = true;
    region.parentNode.insertBefore(form, region.nextSibling);
    var first = form.querySelector("textarea");
    if (first) first.focus();
  }

  // ---------------------------------------------------------------------------
  // Fields
  // ---------------------------------------------------------------------------

  function fieldRow(kind, value, muted, controls) {
    var root = el("div", "ed-row");

    var head = el("div", "ed-row__head");
    head.appendChild(el("span", "ed-row__kind", kind === "heading" ? "heading" : "paragraph"));
    head.appendChild(el("span", "ed__spacer"));
    head.appendChild(tool("▲", "Move up", controls.up));
    head.appendChild(tool("▼", "Move down", controls.down));
    head.appendChild(tool("✕", "Remove", controls.remove));
    root.appendChild(head);

    var en = area(value.en, kind === "heading" ? 1 : 3);
    var de = area(value.de, kind === "heading" ? 1 : 3);

    root.appendChild(labelled("EN", en, null));
    root.appendChild(labelled("DE", de, controls.hint ?
      "Leave empty for no German. With German the text stays plain: the " +
      "language toggle swaps text, so `code` and [links](url) would not survive it." : null));

    return {
      root: root,
      kind: kind,
      muted: muted,
      en: en,
      read: function () { return { en: en.value.trim(), de: de.value.trim() }; }
    };
  }

  function labelled(name, control, hint) {
    var wrap = el("label", "ed-field");
    wrap.appendChild(el("span", "ed-field__label", name));
    wrap.appendChild(control);
    if (hint) wrap.appendChild(el("span", "ed-field__hint", hint));
    return wrap;
  }

  /* Sized to what is in it. A paragraph of prose in a 3-row box is a box the
     author has to scroll to read their own sentence. */
  function area(value, min) {
    var node = el("textarea", "ed-field__input");
    node.value = value || "";
    node.maxLength = 4000;

    function fit() {
      node.rows = Math.max(min, Math.min(14, Math.ceil((node.value.length + 1) / 52)));
    }

    fit();
    node.addEventListener("input", fit);
    return node;
  }

  function btn(label, onClick) {
    var node = el("button", "ed__btn", label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function tool(glyph, title, onClick) {
    var node = el("button", "ed-row__tool", glyph);
    node.type = "button";
    node.title = title;
    node.setAttribute("aria-label", title);
    node.addEventListener("click", onClick);
    return node;
  }
})();
