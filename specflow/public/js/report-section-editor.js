(function () {
  var forms = Array.prototype.slice.call(document.querySelectorAll("[data-report-section-form]"));
  if (!forms.length || typeof window.Quill === "undefined") return;
  var tagImageIndex = Array.isArray(window.reportTagImageIndex) ? window.reportTagImageIndex : [];
  var tagImageIdSet = new Set(
    tagImageIndex
      .map(function (item) { return Number(item && item.id); })
      .filter(function (id) { return Number.isInteger(id) && id > 0; })
  );
  var equipmentTagIndex = Array.isArray(window.reportEquipmentTagIndex) ? window.reportEquipmentTagIndex : [];
  var equipmentTagIdSet = new Set(
    equipmentTagIndex
      .map(function (item) { return Number(item && item.id); })
      .filter(function (id) { return Number.isInteger(id) && id > 0; })
  );

  var FontAttributor = window.Quill.import("formats/font");
  FontAttributor.whitelist = ["arial", "serif", "monospace"];
  window.Quill.register(FontAttributor, true);
  if (window.QuillBetterTable) {
    window.Quill.register({
      "modules/better-table": window.QuillBetterTable
    }, true);
  }

  var contentToolbar = Array.isArray(window.reportSectionToolbar)
    ? window.reportSectionToolbar
    : [[{ font: ["arial", "serif", "monospace"] }, { size: ["small", false, "large", "huge"] }], [{ header: [1, 2, 3, false] }], ["bold", "italic", "underline", { color: [] }], [{ list: "ordered" }, { list: "bullet" }], ["blockquote"], [{ align: [] }], ["insertTable"], ["link"], ["clean"]];
  var contentFormats = Array.isArray(window.reportSectionFormats)
    ? window.reportSectionFormats
    : ["font", "size", "color", "header", "bold", "italic", "underline", "list", "blockquote", "align", "table", "table-cell-line", "table-col", "table-row", "link"];
  var titleToolbar = Array.isArray(window.reportSectionTitleToolbar)
    ? window.reportSectionTitleToolbar
    : [[{ font: ["arial", "serif", "monospace"] }, { size: ["small", false, "large", "huge"] }], ["bold", "italic", "underline", { color: [] }], [{ align: [] }], ["link"], ["clean"]];
  var titleFormats = Array.isArray(window.reportSectionTitleFormats)
    ? window.reportSectionTitleFormats
    : ["font", "size", "color", "bold", "italic", "underline", "align", "link"];

  function hydrateQuill(quill, deltaValue, htmlValue) {
    var hydrated = false;
    if (htmlValue) {
      quill.clipboard.dangerouslyPasteHTML(htmlValue);
      hydrated = true;
    } else if (deltaValue) {
      try {
        var parsedDelta = JSON.parse(deltaValue);
        if (parsedDelta && Array.isArray(parsedDelta.ops) && parsedDelta.ops.length) {
          quill.setContents(parsedDelta);
          hydrated = true;
        }
      } catch (_err) {
        hydrated = false;
      }
    }
    if (!hydrated) quill.setText("");
  }

  function ensureTagUi(editorEl) {
    var wrap = document.createElement("div");
    wrap.className = "report-tag-tools";

    var validationEl = document.createElement("div");
    validationEl.className = "report-tag-validation";
    validationEl.textContent = "Use @img=ID, @tblcmpr/@tblcmpq/@tblcmps, @timesheet ou @equip=ID.";
    wrap.appendChild(validationEl);

    var autocompleteEl = document.createElement("div");
    autocompleteEl.className = "report-tag-autocomplete";
    wrap.appendChild(autocompleteEl);

    editorEl.insertAdjacentElement("afterend", wrap);
    return {
      wrap: wrap,
      validationEl: validationEl,
      autocompleteEl: autocompleteEl
    };
  }

  function collectTagIdsFromText(text, regex) {
    var source = String(text || "");
    var ids = [];
    var match;
    while ((match = regex.exec(source)) !== null) {
      ids.push(Number(match[1]));
    }
    return ids.filter(function (id) { return Number.isInteger(id) && id > 0; });
  }

  function renderValidation(ui, quill, label) {
    var text = quill.getText();
    var imageIds = collectTagIdsFromText(text, /@img\s*=\s*(\d+)/gi);
    var equipmentIds = collectTagIdsFromText(text, /@equip\s*=\s*(\d+)/gi);

    if (!imageIds.length && !equipmentIds.length) {
      ui.validationEl.classList.remove("error");
      ui.validationEl.textContent = "Use @img=ID, @tblcmpr/@tblcmpq/@tblcmps, @timesheet ou @equip=ID.";
      quill.container.classList.remove("report-tag-editor-invalid");
      return;
    }

    var invalidImages = Array.from(new Set(imageIds.filter(function (id) { return !tagImageIdSet.has(id); })));
    var invalidEquipments = Array.from(new Set(equipmentIds.filter(function (id) { return !equipmentTagIdSet.has(id); })));
    var editorContainer = quill.container;
    if (invalidImages.length || invalidEquipments.length) {
      var messages = [];
      if (invalidImages.length) messages.push("IDs de imagem nao cadastrados: " + invalidImages.join(", "));
      if (invalidEquipments.length) messages.push("IDs de equipamento nao cadastrados: " + invalidEquipments.join(", "));
      ui.validationEl.classList.add("error");
      ui.validationEl.textContent = messages.join(" | ") + " (" + label + ")";
      editorContainer.classList.add("report-tag-editor-invalid");
      return;
    }

    ui.validationEl.classList.remove("error");
    ui.validationEl.textContent = "Tags validadas (" + label + "): img " + imageIds.length + " | equip " + equipmentIds.length;
    editorContainer.classList.remove("report-tag-editor-invalid");
  }

  function getTypedTagContext(quill) {
    var range = quill.getSelection();
    if (!range || !Number.isInteger(range.index)) return null;
    var before = quill.getText(0, range.index);
    var match = before.match(/@img\s*=\s*(\d*)$/i);
    if (match) {
      return {
        range: range,
        typedDigits: match[1] || "",
        matchedToken: match[0] || "",
        tagType: "img"
      };
    }
    match = before.match(/@equip\s*=\s*(\d*)$/i);
    if (!match) return null;
    return {
      range: range,
      typedDigits: match[1] || "",
      matchedToken: match[0] || "",
      tagType: "equip"
    };
  }

  function renderAutocomplete(ui, quill, label) {
    ui.autocompleteEl.innerHTML = "";
    var ctx = getTypedTagContext(quill);
    if (!ctx) return;

    var typed = String(ctx.typedDigits || "");
    var sourceIndex = ctx.tagType === "equip" ? equipmentTagIndex : tagImageIndex;
    var candidates = sourceIndex
      .filter(function (item) {
        var id = String(item.id || "");
        return typed ? id.indexOf(typed) === 0 : true;
      })
      .slice(0, 6);

    if (!candidates.length) return;

    candidates.forEach(function (item) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "report-tag-chip";
      if (ctx.tagType === "equip") {
        var equipLabel = item.tag || item.type || "";
        chip.textContent = "@equip=" + item.id + (equipLabel ? " - " + equipLabel : "");
      } else {
        chip.textContent = "@img=" + item.id + (item.caption ? " - " + item.caption : "");
      }
      chip.addEventListener("click", function () {
        var currentRange = quill.getSelection() || ctx.range;
        var before = quill.getText(0, currentRange.index);
        var matcher = ctx.tagType === "equip" ? /@equip\s*=\s*(\d*)$/i : /@img\s*=\s*(\d*)$/i;
        var currentMatch = before.match(matcher);
        if (!currentMatch) return;
        var token = currentMatch[0];
        var start = currentRange.index - token.length;
        quill.deleteText(start, token.length, "user");
        var inserted = (ctx.tagType === "equip" ? "@equip=" : "@img=") + item.id;
        quill.insertText(start, inserted, "user");
        quill.setSelection(start + inserted.length, 0, "user");
        renderAutocomplete(ui, quill, label);
        renderValidation(ui, quill, label);
      });
      ui.autocompleteEl.appendChild(chip);
    });
  }

  forms.forEach(function (formEl) {
    var contentEditorEl = formEl.querySelector("[data-quill-editor]");
    var titleEditorEl = formEl.querySelector("[data-quill-title-editor]");
    var deltaField = formEl.querySelector("[data-section-delta]");
    var htmlField = formEl.querySelector("[data-section-html]");
    var textField = formEl.querySelector("[data-section-text]");
    var titleDeltaField = formEl.querySelector("[data-section-title-delta]");
    var titleHtmlField = formEl.querySelector("[data-section-title-html]");
    var titlePlainField = formEl.querySelector("[data-section-title-plain]");
    var titleTextField = formEl.querySelector("[data-section-title-text]");
    if (!contentEditorEl || !titleEditorEl || !deltaField || !htmlField || !textField || !titleDeltaField || !titleHtmlField || !titlePlainField || !titleTextField) return;

    var contentModules = {
      toolbar: {
        container: contentToolbar,
        handlers: {
          insertTable: function () {
            var tableModule = this.quill.getModule("better-table");
            if (!tableModule || typeof tableModule.insertTable !== "function") return;
            tableModule.insertTable(3, 3);
          }
        }
      }
    };
    if (window.QuillBetterTable) {
      contentModules["better-table"] = {
        operationMenu: {
          items: {
            unmergeCells: { text: "Desfazer mesclagem" }
          }
        }
      };
      contentModules.keyboard = {
        bindings: window.QuillBetterTable.keyboardBindings
      };
    }

    var contentQuill = new window.Quill(contentEditorEl, {
      theme: "snow",
      modules: contentModules,
      formats: contentFormats,
      placeholder: "Digite o conteudo tecnico do capitulo..."
    });
    hydrateQuill(contentQuill, deltaField.value, htmlField.value);
    var contentTagUi = ensureTagUi(contentEditorEl);

    var titleQuill = new window.Quill(titleEditorEl, {
      theme: "snow",
      modules: { toolbar: titleToolbar },
      formats: titleFormats,
      placeholder: "Titulo do capitulo..."
    });
    hydrateQuill(titleQuill, titleDeltaField.value, titleHtmlField.value || titleTextField.value);
    var titleTagUi = ensureTagUi(titleEditorEl);

    function syncTagStates() {
      renderValidation(contentTagUi, contentQuill, "conteudo");
      renderValidation(titleTagUi, titleQuill, "titulo");
      renderAutocomplete(contentTagUi, contentQuill, "conteudo");
      renderAutocomplete(titleTagUi, titleQuill, "titulo");
    }

    contentQuill.on("text-change", syncTagStates);
    titleQuill.on("text-change", syncTagStates);
    contentQuill.on("selection-change", function () { renderAutocomplete(contentTagUi, contentQuill, "conteudo"); });
    titleQuill.on("selection-change", function () { renderAutocomplete(titleTagUi, titleQuill, "titulo"); });
    syncTagStates();

    formEl.addEventListener("submit", function () {
      var titleDelta = titleQuill.getContents();
      titleDeltaField.value = JSON.stringify(titleDelta);
      titleHtmlField.value = titleQuill.root.innerHTML;
      var titleTextRaw = titleQuill.getText();
      var titleText = titleTextRaw
        .split(/\r?\n/)
        .map(function (line) { return line.trim(); })
        .find(function (line) { return Boolean(line); }) || "";
      titlePlainField.value = titleText;
      titleTextField.value = titleText;

      var delta = contentQuill.getContents();
      deltaField.value = JSON.stringify(delta);
      htmlField.value = contentQuill.root.innerHTML;
      textField.value = contentQuill.getText().replace(/\s+/g, " ").trim();
    });
  });
})();
