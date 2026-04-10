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

  function buildEditorModules(toolbar, enableTable) {
    var modules = {
      toolbar: {
        container: toolbar,
        handlers: {
          image: buildImageToolbarHandler(null)
        }
      }
    };
    if (enableTable) {
      modules.toolbar.handlers.insertTable = function () {
        var betterTableModule = this.quill.getModule("better-table");
        if (betterTableModule && typeof betterTableModule.insertTable === "function") {
          betterTableModule.insertTable(3, 3);
        }
      };
    }
    if (enableTable && window.QuillBetterTable) {
      modules["better-table"] = {
        operationMenu: {
          items: {
            unmergeCells: { text: "Desfazer mesclagem" }
          }
        }
      };
      modules.keyboard = {
        bindings: window.QuillBetterTable.keyboardBindings
      };
    }
    return modules;
  }

  function normalizeToolbarButtons(toolbarModule) {
    var container = toolbarModule && toolbarModule.container;
    if (!container || !container.querySelectorAll) return;
    var toolbarButtons = container.querySelectorAll("button");
    Array.prototype.forEach.call(toolbarButtons, function (btn) {
      if (!btn) return;
      // Quill toolbar lives inside <form>; prevent implicit submit on format clicks.
      btn.setAttribute("type", "button");
    });
    // Prevent toolbar clicks from stealing focus from the editor.
    // Without this, clicking a picker (tabindex="0" spans) causes blur on the
    // editor, clearing the selection before quill.format() is called.
    container.addEventListener("mousedown", function (e) {
      if (e.target && e.target.tagName !== "INPUT") {
        e.preventDefault();
      }
    });
  }

  contentToolbar = ensureToolbarImageControl(contentToolbar);
  titleToolbar = ensureToolbarImageControl(titleToolbar);

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

  function textToHtml(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    var escaped = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return "<p>" + escaped.replace(/\r?\n/g, "</p><p>") + "</p>";
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
    var loadDefaultModelBtn = formEl.querySelector("[data-load-default-model-btn]");
    var loadDefaultModelHtmlEl = formEl.querySelector("[data-load-default-model-html]");
    var csrfInput = formEl.querySelector('input[name="_csrf"]');
    var csrfToken = csrfInput ? csrfInput.value : "";
    if (!contentEditorEl || !titleEditorEl || !deltaField || !htmlField || !textField || !titleDeltaField || !titleHtmlField || !titlePlainField || !titleTextField) return;
    var actionMatch = String(formEl.getAttribute("action") || "").match(/\/admin\/report-service\/orders\/(\d+)\/sections\/[^/]+$/);
    var explicitSectionReviseEndpoint = String(formEl.getAttribute("data-ai-revise-endpoint") || "").trim();
    var explicitImageUploadEndpoint = String(formEl.getAttribute("data-image-upload-endpoint") || "").trim();
    var sectionReviseEndpoint = explicitSectionReviseEndpoint || (actionMatch ? ("/admin/report-service/orders/" + actionMatch[1] + "/sections/revise-text") : "");
    var imgUploadUrl = explicitImageUploadEndpoint || (actionMatch ? ("/admin/report-service/orders/" + actionMatch[1] + "/images/import") : "");

    var contentModules = buildEditorModules(contentToolbar, true);

    var contentQuill = new window.Quill(contentEditorEl, {
      theme: "snow",
      modules: contentModules,
      formats: contentFormats,
      placeholder: "Digite o conteudo tecnico do capitulo..."
    });
    var contentToolbarModule = contentQuill.getModule("toolbar");
    if (contentToolbarModule && contentToolbarModule.handlers) {
      normalizeToolbarButtons(contentToolbarModule);
      contentToolbarModule.handlers.image = buildImageToolbarHandler(contentQuill, imgUploadUrl, csrfToken);
    }
    var contentHtmlSource = String(htmlField.value || "").trim();
    if (!contentHtmlSource) {
      contentHtmlSource = textToHtml(textField.value);
    }
    hydrateQuill(contentQuill, deltaField.value, contentHtmlSource);
    applyDefaultJustify(contentQuill);

    var titleQuill = new window.Quill(titleEditorEl, {
      theme: "snow",
      modules: buildEditorModules(titleToolbar, false),
      formats: titleFormats,
      placeholder: "Titulo do capitulo..."
    });
    var titleToolbarModule = titleQuill.getModule("toolbar");
    if (titleToolbarModule && titleToolbarModule.handlers) {
      normalizeToolbarButtons(titleToolbarModule);
      titleToolbarModule.handlers.image = buildImageToolbarHandler(titleQuill, imgUploadUrl, csrfToken);
    }
    hydrateQuill(titleQuill, titleDeltaField.value, titleHtmlField.value || titleTextField.value);
    applyDefaultJustify(titleQuill);

    if (loadDefaultModelBtn && loadDefaultModelHtmlEl) {
      loadDefaultModelBtn.addEventListener("click", function () {
        var modelHtml = String(loadDefaultModelHtmlEl.value || "").trim();
        if (!modelHtml) {
          if (aiStatus) aiStatus.textContent = "Modelo padrao vazio para este capitulo.";
          return;
        }
        hydrateQuill(contentQuill, "", modelHtml);
        applyDefaultJustify(contentQuill);
        if (aiStatus) aiStatus.textContent = "Modelo padrao carregado no conteudo do capitulo.";
      });
    }

    if (aiReviseBtn) {
      aiReviseBtn.addEventListener("click", async function () {
        if (!sectionReviseEndpoint) {
          if (aiStatus) aiStatus.textContent = "Nao foi possivel determinar endpoint de revisao.";
          return;
        }

        function readEditorPayload(quill) {
          return {
            text: quill.getText().replace(/\s+/g, " ").trim(),
            html: String(quill.root && quill.root.innerHTML ? quill.root.innerHTML : "").trim()
          };
        }

        var contentPayload = readEditorPayload(contentQuill);
        var titlePayload = readEditorPayload(titleQuill);
        var activeEl = document.activeElement;
        var isContentFocused = !!(contentEditorEl && activeEl && contentEditorEl.contains(activeEl));
        var isTitleFocused = !!(titleEditorEl && activeEl && titleEditorEl.contains(activeEl));

        var targetQuill = null;
        var sourceText = "";
        var sourceHtml = "";
        if (isContentFocused && contentPayload.text) {
          targetQuill = contentQuill;
          sourceText = contentPayload.text;
          sourceHtml = contentPayload.html;
        } else if (isTitleFocused && titlePayload.text) {
          targetQuill = titleQuill;
          sourceText = titlePayload.text;
          sourceHtml = titlePayload.html;
        } else if (contentPayload.text) {
          targetQuill = contentQuill;
          sourceText = contentPayload.text;
          sourceHtml = contentPayload.html;
        } else if (titlePayload.text) {
          targetQuill = titleQuill;
          sourceText = titlePayload.text;
          sourceHtml = titlePayload.html;
        }

        if (!targetQuill || !sourceText) {
          if (aiStatus) aiStatus.textContent = "Digite um texto no editor para revisar com IA.";
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
        if (aiStatus) aiStatus.textContent = "Revisando texto com IA...";
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
            targetQuill.setText("");
            targetQuill.clipboard.dangerouslyPasteHTML(revisedHtml);
            if (aiStatus) aiStatus.textContent = "Texto revisado com IA mantendo formatacao.";
          } else {
            var revisedText = String(payload.revisedText || "").trim();
            if (!revisedText) throw new Error("A IA nao retornou texto revisado.");
            targetQuill.setText(revisedText);
            if (aiStatus) aiStatus.textContent = "Texto revisado com IA.";
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
