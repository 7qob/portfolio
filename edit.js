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
    pen.appendChild(iconSpan("icon", ICON_PEN));

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
        build(key, section, region, pen, blocks, !!(data && data.published));
      })
      .catch(function (err) {
        pen.hidden = false;
        alert(err.message);
      });
  }

  /* The first edit of a section has no stored draft, so the page itself is the
     source: whatever markup shipped between the markers becomes the blocks.

     applyLang() caches the English innerHTML on the element as `langEn` and
     then overwrites innerHTML in place, so on a page toggled to German the
     element's own content *is* the German. Reading langEn rather than the live
     content is what stops a German visit from translating the site into German
     twice and losing the English for good. */
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

  function countText(rows) {
    var n = 0;
    rows.forEach(function (r) { if (r.kind === "text") n++; });
    return n;
  }

  /* Dimensions come from the browser, the same way the panel does it, so the
     img carries width and height and the page does not jump while it loads. */
  function measure(file) {
    return new Promise(function (resolve) {
      if (file.type.indexOf("image/") !== 0) return resolve({});
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({}); };
      img.src = url;
    });
  }

  /* The server names the file, from its bytes. Uploading the same picture
     twice gives the same row back rather than a second copy. */
  function upload(file) {
    return measure(file).then(function (d) {
      var fd = new FormData();
      fd.append("file", file);
      if (d.width) fd.append("width", d.width);
      if (d.height) fd.append("height", d.height);
      return api("/admin/media", { method: "POST", body: fd });
    }).then(function (res) { return ok(res, "The upload failed."); });
  }

  function pairOf(node) {
    var en = node.langEn !== undefined ? node.langEn : node.innerHTML;
    return { en: text(en), de: text(node.getAttribute("data-de") || "") };
  }

  /* Our own rendered markup back to the words that made it. The blocks are
     plain prose today, so this is exact; a paragraph that grew a link would
     come back flattened, which is why the editor is prose-only for now. */
  function text(html) {
    var box = document.createElement("div");
    box.innerHTML = html;
    return (box.textContent || "").trim();
  }

  function build(key, section, region, pen, blocks, published) {
    var form = el("div", "ed");
    var rows = [];

    /* Losing your place was the main complaint: the section's own heading is
       hidden with the content, so the form says what it is and where it
       stands before anything else. */
    var head = el("div", "ed__head");
    head.appendChild(el("span", "ed__what", "editing " + key));
    var live = el("span", "ed__live", published
      ? "published, this replaces what is on the page"
      : "not published yet, the page still shows the original");
    head.appendChild(live);
    form.appendChild(head);

    var body = el("div", "ed__body");
    form.appendChild(body);

    function repaint() {
      body.textContent = "";
      rows.forEach(function (r) { body.appendChild(r.root); });
    }

    function addRow(kind, value, muted) {
      var controls = {
        hint: rows.length === 0,
        label: kind === "heading" ? "heading" : "paragraph " + (countText(rows) + 1),
        up: function () { move(entry, -1); },
        down: function () { move(entry, 1); },
        remove: function () {
          rows.splice(rows.indexOf(entry), 1);
          repaint();
          setDirty(true);
        },
        changed: function () { setDirty(true); }
      };

      var entry = kind === "media"
        ? mediaCard(value, controls)
        : fieldRow(kind, value, muted, controls);

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
      if (block.type === "media") return addRow("media", block, false);
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
    adders.appendChild(btn("+ picture", function () {
      var entry = addRow("media", { mediaId: 0, alt: "", name: { en: "", de: "" }, paragraphs: [] }, false);
      repaint();
      setDirty(true);
      var f = entry.root.querySelector(".ed-file");
      if (f) f.focus();
    }));
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

    var save = btn("save draft", function () {
      var got = collect();
      if (got.error) return void (state.textContent = got.error);

      run(save, "saving…", function () {
        return send("PUT", "/admin/sections/" + key, got.blocks).then(function () {
          setDirty(false);
          state.textContent = "Saved. The page still shows the published version.";
        });
      });
    });

    var publish = btn("publish", function () {
      var got = collect();
      if (got.error) return void (state.textContent = got.error);

      run(publish, "publishing…", function () {
        return send("PUT", "/admin/sections/" + key, got.blocks)
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

    /* Returns blocks, or a reason not to.
       An empty heading used to be dropped here without a word, and an empty
       section published as an empty region. Both are one-way: publishing
       replaces live_blocks, and the hand-written markup it came from is only
       in the file until the first publish. So this refuses rather than
       guesses, and the bar says why. */
    function collect() {
      var blocks = [];
      var text = null;
      var problem = null;

      rows.forEach(function (r) {
        var value = r.read();

        if (r.kind === "media") {
          if (!value.mediaId) {
            problem = problem || "One picture has no file yet. Choose one, or remove the row.";
            return;
          }
          if (!value.alt) {
            problem = problem || "A picture needs alt text.";
            return;
          }
          blocks.push(value);
          text = null;               // a picture ends the run of paragraphs
          return;
        }

        if (r.kind === "heading") {
          if (!value.en) {
            problem = problem || "The heading has no text. Write one, or remove the row.";
            return;
          }
          blocks.push({ type: "heading", text: value });
          return;
        }

        if (!value.en) return;          // an emptied paragraph is a removed one
        if (!text) {
          text = { type: "text", muted: r.muted, paragraphs: [] };
          blocks.push(text);
        }
        text.paragraphs.push(value);
      });

      if (problem) return { error: problem };
      if (!blocks.length) return { error: "That would leave the section empty, and there is no undo." };
      return { blocks: blocks };
    }

    /* One place where a refusal stops the chain before anything is written. */
    function send(method, path, blocks) {
      return api(path, { method: method, body: { blocks: blocks } })
        .then(function (res) { return ok(res, "Could not save."); });
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
    head.appendChild(el("span", "ed-row__kind", controls.label));
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

  /* A picture and the words under it. The alt text is not bilingual: it
     describes the picture, which does not change with the language. */
  function mediaCard(block, controls) {
    var root = el("div", "ed-row");

    var head = el("div", "ed-row__head");
    head.appendChild(el("span", "ed-row__kind", controls.label));
    head.appendChild(el("span", "ed__spacer"));
    head.appendChild(tool("▲", "Move up", controls.up));
    head.appendChild(tool("▼", "Move down", controls.down));
    head.appendChild(tool("✕", "Remove", controls.remove));
    root.appendChild(head);

    var state = { mediaId: block.mediaId, filename: block.filename || "" };

    var shot = el("img", "ed-shot");
    shot.alt = "";
    if (state.filename) shot.src = "/assets/up/" + state.filename;
    else shot.hidden = true;
    root.appendChild(shot);

    var file = el("input", "ed-file");
    file.type = "file";
    file.accept = "image/*";
    var note = el("span", "ed-field__hint", "");

    file.addEventListener("change", function () {
      if (!file.files || !file.files[0]) return;
      note.textContent = "uploading…";
      upload(file.files[0]).then(function (row) {
        state.mediaId = row.id;
        state.filename = row.filename;
        shot.src = "/assets/up/" + row.filename;
        shot.hidden = false;
        note.textContent = row.filename;
        if (controls.changed) controls.changed();
      }).catch(function (err) { note.textContent = err.message; });
    });

    root.appendChild(labelled("PICTURE", file, "PNG, JPEG, WebP or GIF. The server names the file."));
    root.appendChild(note);

    var alt = area(block.alt || "", 2);
    root.appendChild(labelled("ALT TEXT", alt, "What the picture shows, for someone who cannot see it."));

    var nameEn = area(block.name ? block.name.en : "", 1);
    var nameDe = area(block.name ? block.name.de : "", 1);
    root.appendChild(labelled("CAPTION EN", nameEn, null));
    root.appendChild(labelled("CAPTION DE", nameDe, null));

    var joined = function (side) {
      return (block.paragraphs || []).map(function (q) { return q[side]; }).join("\n\n");
    };
    var wordsEn = area(joined("en"), 4);
    var wordsDe = area(joined("de"), 4);
    root.appendChild(labelled("WORDS EN", wordsEn, "One blank line starts a new paragraph."));
    root.appendChild(labelled("WORDS DE", wordsDe, null));

    return {
      root: root,
      kind: "media",
      read: function () {
        var en = splitParas(wordsEn.value);
        var de = splitParas(wordsDe.value);
        return {
          type: "media",
          mediaId: state.mediaId,
          alt: alt.value.trim(),
          name: { en: nameEn.value.trim(), de: nameDe.value.trim() },
          paragraphs: en.map(function (t, i) { return { en: t, de: de[i] || "" }; })
        };
      }
    };
  }

  function splitParas(value) {
    return String(value || "").split(/\n\s*\n/).map(function (t) { return t.trim(); })
      .filter(function (t) { return t !== ""; });
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
