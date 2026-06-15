console.log("[STARTUP] app.js loaded");

/* ─── THEME ─── */

function applyTheme(t) {
  const isDark = t === "dark";
  document.body.classList.toggle("dark", isDark);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = isDark ? "☀️" : "🌙";
  localStorage.setItem("theme", t);
}

function toggleTheme() {
  const current = localStorage.getItem("theme") || "light";
  applyTheme(current === "light" ? "dark" : "light");
}

/* ─── STYLE VARS ─── */

function getStyleVar(key) {
  return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
}

function updateStyleVar(key, value) {
  document.documentElement.style.setProperty(key, value);
  localStorage.setItem(key, value);
}

function refreshUI() {
  document.getElementById("fontValue").innerText = parseInt(getStyleVar("--font-size"));
  document.getElementById("lineValue").innerText = parseFloat(getStyleVar("--line-height")).toFixed(1);
}

function loadPreferences() {
  console.log("[STARTUP] loadPreferences called");
  const fs = localStorage.getItem("--font-size");
  const lh = localStorage.getItem("--line-height");
  if (fs) document.documentElement.style.setProperty("--font-size", fs);
  if (lh) document.documentElement.style.setProperty("--line-height", lh);
  refreshUI();
}

function changeFont(delta) {
  let size = parseInt(getStyleVar("--font-size"));
  size = Math.max(12, Math.min(40, size + delta));
  updateStyleVar("--font-size", size + "px");
  refreshUI();
  void document.body.offsetHeight;
  repaginate();
}

function changeLineHeight(delta) {
  let lh = parseFloat(getStyleVar("--line-height"));
  lh = Math.max(1.2, Math.min(3, lh + delta));
  updateStyleVar("--line-height", lh);
  refreshUI();
  void document.body.offsetHeight;
  repaginate();
}

/* ─── HAMBURGER MENU ─── */

function openMenu() {
  document.getElementById("menuPopup").classList.add("open");
}

function closeMenu() {
  document.getElementById("menuPopup").classList.remove("open");
}

function isMenuOpen() {
  return document.getElementById("menuPopup").classList.contains("open");
}

// Close menu when clicking outside
document.addEventListener("click", e => {
  if (!isMenuOpen()) return;
  const popup = document.getElementById("menuPopup");
  const btn   = document.getElementById("menuBtn");
  if (!popup.contains(e.target) && !btn.contains(e.target)) {
    closeMenu();
  }
});

/* ─── SCROLL MODE LABEL ─── */

function updateScrollModeBtn() {
  const btn = document.getElementById("scrollModeBtn");
  if (btn) btn.textContent = scrollMode ? "Pages" : "Scroll";
}

/* ─── HISTORY PANEL ─── */

function isMobile() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function openHistoryPanel() {
  const panel = document.getElementById("historyPanel");
  if (isMobile()) {
    panel.style.display = "block";
    void panel.offsetHeight;
    panel.classList.add("open");
  } else {
    panel.style.display = "block";
  }
  renderHistory();
}

function closeHistoryPanel() {
  const panel = document.getElementById("historyPanel");
  if (isMobile()) {
    panel.classList.remove("open");
    panel.addEventListener("transitionend", () => {
      if (!panel.classList.contains("open")) panel.style.display = "none";
    }, { once: true });
  } else {
    panel.style.display = "none";
  }
}

function isHistoryPanelOpen() {
  const panel = document.getElementById("historyPanel");
  return isMobile()
    ? panel.classList.contains("open")
    : panel.style.display === "block";
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const history = getBookHistory();
  list.innerHTML = "";

  history.forEach(book => {
    const item = document.createElement("div");
    item.className = "history-item";

    const progressPercent = book.progress || 0;
    const progressText = progressPercent >= 100 ? "✓ Completed" : `${progressPercent}% read`;

    item.innerHTML = `
      <div class="history-title">${book.title}</div>
      <div class="history-author">${book.author}</div>
      <div class="history-progress">${progressText}</div>
      <div class="history-actions"></div>
    `;

    const actions = item.querySelector(".history-actions");

    const goBackBtn = document.createElement("button");
    goBackBtn.className = "btn history-go-back";
    goBackBtn.textContent = "Go back";
    goBackBtn.onclick = async () => {
      console.log("[HISTORY] Go back clicked for book:", book.id);
      closeHistoryPanel();
      showLoadingScreen("Loading your book...", "📚 Restoring your place…");
      setStepActive("book");
      try {
        await Promise.race([
          loadHistoryBook(book.id),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Book load timeout")), 50000)
          )
        ]);
      } catch (err) {
        console.error("[HISTORY] Load error/timeout:", err.message);
      }
      markStepComplete("book");
      setLoadingProgress(100);
      hideLoadingScreen();
    };

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn history-remove";
    removeBtn.innerHTML = "🗑️";
    removeBtn.title = "Remove from history";
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeBookFromHistory(book.id);
      renderHistory();
    };

    actions.appendChild(goBackBtn);
    actions.appendChild(removeBtn);
    list.appendChild(item);
  });
}

