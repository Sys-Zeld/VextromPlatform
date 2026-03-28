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
  var dailyLogTagIndex = Array.isArray(window.reportDailyLogTagIndex) ? window.reportDailyLogTagIndex : [];
  var dailyLogTagIdSet = new Set(
    dailyLogTagIndex
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
    : [[{ font: ["arial", "serif", "monospace"] }, { size: ["small", false, "large", "huge"] }], [{ header: [1, 2, 3, false] }], ["bold", "italic", "underline", { color: [] }], [{ list: "ordered" }, { list: "bullet" }], ["blockquote"], [{ align: [] }], ["insertTable"], ["link", "image"], ["clean"]];
  var contentFormats = Array.isArray(window.reportSectionFormats)
    ? window.reportSectionFormats
    : ["font", "size", "color", "header", "bold", "italic", "underline", "list", "blockquote", "align", "table", "table-cell-line", "table-col", "table-row", "link", "image"];
  var titleToolbar = Array.isArray(window.reportSectionTitleToolbar)
    ? window.reportSectionTitleToolbar
    : [[{ font: ["arial", "serif", "monospace"] }, { size: ["small", false, "large", "huge"] }], ["bold", "italic", "underline", { color: [] }], [{ align: [] }], ["link", "image"], ["clean"]];
  var titleFormats = Array.isArray(window.reportSectionTitleFormats)
    ? window.reportSectionTitleFormats
    : ["font", "size", "color", "bold", "italic", "underline", "align", "link", "image"];

  function buildImageToolbarHandler(quill) {
    return function () {
      var input = document.createElement("input");
      input.setAttribute("type", "file");
      input.setAttribute("accept", "image/*");
      input.style.display = "none";
      document.body.appendChild(input);
      input.click();
      input.onchange = function () {
        var file = input.files && input.files[0];
        if (!file) {
          document.body.removeChild(input);
          return;
        }
        var reader = new FileReader();
        reader.onload = function (event) {
          var imageUrl = String(event && event.target && event.target.result ? event.target.result : "");
          if (!/^data:image\//i.test(imageUrl)) {
            document.body.removeChild(input);
            return;
          }
          var range = quill.getSelection(true);
          var index = range && Number.isInteger(range.index) ? range.index : quill.getLength();
          quill.insertEmbed(index, "image", imageUrl, "user");
          quill.setSelection(index + 1, 0, "user");
          document.body.removeChild(input);
        };
        reader.onerror = function () {
          document.body.removeChild(input);
        };
        reader.readAsDataURL(file);
      };
    };
  }

  function toolbarHasControl(toolbar, control) {
    return (Array.isArray(toolbar) ? toolbar : []).some(function (group) {
      if (!Array.isArray(group)) return false;
      return group.some(function (item) { return item === control; });
    });
  }

  function ensureToolbarImageControl(toolbar) {
    var normalized = Array.isArray(toolbar) ? toolbar.slice() : [];
    if (toolbarHasControl(normalized, "image")) return normalized;
    var linkGroupIndex = normalized.findIndex(function (group) {
      return Array.isArray(group) && group.some(function (item) { return item === "link"; });
    });
    if (linkGroupIndex >= 0) {
      var group = Array.isArray(normalized[linkGroupIndex]) ? normalized[linkGroupIndex].slice() : [];
      group.push("image");
      normalized[linkGroupIndex] = group;
      return normalized;
    }
    normalized.push(["link", "image"]);
    return normalized;
  }

  contentToolbar = ensureToolbarImageControl(contentToolbar);

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
    validationEl.textContent = "Use @img=ID, @tblcmpr/@tblcmpq/@tblcmps, @timesheet, @equip=ID, @descricaodia=ID ou @descricaodia.";
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
    var dailyLogIds = collectTagIdsFromText(text, /@descricaodia\s*=\s*(\d+)/gi);

    if (!imageIds.length && !equipmentIds.length && !dailyLogIds.length) {
      ui.validationEl.classList.remove("error");
      ui.validationEl.textContent = "Use @img=ID, @tblcmpr/@tblcmpq/@tblcmps, @timesheet, @equip=ID, @descricaodia=ID ou @descricaodia.";
      quill.container.classList.remove("report-tag-editor-invalid");
      return;
    }

    var invalidImages = Array.from(new Set(imageIds.filter(function (id) { return !tagImageIdSet.has(id); })));
    var invalidEquipments = Array.from(new Set(equipmentIds.filter(function (id) { return !equipmentTagIdSet.has(id); })));
    var invalidDailyLogs = Array.from(new Set(dailyLogIds.filter(function (id) { return !dailyLogTagIdSet.has(id); })));
    var editorContainer = quill.container;
    if (invalidImages.length || invalidEquipments.length || invalidDailyLogs.length) {
      var messages = [];
      if (invalidImages.length) messages.push("IDs de imagem nao cadastrados: " + invalidImages.join(", "));
      if (invalidEquipments.length) messages.push("IDs de equipamento nao cadastrados: " + invalidEquipments.join(", "));
      if (invalidDailyLogs.length) messages.push("IDs de descricao diaria nao cadastrados: " + invalidDailyLogs.join(", "));
      ui.validationEl.classList.add("error");
      ui.validationEl.textContent = messages.join(" | ") + " (" + label + ")";
      editorContainer.classList.add("report-tag-editor-invalid");
      return;
    }

    ui.validationEl.classList.remove("error");
    ui.validationEl.textContent = "Tags validadas (" + label + "): img " + imageIds.length + " | equip " + equipmentIds.length + " | descricaodia " + dailyLogIds.length;
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
    if (match) {
      return {
        range: range,
        typedDigits: match[1] || "",
        matchedToken: match[0] || "",
        tagType: "equip"
      };
    }
    match = before.match(/@descricaodia\s*=\s*(\d*)$/i);
    if (!match) return null;
    return {
      range: range,
      typedDigits: match[1] || "",
      matchedToken: match[0] || "",
      tagType: "descricaodia"
    };
  }

  function renderAutocomplete(ui, quill, label) {
    ui.autocompleteEl.innerHTML = "";
    var ctx = getTypedTagContext(quill);
    if (!ctx) return;

    var typed = String(ctx.typedDigits || "");
    var sourceIndex = ctx.tagType === "equip"
      ? equipmentTagIndex
      : ctx.tagType === "descricaodia"
        ? dailyLogTagIndex
        : tagImageIndex;
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
      } else if (ctx.tagType === "descricaodia") {
        var dateLabel = item.activityDate || "";
        var dailyLabel = item.title || "";
        chip.textContent = "@descricaodia=" + item.id + (dateLabel || dailyLabel ? " - " + [dateLabel, dailyLabel].filter(Boolean).join(" - ") : "");
      } else {
        chip.textContent = "@img=" + item.id + (item.caption ? " - " + item.caption : "");
      }
      chip.addEventListener("click", function () {
        var currentRange = quill.getSelection() || ctx.range;
        var before = quill.getText(0, currentRange.index);
        var matcher = ctx.tagType === "equip"
          ? /@equip\s*=\s*(\d*)$/i
          : ctx.tagType === "descricaodia"
            ? /@descricaodia\s*=\s*(\d*)$/i
            : /@img\s*=\s*(\d*)$/i;
        var currentMatch = before.match(matcher);
        if (!currentMatch) return;
        var token = currentMatch[0];
        var start = currentRange.index - token.length;
        quill.deleteText(start, token.length, "user");
        var inserted = (ctx.tagType === "equip" ? "@equip=" : ctx.tagType === "descricaodia" ? "@descricaodia=" : "@img=") + item.id;
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
    var aiReviseBtn = formEl.querySelector("[data-section-ai-revise-btn]");
    var aiStatus = formEl.querySelector("[data-section-ai-status]");
    var csrfInput = formEl.querySelector('input[name="_csrf"]');
    var csrfToken = csrfInput ? csrfInput.value : "";
    if (!contentEditorEl || !titleEditorEl || !deltaField || !htmlField || !textField || !titleDeltaField || !titleHtmlField || !titlePlainField || !titleTextField) return;
    var actionMatch = String(formEl.getAttribute("action") || "").match(/\/admin\/report-service\/orders\/(\d+)\/sections\/[^/]+$/);
    var sectionReviseEndpoint = actionMatch ? ("/admin/report-service/orders/" + actionMatch[1] + "/sections/revise-text") : "";

    var contentModules = {
      toolbar: {
        container: contentToolbar,
        handlers: {
          insertTable: function () {
            var tableModule = this.quill.getModule("better-table");
            if (!tableModule || typeof tableModule.insertTable !== "function") return;
            tableModule.insertTable(3, 3);
          },
          image: buildImageToolbarHandler(null)
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
    var contentToolbarModule = contentQuill.getModule("toolbar");
    if (contentToolbarModule && contentToolbarModule.handlers) {
      contentToolbarModule.handlers.image = buildImageToolbarHandler(contentQuill);
    }
    hydrateQuill(contentQuill, deltaField.value, htmlField.value);
    var contentTagUi = ensureTagUi(contentEditorEl);

    var titleQuill = new window.Quill(titleEditorEl, {
      theme: "snow",
      modules: {
        toolbar: {
          container: titleToolbar,
          handlers: {
            image: buildImageToolbarHandler(null)
          }
        }
      },
      formats: titleFormats,
      placeholder: "Titulo do capitulo..."
    });
    var titleToolbarModule = titleQuill.getModule("toolbar");
    if (titleToolbarModule && titleToolbarModule.handlers) {
      titleToolbarModule.handlers.image = buildImageToolbarHandler(titleQuill);
    }
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

    if (aiReviseBtn) {
      aiReviseBtn.addEventListener("click", async function () {
        var sourceText = contentQuill.getText().replace(/\s+/g, " ").trim();
        var sourceHtml = String(contentQuill.root && contentQuill.root.innerHTML ? contentQuill.root.innerHTML : "").trim();
        if (!sourceText) {
          if (aiStatus) aiStatus.textContent = "Digite um texto no conteudo do capitulo para revisar com IA.";
          return;
        }
        if (!sectionReviseEndpoint) {
          if (aiStatus) aiStatus.textContent = "Nao foi possivel determinar endpoint de revisao.";
          return;
        }

        var defaultPrompt = "Revise o texto abaixo sem mudar muitas palavras";
        var userPrompt = window.prompt("Informe o prompt para enviar a IA:", defaultPrompt);
        if (userPrompt === null) {
          if (aiStatus) aiStatus.textContent = "Revisao com IA cancelada.";
          return;
        }
        userPrompt = String(userPrompt || "").trim() || defaultPrompt;

        aiReviseBtn.disabled = true;
        if (aiStatus) aiStatus.textContent = "Revisando conteudo com IA...";
        try {
          var response = await fetch(sectionReviseEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken
            },
            credentials: "same-origin",
            body: JSON.stringify({
              text: sourceText,
              html: sourceHtml,
              prompt: userPrompt,
              preserveFormatting: true
            })
          });
          var payload = await response.json().catch(function () { return {}; });
          if (!response.ok || !payload || !payload.ok) {
            throw new Error(payload && payload.message ? payload.message : "Falha ao revisar texto com IA.");
          }
          var revisedHtml = String(payload.revisedHtml || "").trim();
          if (revisedHtml) {
            contentQuill.setText("");
            contentQuill.clipboard.dangerouslyPasteHTML(revisedHtml);
            if (aiStatus) aiStatus.textContent = "Conteudo revisado com IA mantendo formatacao.";
          } else {
            var revisedText = String(payload.revisedText || "").trim();
            if (!revisedText) throw new Error("A IA nao retornou texto revisado.");
            contentQuill.setText(revisedText);
            if (aiStatus) aiStatus.textContent = "Conteudo revisado com IA.";
          }
        } catch (err) {
          if (aiStatus) aiStatus.textContent = err && err.message ? err.message : "Falha ao revisar texto com IA.";
        } finally {
          aiReviseBtn.disabled = false;
        }
      });
    }

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
