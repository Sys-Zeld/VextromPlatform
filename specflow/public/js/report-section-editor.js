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

  function buildImageToolbarHandler(quill, uploadUrl, csrfToken) {
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
        if (uploadUrl && csrfToken) {
          fetch(uploadUrl, {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "x-file-name": encodeURIComponent(file.name),
              "x-csrf-token": csrfToken
            },
            body: file
          })
            .then(function (resp) { return resp.json(); })
            .then(function (json) {
              if (json.ok && json.data && json.data.filePath) {
                var imgSrc = "/docs/report/img/" + encodeURIComponent(json.data.filePath);
                if (quill) {
                  var range = quill.getSelection(true);
                  var index = range && Number.isInteger(range.index) ? range.index : quill.getLength();
                  quill.insertEmbed(index, "image", imgSrc, "user");
                  quill.setSelection(index + 1, 0, "user");
                }
              }
              document.body.removeChild(input);
            })
            .catch(function () { document.body.removeChild(input); });
          return;
        }
        var reader = new FileReader();
        reader.onload = function (event) {
          var imageUrl = String(event && event.target && event.target.result ? event.target.result : "");
          if (!/^data:image\//i.test(imageUrl)) {
            document.body.removeChild(input);
            return;
          }
          var range = quill && quill.getSelection(true);
          var index = range && Number.isInteger(range.index) ? range.index : (quill ? quill.getLength() : 0);
          if (quill) {
            quill.insertEmbed(index, "image", imageUrl, "user");
            quill.setSelection(index + 1, 0, "user");
          }
          document.body.removeChild(input);
        };
        reader.onerror = function () { document.body.removeChild(input); };
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

  function applyDefaultJustify(quill) {
    var ops = (quill.getContents().ops || []);
    var pos = 0;
    ops.forEach(function (op) {
      if (typeof op.insert === "string") {
        for (var i = 0; i < op.insert.length; i++) {
          if (op.insert[i] === "\n" && !(op.attributes && op.attributes.align)) {
            quill.formatLine(pos, 1, "align", "justify", "silent");
          }
          pos++;
        }
      } else {
        pos++;
      }
    });
    quill.format("align", "justify", "silent");
  }

  function ensureTagUi(editorEl) {
    var wrap = document.createElement("div");
    wrap.className = "report-tag-tools";

    var validationEl = document.createElement("div");
    validationEl.className = "report-tag-validation";
    validationEl.textContent = "Use @img=ID, @tblcmpr/@tblcmpq/@tblcmps, @tblequip, @timesheet, @equipetecnica, @equip=ID, @descricaodia=ID, @descricaodia ou @conclusaogeral.";
    wrap.appendChild(validationEl);

    editorEl.insertAdjacentElement("afterend", wrap);
    return {
      wrap: wrap,
      validationEl: validationEl
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
      ui.validationEl.textContent = "Use @img=ID, @tblcmpr/@tblcmpq/@tblcmps, @tblequip, @timesheet, @equipetecnica, @equip=ID, @descricaodia=ID, @descricaodia ou @conclusaogeral.";
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
    var imgUploadUrl = actionMatch ? ("/admin/report-service/orders/" + actionMatch[1] + "/images/import") : "";

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
      contentToolbarModule.handlers.image = buildImageToolbarHandler(contentQuill, imgUploadUrl, csrfToken);
    }
    hydrateQuill(contentQuill, deltaField.value, htmlField.value);
    applyDefaultJustify(contentQuill);
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
      titleToolbarModule.handlers.image = buildImageToolbarHandler(titleQuill, imgUploadUrl, csrfToken);
    }
    hydrateQuill(titleQuill, titleDeltaField.value, titleHtmlField.value || titleTextField.value);
    applyDefaultJustify(titleQuill);
    var titleTagUi = ensureTagUi(titleEditorEl);

    function syncTagStates() {
      renderValidation(contentTagUi, contentQuill, "conteudo");
      renderValidation(titleTagUi, titleQuill, "titulo");
    }

    contentQuill.on("text-change", syncTagStates);
    titleQuill.on("text-change", syncTagStates);
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
