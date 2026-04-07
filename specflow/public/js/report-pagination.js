(function () {
  var rafToken = null;
  var resizeTimer = null;

  function schedule(fn) {
    if (rafToken) window.cancelAnimationFrame(rafToken);
    rafToken = window.requestAnimationFrame(function () {
      rafToken = null;
      fn();
    });
  }

  function debounceRun() {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      schedule(run);
    }, 220);
  }

  function toArray(listLike) {
    return Array.prototype.slice.call(listLike || []);
  }

  function isBlankTextNode(node) {
    return node && node.nodeType === Node.TEXT_NODE && !String(node.textContent || "").trim();
  }

  function normalizeFlowForPagination(flowEl) {
    if (!flowEl) return;

    var onlyChild = flowEl.children.length === 1 ? flowEl.firstElementChild : null;
    if (onlyChild && onlyChild.tagName === "DIV" && onlyChild.classList.contains("ql-editor")) {
      while (onlyChild.firstChild) flowEl.appendChild(onlyChild.firstChild);
      flowEl.removeChild(onlyChild);
    }

    toArray(flowEl.childNodes).forEach(function (node) {
      if (isBlankTextNode(node)) {
        flowEl.removeChild(node);
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        var p = document.createElement("p");
        p.textContent = String(node.textContent || "").trim();
        flowEl.replaceChild(p, node);
      }
    });
  }

  function isFlowOverflowing(flowEl, pageEl) {
    if (!flowEl || !pageEl) return false;
    var maxHeight = getMaxContentHeight(pageEl, flowEl);
    if (!maxHeight) return false;
    return flowEl.scrollHeight > (maxHeight + 1);
  }

  function isPageOverflowing(pageEl) {
    if (!pageEl) return false;
    return pageEl.scrollHeight > (pageEl.clientHeight + 1);
  }

  function getMaxContentHeight(page, flowEl) {
    if (!page || !flowEl) return 0;
    var pageRect = page.getBoundingClientRect();
    var flowRect = flowEl.getBoundingClientRect();
    var styles = window.getComputedStyle(page);
    var padBottom = parseFloat(styles.paddingBottom || "0") || 0;
    var flowTop = flowRect.top - pageRect.top;
    var usable = pageRect.height - padBottom - flowTop;
    return Math.max(0, usable);
  }

  function blockIsHeading(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return false;
    return !!block.matches("h1, h2, h3, h4, h5, h6") || !!block.querySelector("h1, h2, h3, h4, h5, h6");
  }

  function blockIsTable(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return false;
    return !!block.matches("table") || !!block.querySelector("table");
  }

  function blockIsImage(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return false;
    return !!block.querySelector("img");
  }

  function blockIsList(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return false;
    return !!block.matches("ul, ol") || !!block.querySelector("ul, ol");
  }

  function blockIsParagraphLike(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = String(block.tagName || "").toUpperCase();
    return tag === "P" || tag === "LI" || tag === "BLOCKQUOTE";
  }

  function blockCanSplitAsParagraph(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return false;
    if (blockIsParagraphLike(block)) return true;

    var tag = String(block.tagName || "").toUpperCase();
    if (tag !== "DIV") return false;
    if (block.children.length !== 1) return false;

    var onlyChild = block.firstElementChild;
    if (!onlyChild) return false;
    var childTag = String(onlyChild.tagName || "").toUpperCase();
    return childTag === "P" || childTag === "LI" || childTag === "BLOCKQUOTE";
  }

  function getFlow(pageEl) {
    return pageEl ? pageEl.querySelector(".rich-output") : null;
  }

  function ensurePageHeader(pageEl) {
    if (!pageEl) return null;
    var contentWrap = pageEl.querySelector(".report-page-content");
    if (!contentWrap) {
      contentWrap = document.createElement("div");
      contentWrap.className = "report-page-content";
      pageEl.appendChild(contentWrap);
    }
    var title = contentWrap.querySelector(".section-title");
    if (!title) {
      title = document.createElement("div");
      title.className = "section-title";
      var number = document.createElement("span");
      number.className = "section-title-number";
      var rich = document.createElement("div");
      rich.className = "report-section-title-rich";
      title.appendChild(number);
      title.appendChild(rich);
      contentWrap.insertBefore(title, contentWrap.firstChild || null);
    }
    return title;
  }

  function setPageHeader(pageEl, sectionMeta, isContinuation) {
    var title = ensurePageHeader(pageEl);
    if (!title) return;
    title.classList.toggle("section-title-continued", Boolean(isContinuation));

    var numberEl = title.querySelector(".section-title-number");
    if (numberEl) numberEl.textContent = String(sectionMeta && sectionMeta.numberLabel ? sectionMeta.numberLabel : "");

    var richTitleEl = title.querySelector(".report-section-title-rich");
    if (richTitleEl) {
      if (isContinuation) {
        richTitleEl.textContent = "(continua\u00e7\u00e3o...)";
      } else {
        richTitleEl.innerHTML = String(sectionMeta && sectionMeta.titleHtml ? sectionMeta.titleHtml : "CAPITULO");
      }
    }
  }

  function buildInlineSectionHeader(sectionMeta) {
    var header = document.createElement("div");
    header.className = "section-title";

    var number = document.createElement("span");
    number.className = "section-title-number";
    number.textContent = String(sectionMeta && sectionMeta.numberLabel ? sectionMeta.numberLabel : "");
    header.appendChild(number);

    var rich = document.createElement("div");
    rich.className = "report-section-title-rich";
    rich.innerHTML = String(sectionMeta && sectionMeta.titleHtml ? sectionMeta.titleHtml : "CAPITULO");
    header.appendChild(rich);

    return header;
  }

  function cloneOverflowPage(sourcePage, sourceTopbar, sectionMeta, options) {
    var opts = options || {};
    var isContinuation = Boolean(opts.continuation);
    var overflowPage = sourcePage.cloneNode(false);
    overflowPage.removeAttribute("id");
    overflowPage.setAttribute("data-generated-overflow", "true");
    overflowPage.setAttribute("data-auto-paginate", "true");
    overflowPage.setAttribute("data-page-section-anchor", String(sectionMeta && sectionMeta.anchorId ? sectionMeta.anchorId : ""));
    overflowPage.setAttribute("data-page-section-continued", isContinuation ? "true" : "false");

    var topbar = sourceTopbar ? sourceTopbar.cloneNode(true) : document.createElement("div");
    var contentWrap = document.createElement("div");
    contentWrap.className = "report-page-content";

    var title = document.createElement("div");
    title.className = "section-title";
    if (isContinuation) title.classList.add("section-title-continued");

    var numberEl = document.createElement("span");
    numberEl.className = "section-title-number";
    numberEl.textContent = String(sectionMeta && sectionMeta.numberLabel ? sectionMeta.numberLabel : "");
    title.appendChild(numberEl);

    var richTitleEl = document.createElement("div");
    richTitleEl.className = "report-section-title-rich";
    if (isContinuation) {
      richTitleEl.textContent = "(continua\u00e7\u00e3o...)";
    } else {
      richTitleEl.innerHTML = String(sectionMeta && sectionMeta.titleHtml ? sectionMeta.titleHtml : "CAPITULO");
    }
    title.appendChild(richTitleEl);

    var flow = document.createElement("div");
    flow.className = "rich-output";

    contentWrap.appendChild(title);
    contentWrap.appendChild(flow);
    overflowPage.appendChild(topbar);
    overflowPage.appendChild(contentWrap);

    var sourceFooter = sourcePage ? sourcePage.querySelector(".report-footer") : null;
    if (sourceFooter) {
      overflowPage.appendChild(sourceFooter.cloneNode(true));
    }

    return overflowPage;
  }

  function getBaseSectionPages(reportDoc) {
    return toArray(reportDoc.querySelectorAll(".report-page[data-auto-paginate='true']:not([data-generated-overflow='true'])"));
  }

  function ensureSourceSnapshot(page) {
    if (!page) return;
    if (page.getAttribute("data-pagination-source-cached") === "true") return;

    var title = page.querySelector(".section-title");
    var flow = getFlow(page);
    page.setAttribute("data-pagination-source-cached", "true");
    page.setAttribute("data-source-title-html", title ? title.innerHTML : "");
    page.setAttribute("data-source-flow-html", flow ? flow.innerHTML : "");
  }

  function restoreSourceSnapshot(page) {
    if (!page) return;
    ensureSourceSnapshot(page);

    var title = page.querySelector(".section-title");
    var flow = getFlow(page);
    var titleHtml = page.getAttribute("data-source-title-html") || "";
    var flowHtml = page.getAttribute("data-source-flow-html") || "";
    if (title) title.innerHTML = titleHtml;
    if (flow) flow.innerHTML = flowHtml;
  }

  function ensureNextPageForSection(currentPage, reportDoc, sectionMeta, isContinuation) {
    var topbar = currentPage.querySelector(".topbar");
    var created = cloneOverflowPage(currentPage, topbar, sectionMeta, { continuation: Boolean(isContinuation) });
    currentPage.after(created);
    return created;
  }

  function ensureImageSizeForPage(block, pageEl) {
    if (!block || !pageEl) return;
    var flow = getFlow(pageEl);
    if (!flow) return;

    var maxHeight = Math.max(120, getMaxContentHeight(pageEl, flow) - 10);
    toArray(block.querySelectorAll("img")).forEach(function (img) {
      if (!img.getAttribute("style") || String(img.style.maxHeight || "").trim() === "") {
        img.style.maxHeight = maxHeight + "px";
      }
      if (!img.style.width) img.style.width = "auto";
    });
  }

  function appendAndCheck(block, pageEl) {
    var flow = getFlow(pageEl);
    if (!flow) return false;
    flow.appendChild(block);
    return !isFlowOverflowing(flow, pageEl) && !isPageOverflowing(pageEl);
  }

  function removeFromFlow(block, pageEl) {
    var flow = getFlow(pageEl);
    if (!flow || !block || block.parentNode !== flow) return;
    flow.removeChild(block);
  }

  function findParagraphTarget(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return null;
    if (block.matches("p, li")) return block;
    return block.querySelector("p, li");
  }

  function splitParagraphBlock(block, pageEl, reportDoc, sectionMeta) {
    var target = findParagraphTarget(block);
    if (!target) return moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta);

    var text = String(target.textContent || "").trim();
    if (!text) return pageEl;

    var words = text.split(/\s+/);
    var firstPart = block.cloneNode(true);
    var firstTarget = findParagraphTarget(firstPart);
    if (!firstTarget) return moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta);

    firstTarget.textContent = "";
    appendAndCheck(firstPart, pageEl);

    var low = 1;
    var high = words.length;
    var best = 0;
    while (low <= high) {
      var mid = Math.floor((low + high) / 2);
      firstTarget.textContent = words.slice(0, mid).join(" ");
      var fit = !isFlowOverflowing(getFlow(pageEl), pageEl) && !isPageOverflowing(pageEl);
      if (fit) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (best === 0) {
      removeFromFlow(firstPart, pageEl);
      return moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta);
    }

    firstTarget.textContent = words.slice(0, best).join(" ");
    var remaining = words.slice(best).join(" ");
    if (!remaining) return pageEl;

    var rest = block.cloneNode(true);
    var restTarget = findParagraphTarget(rest);
    if (!restTarget) return pageEl;
    restTarget.textContent = remaining;
    var nextPage = ensureNextPageForSection(pageEl, reportDoc, sectionMeta, true);
    return appendBlockWithPagination(rest, nextPage, reportDoc, null, sectionMeta);
  }

  function splitListBlock(block, pageEl, reportDoc, sectionMeta) {
    var list = block.matches("ul, ol") ? block : block.querySelector("ul, ol");
    if (!list) return moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta);

    var items = toArray(list.children);
    if (!items.length) return pageEl;

    var currentPage = pageEl;
    var start = 0;

    while (start < items.length) {
      var chunk = block.cloneNode(true);
      var chunkList = chunk.matches("ul, ol") ? chunk : chunk.querySelector("ul, ol");
      if (!chunkList) return currentPage;
      chunkList.innerHTML = "";
      appendAndCheck(chunk, currentPage);

      var used = 0;
      while (start + used < items.length) {
        chunkList.appendChild(items[start + used].cloneNode(true));
        if (isFlowOverflowing(getFlow(currentPage), currentPage) || isPageOverflowing(currentPage)) {
          chunkList.removeChild(chunkList.lastElementChild);
          break;
        }
        used += 1;
      }

      if (used === 0) {
        removeFromFlow(chunk, currentPage);
        currentPage = ensureNextPageForSection(currentPage, reportDoc, sectionMeta, true);
        var forced = block.cloneNode(true);
        var forcedList = forced.matches("ul, ol") ? forced : forced.querySelector("ul, ol");
        if (!forcedList) return currentPage;
        forcedList.innerHTML = items[start].outerHTML;
        appendAndCheck(forced, currentPage);
        start += 1;
      } else {
        start += used;
        if (start < items.length) currentPage = ensureNextPageForSection(currentPage, reportDoc, sectionMeta, true);
      }
    }
    return currentPage;
  }

  function splitTableBlock(block, pageEl, reportDoc, sectionMeta) {
    var table = block.matches("table") ? block : block.querySelector("table");
    if (!table) return moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta);

    if (!block.matches("table") && block.querySelectorAll("table").length > 1) {
      return splitRichBlockByChildren(block, pageEl, reportDoc, sectionMeta);
    }

    var rows = toArray(table.querySelectorAll("tbody tr"));
    if (!rows.length) return moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta);

    var currentPage = pageEl;
    var rowIndex = 0;

    while (rowIndex < rows.length) {
      var chunk = block.cloneNode(true);
      var chunkTable = chunk.matches("table") ? chunk : chunk.querySelector("table");
      var chunkBody = chunkTable ? chunkTable.querySelector("tbody") : null;
      if (!chunkTable || !chunkBody) return currentPage;
      chunkBody.innerHTML = "";
      appendAndCheck(chunk, currentPage);

      var used = 0;
      while (rowIndex + used < rows.length) {
        chunkBody.appendChild(rows[rowIndex + used].cloneNode(true));
        if (isFlowOverflowing(getFlow(currentPage), currentPage) || isPageOverflowing(currentPage)) {
          chunkBody.removeChild(chunkBody.lastElementChild);
          break;
        }
        used += 1;
      }

      if (used === 0) {
        removeFromFlow(chunk, currentPage);
        currentPage = ensureNextPageForSection(currentPage, reportDoc, sectionMeta, true);
        var forced = block.cloneNode(true);
        var forcedTable = forced.matches("table") ? forced : forced.querySelector("table");
        var forcedBody = forcedTable ? forcedTable.querySelector("tbody") : null;
        if (!forcedBody) return currentPage;
        forcedBody.innerHTML = rows[rowIndex].outerHTML;
        appendAndCheck(forced, currentPage);
        rowIndex += 1;
      } else {
        rowIndex += used;
        if (rowIndex < rows.length) currentPage = ensureNextPageForSection(currentPage, reportDoc, sectionMeta, true);
      }
    }
    return currentPage;
  }

  function splitRichBlockByChildren(block, pageEl, reportDoc, sectionMeta) {
    var children = toArray(block.childNodes);
    if (!children.length) return moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta);

    var first = block.cloneNode(false);
    appendAndCheck(first, pageEl);

    var splitAt = 0;
    for (var i = 0; i < children.length; i += 1) {
      first.appendChild(children[i].cloneNode(true));
      if (isFlowOverflowing(getFlow(pageEl), pageEl) || isPageOverflowing(pageEl)) {
        first.removeChild(first.lastChild);
        break;
      }
      splitAt = i + 1;
    }

    if (splitAt === 0) {
      removeFromFlow(first, pageEl);
      return moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta);
    }

    if (splitAt >= children.length) return pageEl;

    var rest = block.cloneNode(false);
    for (var j = splitAt; j < children.length; j += 1) rest.appendChild(children[j].cloneNode(true));
    var nextPage = ensureNextPageForSection(pageEl, reportDoc, sectionMeta, true);
    return appendBlockWithPagination(rest, nextPage, reportDoc, null, sectionMeta);
  }

  function moveWholeBlockToNextPage(block, pageEl, reportDoc, sectionMeta) {
    var nextPage = ensureNextPageForSection(pageEl, reportDoc, sectionMeta, true);
    ensureImageSizeForPage(block, nextPage);
    appendAndCheck(block, nextPage);
    return nextPage;
  }

  function keepHeadingWithNext(currentPage, headingBlock, nextBlock) {
    if (!nextBlock) return true;
    var flow = getFlow(currentPage);
    if (!flow) return true;

    var headingProbe = headingBlock.cloneNode(true);
    flow.appendChild(headingProbe);
    var fitHeading = !isFlowOverflowing(flow, currentPage) && !isPageOverflowing(currentPage);

    var fitBoth = fitHeading;
    if (fitHeading) {
      var nextProbe = nextBlock.cloneNode(true);
      flow.appendChild(nextProbe);
      fitBoth = !isFlowOverflowing(flow, currentPage) && !isPageOverflowing(currentPage);
      flow.removeChild(nextProbe);
    }
    flow.removeChild(headingProbe);
    return fitBoth;
  }

  function appendBlockWithPagination(block, pageEl, reportDoc, nextBlock, sectionMeta) {
    if (!block) return pageEl;
    var currentPage = pageEl;
    var flow = getFlow(currentPage);
    if (!flow) return currentPage;

    if (block.classList && block.classList.contains("force-new-page") && flow.childElementCount > 0) {
      currentPage = ensureNextPageForSection(currentPage, reportDoc, sectionMeta, true);
      flow = getFlow(currentPage);
    }

    if (blockIsHeading(block) && !keepHeadingWithNext(currentPage, block, nextBlock) && flow.childElementCount > 0) {
      currentPage = ensureNextPageForSection(currentPage, reportDoc, sectionMeta, true);
      flow = getFlow(currentPage);
    }

    ensureImageSizeForPage(block, currentPage);
    var fit = appendAndCheck(block, currentPage);
    if (fit) return currentPage;

    removeFromFlow(block, currentPage);

    if (blockIsTable(block)) return splitTableBlock(block, currentPage, reportDoc, sectionMeta);
    if (blockIsList(block)) return splitListBlock(block, currentPage, reportDoc, sectionMeta);
    if (blockCanSplitAsParagraph(block) && !blockIsImage(block)) return splitParagraphBlock(block, currentPage, reportDoc, sectionMeta);
    if ((block.classList && block.classList.contains("avoid-break")) || blockIsImage(block)) {
      return moveWholeBlockToNextPage(block, currentPage, reportDoc, sectionMeta);
    }
    return splitRichBlockByChildren(block, currentPage, reportDoc, sectionMeta);
  }

  function extractBlocksFromFlow(flowEl) {
    if (!flowEl) return [];
    normalizeFlowForPagination(flowEl);
    var blocks = [];
    toArray(flowEl.childNodes).forEach(function (node) {
      if (isBlankTextNode(node)) return;
      if (node.nodeType === Node.TEXT_NODE) {
        var p = document.createElement("p");
        p.textContent = String(node.textContent || "").trim();
        blocks.push(p);
        return;
      }
      blocks.push(node.cloneNode(true));
    });
    return blocks;
  }

  function moveExcessTitleToFlow(pageEl) {
    var titleRich = pageEl.querySelector(".report-section-title-rich");
    var flow = getFlow(pageEl);
    if (!titleRich || !flow) return;

    var children = toArray(titleRich.childNodes);
    var firstRealFound = false;
    var excess = [];
    for (var i = 0; i < children.length; i += 1) {
      if (!firstRealFound && !isBlankTextNode(children[i])) {
        firstRealFound = true;
        continue;
      }
      if (firstRealFound) excess.push(children[i]);
    }
    if (!excess.length) return;

    var ref = flow.firstChild;
    for (var j = 0; j < excess.length; j += 1) {
      titleRich.removeChild(excess[j]);
      if (ref) flow.insertBefore(excess[j], ref); else flow.appendChild(excess[j]);
    }
  }

  function hasFlowContent(pageEl) {
    var flow = getFlow(pageEl);
    return Boolean(flow && flow.childNodes.length);
  }

  function captureSectionsCache(reportDoc) {
    if (!reportDoc) return null;
    if (reportDoc.__paginationSectionsCache) return reportDoc.__paginationSectionsCache;

    var basePages = getBaseSectionPages(reportDoc);
    if (!basePages.length) return null;

    var sections = basePages.map(function (basePage, index) {
      restoreSourceSnapshot(basePage);
      moveExcessTitleToFlow(basePage);
      var flow = getFlow(basePage);
      var title = basePage.querySelector(".section-title");
      var numberEl = title ? title.querySelector(".section-title-number") : null;
      var richTitleEl = title ? title.querySelector(".report-section-title-rich") : null;

      return {
        anchorId: String(basePage.id || "").trim(),
        numberLabel: String(numberEl ? numberEl.textContent : (index + 1 + ".")),
        titleHtml: String(richTitleEl ? richTitleEl.innerHTML : "CAPITULO"),
        blocks: extractBlocksFromFlow(flow)
      };
    });

    var rootPage = basePages[0];
    rootPage.setAttribute("data-pagination-root", "true");

    for (var i = 1; i < basePages.length; i += 1) {
      if (basePages[i].parentNode) basePages[i].parentNode.removeChild(basePages[i]);
    }

    reportDoc.__paginationSectionsCache = {
      rootPage: rootPage,
      sections: sections
    };
    return reportDoc.__paginationSectionsCache;
  }

  function clearRenderedPagination(reportDoc, rootPage) {
    toArray(reportDoc.querySelectorAll(".report-page[data-generated-overflow='true']")).forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    if (!rootPage) return;
    rootPage.removeAttribute("id");
    rootPage.removeAttribute("data-page-section-anchor");
    rootPage.removeAttribute("data-page-section-continued");
    var flow = getFlow(rootPage);
    if (flow) flow.innerHTML = "";
  }

  function repaginateSections(reportDoc) {
    if (!reportDoc) return;
    var cache = captureSectionsCache(reportDoc);
    if (!cache || !cache.rootPage || !Array.isArray(cache.sections) || !cache.sections.length) return;

    var rootPage = cache.rootPage;
    clearRenderedPagination(reportDoc, rootPage);

    var currentPage = rootPage;
    var firstSection = cache.sections[0];
    setPageHeader(currentPage, firstSection, false);
    if (firstSection.anchorId) currentPage.id = firstSection.anchorId;
    currentPage.setAttribute("data-page-section-anchor", firstSection.anchorId || "");
    currentPage.setAttribute("data-page-section-continued", "false");

    for (var sectionIdx = 0; sectionIdx < cache.sections.length; sectionIdx += 1) {
      var sectionMeta = cache.sections[sectionIdx];
      var blocks = Array.isArray(sectionMeta.blocks) ? sectionMeta.blocks : [];

      if (sectionIdx > 0) {
        if (!hasFlowContent(currentPage)) {
          setPageHeader(currentPage, sectionMeta, false);
          currentPage.removeAttribute("id");
          if (sectionMeta.anchorId) currentPage.id = sectionMeta.anchorId;
          currentPage.setAttribute("data-page-section-anchor", sectionMeta.anchorId || "");
          currentPage.setAttribute("data-page-section-continued", "false");
        } else {
          var inlineHeader = buildInlineSectionHeader(sectionMeta);
          var firstContentProbe = blocks.length ? blocks[0].cloneNode(true) : null;
          var canStay = keepHeadingWithNext(currentPage, inlineHeader, firstContentProbe);
          if (!canStay) {
            currentPage = ensureNextPageForSection(currentPage, reportDoc, sectionMeta, false);
            if (sectionMeta.anchorId) currentPage.id = sectionMeta.anchorId;
          } else {
            if (sectionMeta.anchorId) inlineHeader.id = sectionMeta.anchorId;
            appendAndCheck(inlineHeader, currentPage);
          }
        }
      }

      for (var blockIdx = 0; blockIdx < blocks.length; blockIdx += 1) {
        var current = blocks[blockIdx].cloneNode(true);
        var next = blocks[blockIdx + 1] ? blocks[blockIdx + 1].cloneNode(true) : null;
        currentPage = appendBlockWithPagination(current, currentPage, reportDoc, next, sectionMeta);
      }
    }
  }

  function updateTocPages(reportDoc) {
    if (!reportDoc) return;
    var pages = toArray(reportDoc.querySelectorAll(".report-page"));

    toArray(reportDoc.querySelectorAll(".report-toc li")).forEach(function (item) {
      var titleLink = item.querySelector(".report-toc-title, .report-toc-link");
      var pageLink = item.querySelector(".report-toc-page");
      if (!titleLink || !pageLink) return;
      var href = String(titleLink.getAttribute("href") || "");
      if (!href || href.charAt(0) !== "#") return;
      var anchorId = href.slice(1);
      if (!anchorId) return;

      var anchorEl = document.getElementById(anchorId);
      if (!anchorEl) return;
      var pageEl = anchorEl.closest(".report-page");
      if (!pageEl) return;
      var pageNumber = pages.indexOf(pageEl) + 1;
      if (pageNumber <= 0) return;
      pageLink.textContent = String(pageNumber);
    });
  }

  function bindImageReflow(reportDoc) {
    if (!reportDoc) return;
    toArray(reportDoc.querySelectorAll("img")).forEach(function (img) {
      if (img.complete) return;
      img.addEventListener("load", debounceRun, { once: true });
      img.addEventListener("error", debounceRun, { once: true });
    });
  }

  function run() {
    var reportDoc = document.querySelector(".report-doc");
    if (!reportDoc) return;
    repaginateSections(reportDoc);
    updateTocPages(reportDoc);
    bindImageReflow(reportDoc);
    window.__reportPaginationDone = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      schedule(run);
    });
  } else {
    schedule(run);
  }

  window.addEventListener("load", function () {
    schedule(run);
  });

  window.addEventListener("resize", function () {
    debounceRun();
  });
})();
