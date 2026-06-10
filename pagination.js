console.log("[STARTUP] pagination.js loaded");

/* ========== LOADING SCREEN ========== */

function setLoadingStatus(title, status = "", showSteps = false) {
  const titleEl = document.getElementById("loadingTitle");
  const statusEl = document.getElementById("loadingStatus");
  const stepsContainer = document.getElementById("loadingSteps");
  
  console.log("[LOADING] setLoadingStatus:", title, status, showSteps);
  
  if (titleEl) {
    titleEl.textContent = title;
    console.log("[LOADING] Updated title to:", titleEl.textContent);
  }
  if (statusEl) {
    statusEl.textContent = status;
    console.log("[LOADING] Updated status to:", statusEl.textContent);
  }
  if (stepsContainer) {
    stepsContainer.style.display = showSteps ? "block" : "none";
    console.log("[LOADING] Set steps display to:", stepsContainer.style.display);
  }
}

function hideLoadingProgress() {
  const container = document.getElementById("loadingProgressContainer");
  if (container) container.style.display = "none";
}

function setLoadingProgress(percent) {
  const fill = document.getElementById("loadingProgressFill");
  if (fill) {
    fill.style.width = Math.min(100, Math.max(0, percent)) + "%";
    console.log("[LOADING] Progress set to:", percent + "%");
  }
}

function showLoadingProgress(label = "") {
  const container = document.getElementById("loadingProgressContainer");
  console.log("[LOADING] showLoadingProgress called");
  
  if (container) {
    container.style.display = "block";
    console.log("[LOADING] Progress container displayed");
    
    if (label) {
      const text = document.getElementById("loadingProgressText");
      if (text) {
        text.textContent = label;
        console.log("[LOADING] Progress text set to:", label);
      }
    }
  }
}

function markStepComplete(stepId) {
  const step = document.getElementById("step-" + stepId);
  console.log("[LOADING] Marking step complete:", stepId, step);
  
  if (step) {
    step.style.display = "block";
    step.classList.remove("active");
    step.classList.add("complete");
    step.style.color = "#4CAF50";
    step.style.fontWeight = "normal";
    
    const icon = step.querySelector(".step-icon");
    if (icon) {
      icon.textContent = "✓";
      console.log("[LOADING] Set icon to ✓ for step:", stepId);
    }
  }
}

function setStepActive(stepId) {
  console.log("[LOADING] Setting step active:", stepId);
  
  const allSteps = document.querySelectorAll(".loading-step");
  console.log("[LOADING] Found", allSteps.length, "total steps");
  
  allSteps.forEach(s => {
    if (s.classList.contains("active")) {
      s.classList.remove("active");
      s.classList.add("complete");
      s.style.color = "#4CAF50";
      const icon = s.querySelector(".step-icon");
      if (icon) icon.textContent = "✓";
    }
  });
  
  const step = document.getElementById("step-" + stepId);
  console.log("[LOADING] Found step element:", step ? "yes" : "no");
  
  if (step) {
    step.style.display = "block";
    step.classList.add("active");
    step.style.color = "#111111";
    step.style.fontWeight = "bold";
    
    const icon = step.querySelector(".step-icon");
    if (icon) {
      icon.textContent = "⟳";
      console.log("[LOADING] Set icon to ⟳ for step:", stepId);
    }
  }
}

/* ========== END LOADING SCREEN ========== */

let pages = [];
let currentText = "";
let words = [];
let totalWords = 0;
let wordIndex = 0;

let leftEl;
let rightEl;
let titleEl;
let authorEl;

let isDoublePage = false;
let resizeTimer = null;
const RESIZE_DELAY = 120;

let paginationCache = {};

// ── Scroll mode ──
let scrollMode = false;
let scrollEl = null;       // the scroll container div
let scrollSyncTimer = null;

// ── Swipe ──
let touchStartX = 0;
let touchStartY = 0;
const SWIPE_THRESHOLD = 50;  // px
const SWIPE_ANGLE_MAX = 45;  // degrees — reject near-vertical swipes

function getCacheKey() {
  const style = getComputedStyle(leftEl);
  return `${leftEl.clientWidth}|${leftEl.clientHeight}|${style.fontSize}|${style.lineHeight}|${style.fontFamily}`;
}

/* ---------- MOBILE HELPERS ---------- */

function isMobileViewport() {
  return window.matchMedia("(max-width: 640px)").matches;
}

/* ---------- INIT ---------- */

function initPagination(config) {
  console.log("[STARTUP] initPagination called");
  leftEl  = config.leftPageEl;
  rightEl = config.rightPageEl;
  titleEl = config.titleEl;
  authorEl = config.authorEl;

  detectLayout();

  // Restore scroll mode preference
  scrollMode = isMobileViewport() && localStorage.getItem("scrollMode") === "true";
  applyScrollModeUI();

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // If we've crossed the mobile breakpoint, recheck scroll mode
      if (!isMobileViewport() && scrollMode) {
        // Force page mode on desktop regardless of saved pref
        setScrollMode(false, /* save= */ false);
      }
      repaginate();
    }, RESIZE_DELAY);
  });

  initSwipe();

  console.log("[STARTUP] initPagination complete, layout:", isDoublePage ? "double-page" : "single-page", "scrollMode:", scrollMode);
}