/* ─── LOADING SCREEN ─── */

function showLoadingScreen(title = "Loading your book...", status = "") {
  const loadingContainer = document.getElementById("loadingContainer");
  const spread           = document.querySelector(".spread");
  const controls         = document.querySelector(".controls");
  const scrollContainer  = document.getElementById("scrollContainer");

  if (loadingContainer) loadingContainer.style.display = "flex";
  if (spread)           spread.style.display           = "none";
  if (controls)         controls.style.display         = "none";
  if (scrollContainer)  scrollContainer.style.display  = "none";

  document.querySelectorAll(".loading-step").forEach(s => {
    s.style.display    = "none";
    s.style.color      = "var(--muted)";
    s.style.fontWeight = "normal";
    s.classList.remove("active", "complete");
    const icon = s.querySelector(".step-icon");
    if (icon) icon.textContent = "○";
  });

  setLoadingStatus(title, status, true);
  showLoadingProgress("");
  setLoadingProgress(0);
}

function hideLoadingScreen() {
  const loadingContainer = document.getElementById("loadingContainer");
  const spread           = document.querySelector(".spread");
  const controls         = document.querySelector(".controls");
  const scrollContainer  = document.getElementById("scrollContainer");

  hideLoadingProgress();

  if (loadingContainer) loadingContainer.style.display = "none";

  if (scrollMode) {
    if (scrollContainer) scrollContainer.style.display = "block";
  } else {
    if (spread)   spread.style.display   = "flex";
    if (controls) controls.style.display = "flex";
  }
}

/* ─── NEXT BOOK ─── */

async function loadNextBook() {
  console.log("[EVENT] loadNextBook called");
  closeMenu();
  closeHistoryPanel();
  showLoadingScreen("Loading your book...", "Fetching a new book…");
  setStepActive("book");

  try {
    await Promise.race([
      loadSampleBook(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Book load timeout")), 50000)
      )
    ]);
  } catch (err) {
    console.error("[NEXT BOOK] Error/timeout:", err.message);
    setBook({
      id: "fallback",
      title: "Fallback Book",
      author: "Local Generator",
      text: generateLocalBook(),
      startPosition: 0
    });
  }

  markStepComplete("book");
  setLoadingProgress(100);
  hideLoadingScreen();
}

/* ─── EVENT BINDINGS ─── */

document.getElementById("menuBtn").onclick    = () => isMenuOpen() ? closeMenu() : openMenu();
document.getElementById("themeToggle").onclick = () => { toggleTheme(); };
document.getElementById("fontIncrease").onclick = () => changeFont(2);
document.getElementById("fontDecrease").onclick = () => changeFont(-2);
document.getElementById("lineIncrease").onclick = () => changeLineHeight(0.1);
document.getElementById("lineDecrease").onclick = () => changeLineHeight(-0.1);
document.getElementById("nextPage").onclick    = nextPage;
document.getElementById("prevPage").onclick    = prevPage;
document.getElementById("nextBookBtn").onclick = () => { loadNextBook(); };
document.getElementById("historyBtn").onclick  = () => {
  closeMenu();
  isHistoryPanelOpen() ? closeHistoryPanel() : openHistoryPanel();
};
document.getElementById("scrollModeBtn").onclick = () => {
  setScrollMode(!scrollMode);
  updateScrollModeBtn();
};
document.getElementById("historyClose").onclick = closeHistoryPanel;

/* ─── STARTUP ─── */

window.onload = async function () {
  console.log("[STARTUP] === PAGE STARTUP BEGIN ===");

  setStepActive("theme");
  applyTheme(localStorage.getItem("theme") || "light");
  markStepComplete("theme");

  setStepActive("preferences");
  loadPreferences();
  markStepComplete("preferences");

  setStepActive("pagination");
  initPagination({
    leftPageEl:  document.getElementById("leftPage"),
    rightPageEl: document.getElementById("rightPage"),
    titleEl:     document.getElementById("title"),
    authorEl:    document.getElementById("author")
  });
  markStepComplete("pagination");

  // Sync scroll button label after initPagination sets scrollMode
  updateScrollModeBtn();

  setStepActive("book");
  setLoadingStatus("Loading your book...", "Fetching content...", true);
  showLoadingProgress("Preparing book...");
  setLoadingProgress(10);

  try {
    await Promise.race([
      restoreSavedBook(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Book load timeout")), 50000)
      )
    ]);
  } catch (err) {
    console.error("[STARTUP] Book load error/timeout:", err.message);
    setBook({
      id: "fallback",
      title: "Fallback Book",
      author: "Local Generator",
      text: generateLocalBook(),
      startPosition: 0
    });
  }

  setLoadingProgress(90);
  markStepComplete("book");
  setLoadingProgress(100);
  hideLoadingScreen();

  console.log("[STARTUP] === PAGE STARTUP COMPLETE ===");
};