function detectLayout() {
  isDoublePage = window.innerWidth >= 900;
  document.body.classList.toggle("single", !isDoublePage);
}

/* ---------- SCROLL MODE ---------- */

function setScrollMode(enabled, save = true) {
  scrollMode = enabled;
  if (save) localStorage.setItem("scrollMode", enabled ? "true" : "false");
  applyScrollModeUI();

  if (enabled) {
    enterScrollMode();
  } else {
    exitScrollMode();
  }
}

function applyScrollModeUI() {
  const btn = document.getElementById("scrollModeBtn");
  if (!btn) return;
  btn.textContent = scrollMode ? "Pages" : "Scroll";
}

function enterScrollMode() {
  if (!currentText) return;
  console.log("[SCROLL] Entering scroll mode");

  // Hide paginated spread and page controls
  const spread   = document.querySelector(".spread");
  const controls = document.querySelector(".controls");
  if (spread)   spread.style.display   = "none";
  if (controls) controls.style.display = "none";

  // Build or show the scroll container
  if (!scrollEl) {
    scrollEl = document.createElement("div");
    scrollEl.id        = "scrollContainer";
    scrollEl.className = "scroll-container";
    document.querySelector(".reader").appendChild(scrollEl);
  }

  scrollEl.style.display = "block";
  scrollEl.innerHTML     = "";

  // Render text as paragraphs
  const paragraphs = currentText.split(/\n\n+/);
  paragraphs.forEach(para => {
    const p = document.createElement("p");
    p.className   = "scroll-para";
    p.textContent = para.trim();
    scrollEl.appendChild(p);
  });

  // Restore scroll position from wordIndex
  requestAnimationFrame(() => {
    const ratio = totalWords > 0 ? wordIndex / totalWords : 0;
    scrollEl.scrollTop = ratio * (scrollEl.scrollHeight - scrollEl.clientHeight);
    attachScrollSync();
  });
}

function exitScrollMode() {
  console.log("[SCROLL] Exiting scroll mode");

  if (scrollEl) scrollEl.style.display = "none";
  detachScrollSync();

  const spread   = document.querySelector(".spread");
  const controls = document.querySelector(".controls");
  if (spread)   spread.style.display   = "flex";
  if (controls) controls.style.display = "flex";

  // Re-render at current word index
  if (currentText) repaginate();
}

function attachScrollSync() {
  if (!scrollEl) return;
  scrollEl.addEventListener("scroll", onScroll, { passive: true });
}

function detachScrollSync() {
  if (!scrollEl) return;
  scrollEl.removeEventListener("scroll", onScroll);
}

function onScroll() {
  clearTimeout(scrollSyncTimer);
  scrollSyncTimer = setTimeout(() => {
    if (!scrollEl || !totalWords) return;
    const ratio    = scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
    wordIndex      = Math.round(ratio * totalWords);
    updateProgressBar();
    savePosition(wordIndex);
    if (typeof currentBook !== "undefined" && currentBook?.id) {
      updateBookProgress(currentBook.id, wordIndex, totalWords);
    }
  }, 200);
}

/* ---------- SWIPE ---------- */

function initSwipe() {
  const spread = document.querySelector(".spread");
  if (!spread) return;

  spread.addEventListener("touchstart", e => {
    if (scrollMode) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  spread.addEventListener("touchend", e => {
    if (scrollMode) return;
    if (!isMobileViewport()) return;

    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;

    // Reject mostly-vertical swipes
    const angle = Math.abs(Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI);
    if (angle > SWIPE_ANGLE_MAX) return;

    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    if (dx < 0) {
      nextPage();
    } else {
      prevPage();
    }
  }, { passive: true });
}

/* ---------- BOOK SETUP ---------- */

function normalizeText(text) {
  let normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  normalized = normalized.replace(/\n{2,}/g, "\0PARAGRAPH_BREAK\0");
  normalized = normalized.replace(/\n(?! *\n)/g, " ");
  normalized = normalized.replace(/[ \t]+/g, " ");
  normalized = normalized.replace(/\0PARAGRAPH_BREAK\0/g, "\n\n");
  return normalized.trim();
}

function setBook(book) {
  if (!leftEl || !book) return;
  console.log("[STARTUP] setBook called for:", book.title, "by", book.author, "(", book.id, ")");

  currentText = normalizeText(book.text || "");
  words       = currentText.split(" ");
  totalWords  = words.length;

  paginationCache = {};

  titleEl.innerText  = book.title  || "Unknown";
  authorEl.innerText = book.author || "";

  wordIndex = clampWordIndex(book.startPosition || 0);

  console.log("[STARTUP] Total words:", totalWords, "Starting at word index:", wordIndex);

  if (scrollMode && isMobileViewport()) {
    // Rebuild scroll view for new book
    if (scrollEl) {
      scrollEl.remove();
      scrollEl = null;
    }
    enterScrollMode();
  } else {
    requestAnimationFrame(() => {
      rebuild();
      const cacheKey = getCacheKey();
      paginationCache[cacheKey] = pages;
      console.log("[STARTUP] Book paginated into", pages.length, "pages");
      render();
    });
  }
}

/* ---------- REBUILD ---------- */

function repaginate() {
  if (!currentText) {
    console.warn("[REPAGINATE] No current text available");
    return;
  }

  if (scrollMode && isMobileViewport()) {
    // Nothing to repaginate in scroll mode; just refresh scroll position
    return;
  }

  console.log("[REPAGINATE] Repaginating - layout:", isDoublePage ? "double" : "single");

  detectLayout();

  const cacheKey = getCacheKey();

  if (paginationCache[cacheKey]) {
    pages     = paginationCache[cacheKey];
    wordIndex = clampWordIndex(wordIndex);
    render();
  } else {
    requestAnimationFrame(() => {
      rebuild();
      paginationCache[cacheKey] = pages;
      wordIndex = clampWordIndex(wordIndex);
      console.log("[REPAGINATE] Rebuild complete, pages:", pages.length);
      render();
    });
  }
}

function rebuild() {
  pages = paginateWords(leftEl, words);
}

/* ---------- PAGINATION ---------- */

function paginateWords(container, wordsArray) {
  if (!wordsArray.length) return [];

  const style     = getComputedStyle(container);
  const maxHeight = container.clientHeight;
  const result    = [];

  const tester = document.createElement("div");
  tester.style.position    = "absolute";
  tester.style.visibility  = "hidden";
  tester.style.pointerEvents = "none";
  tester.style.width       = container.clientWidth + "px";
  tester.style.fontSize    = style.fontSize;
  tester.style.lineHeight  = style.lineHeight;
  tester.style.fontFamily  = style.fontFamily;
  tester.style.whiteSpace  = "pre-wrap";
  tester.style.wordBreak   = "break-word";

  document.body.appendChild(tester);

  let start       = 0;
  const total     = wordsArray.length;

  const measurePageSize = startIndex => {
    let low = 1, high = total - startIndex, best = 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      tester.innerText = wordsArray.slice(startIndex, startIndex + mid).join(" ");

      if (tester.offsetHeight <= maxHeight) { best = mid; low = mid + 1; }
      else                                  { high = mid - 1; }
    }

    return best;
  };

  while (start < total) {
    const count = measurePageSize(start);
    result.push(wordsArray.slice(start, start + count));
    start += count;
  }

  document.body.removeChild(tester);
  return result;
}

/* ---------- POSITION ---------- */

function getWordIndexFromPage(page) {
  let count = 0;
  for (let i = 0; i < page; i++) count += (pages[i] || []).length;
  return count;
}

function getPageFromWordIndex(index) {
  let count = 0;
  for (let p = 0; p < pages.length; p++) {
    const len = (pages[p] || []).length;
    if (index < count + len) return p;
    count += len;
  }
  return 0;
}

/* ---------- PROGRESS ---------- */

function updateProgressBar() {
  const fill = document.getElementById("progressFill");
  if (!fill) return;
  fill.style.width = totalWords
    ? Math.min(100, (wordIndex / totalWords) * 100) + "%"
    : "0%";
}

/* ---------- RENDER ---------- */

function render() {
  if (!pages.length) {
    console.warn("[RENDER] No pages available");
    return;
  }

  const page = getPageFromWordIndex(wordIndex);
  console.log("[RENDER] Rendering page", page, "of", pages.length, "at word index", wordIndex);

  if (isDoublePage) {
    leftEl.innerText  = (pages[page]     || []).join(" ");
    rightEl.innerText = (pages[page + 1] || []).join(" ");
  } else {
    leftEl.innerText  = (pages[page] || []).join(" ");
    rightEl.innerText = "";
  }

  updateProgressBar();
  savePosition(wordIndex);

  if (typeof currentBook !== "undefined" && currentBook?.id) {
    updateBookProgress(currentBook.id, wordIndex, totalWords);
  }
}

/* ---------- NAVIGATION ---------- */

function nextPage() {
  console.log("[NAV] nextPage called");
  const page = getPageFromWordIndex(wordIndex);
  const step = isDoublePage ? 2 : 1;
  const max  = pages.length - (isDoublePage ? 2 : 1);
  wordIndex  = getWordIndexFromPage(Math.min(max, page + step));
  console.log("[NAV] nextPage navigated to page", getPageFromWordIndex(wordIndex));
  render();
}

function prevPage() {
  console.log("[NAV] prevPage called");
  const page = getPageFromWordIndex(wordIndex);
  const step = isDoublePage ? 2 : 1;
  wordIndex  = getWordIndexFromPage(Math.max(0, page - step));
  console.log("[NAV] prevPage navigated to page", getPageFromWordIndex(wordIndex));
  render();
}

/* ---------- SAFETY ---------- */

function clampWordIndex(index) {
  return Math.max(0, Math.min(index, totalWords - 1));
}
