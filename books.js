console.log("[STARTUP] books.js loaded");

const BOOK_STORAGE_KEY   = "reader_books_read";
const CURRENT_BOOK_KEY   = "reader_current_book";
const POSITION_KEY       = "reader_word_index";
const HISTORY_KEY        = "reader_books_history";
const CATALOG_KEY        = "reader_pg_catalog";
const CATALOG_TTL_MS     = 24 * 60 * 60 * 1000; // 24 hours

let readBooks  = loadReadBooks();
console.log("[STARTUP] Loaded read books:", readBooks);
let currentBook = null;

/* ─────────────────── STORAGE HELPERS ─────────────────── */

function loadReadBooks() {
  try { return JSON.parse(localStorage.getItem(BOOK_STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveReadBooks() {
  localStorage.setItem(BOOK_STORAGE_KEY, JSON.stringify(readBooks));
}

function calculateTotalWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/* ─────────────────── CATALOG ─────────────────── */

/**
 * Returns the cached catalog array, or null if missing / expired.
 * Each entry: { id, title, author }
 */
function loadCachedCatalog() {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return null;
    const { timestamp, books } = JSON.parse(raw);
    if (Date.now() - timestamp > CATALOG_TTL_MS) return null;
    return books;
  } catch {
    return null;
  }
}

function saveCatalog(books) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify({ timestamp: Date.now(), books }));
  } catch (err) {
    console.warn("[CATALOG] Could not save catalog to localStorage:", err);
  }
}

/**
 * Minimal CSV parser that handles quoted fields.
 * Returns an array of objects keyed by the header row.
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  function splitLine(line) {
    const fields = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        fields.push(field); field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field);
    return fields;
  }

  const headers = splitLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h.trim()] = (vals[idx] || "").trim(); });
    rows.push(obj);
  }
  return rows;
}

/**
 * Fetch the local pg_catalog.csv and return a filtered array of usable books.
 * Filters to English plain-text books only.
 */
async function fetchAndParseCatalog() {
  setLoadingProgress(10);
  console.log("[CATALOG] Fetching local pg_catalog.csv");

  const res = await fetch("./pg_catalog.csv");
  if (!res.ok) throw new Error(`Could not load pg_catalog.csv (${res.status})`);
  const rawCSV = await res.text();
  if (!rawCSV || rawCSV.length < 100) throw new Error("pg_catalog.csv appears empty");

  setLoadingProgress(40);
  console.log("[CATALOG] CSV fetched, parsing…");

  const rows = parseCSV(rawCSV);
  console.log("[CATALOG] Total rows:", rows.length);

  // pg_catalog.csv columns (as of 2024):
  //   Text#, Type, Issued, Title, Language, Authors, Subjects, LoCC, Bookshelves
  const books = rows.filter(r => {
    const type     = (r["Type"]     || "").toLowerCase();
    const language = (r["Language"] || "").toLowerCase();
    // Keep only plain-text English books
    return type === "text" && language === "en";
  }).map(r => ({
    id:     "gutenberg_" + r["Text#"],
    pgId:   r["Text#"],
    title:  r["Title"]   || "Unknown Title",
    author: r["Authors"] || "Unknown Author",
  }));

  console.log("[CATALOG] Usable English text books:", books.length);
  setLoadingProgress(55);
  return books;
}

/**
 * Returns the catalog from cache, or fetches + caches it.
 */
async function getCatalog() {
  const cached = loadCachedCatalog();
  if (cached) {
    console.log("[CATALOG] Using cached catalog,", cached.length, "books");
    return cached;
  }

  console.log("[CATALOG] Cache miss – loading pg_catalog.csv");
  setLoadingStatus("Loading your book...", "📋 Loading book catalog…", true);
  const books = await fetchAndParseCatalog();
  saveCatalog(books);
  return books;
}

/* ─────────────────── TEXT FETCH ─────────────────── */

function gutenbergTextUrl(pgId) {
  // Canonical cache URL format
  return `https://www.gutenberg.org/cache/epub/${pgId}/pg${pgId}.txt`;
}

async function fetchText(url) {
  const normalizedUrl = url.replace(/^http:/, "https:");

  const attempts = [
    { prefix: "",                                      encode: false, name: "direct"     },
    { prefix: "https://r.jina.ai/http/",              encode: false, name: "jina"        },
    { prefix: "https://corsproxy.io/?",               encode: false, name: "corsproxy"  },
    { prefix: "https://api.allorigins.win/raw?url=",  encode: true,  name: "allorigins" },
  ];

  for (let i = 0; i < attempts.length; i++) {
    const p = attempts[i];
    setLoadingProgress(60 + i * 8);

    const target = p.prefix
      ? (p.encode ? p.prefix + encodeURIComponent(normalizedUrl) : p.prefix + normalizedUrl)
      : normalizedUrl;

    try {
      console.debug("[TEXT] Trying", p.name, target);

      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(target, { signal: controller.signal });
      clearTimeout(tid);

      if (!res.ok) { console.warn("[TEXT]", p.name, "→", res.status); continue; }

      const text = await res.text();
      if (text && text.length > 100) {
        setLoadingProgress(90);
        return text;
      }
      console.warn("[TEXT] Short/empty response from", p.name);
    } catch (err) {
      console.warn("[TEXT] Attempt failed:", p.name, err?.message);
    }
  }

  throw new Error("Could not fetch book text");
}

/* ─────────────────── BOOK PICKER ─────────────────── */

/**
 * Pick a random book from the catalog that hasn't been read,
 * fetch its text, and return a book object.
 */
async function getRandomBook() {
  console.log("[BOOK] getRandomBook called");

  let catalog;
  try {
    catalog = await getCatalog();
  } catch (err) {
    console.error("[BOOK] Catalog unavailable, using fallback:", err);
    return makeFallbackBook();
  }

  // Prefer unread books; fall back to any book if all read
  const unread = catalog.filter(b => !readBooks.includes(b.id));
  const pool   = unread.length > 0 ? unread : catalog;

  // Try up to 5 random picks in case a text fetch fails
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = pool[Math.floor(Math.random() * pool.length)];
    const textUrl = gutenbergTextUrl(entry.pgId);

    console.log("[BOOK] Trying:", entry.title, "by", entry.author, `(id=${entry.pgId})`);
    setLoadingStatus("Loading your book...", `📖 Fetching: ${entry.title}`, true);

    try {
      const text = await fetchText(textUrl);
      if (!text || text.length < 5000) {
        console.warn("[BOOK] Text too short, skipping");
        continue;
      }
      return { id: entry.id, title: entry.title, author: entry.author, text };
    } catch (err) {
      console.warn("[BOOK] Fetch failed for", entry.title, err?.message);
    }
  }

  console.log("[BOOK] All attempts failed, using fallback");
  return makeFallbackBook();
}

/* ─────────────────── FALLBACK GENERATOR ─────────────────── */

function makeFallbackBook() {
  return { id: "fallback", title: "Fallback Book", author: "Local Generator", text: generateLocalBook() };
}

function generateLocalBook() {
  const words = [
    "time","world","light","dark","river","stone","wind","forest",
    "memory","silence","journey","shadow","voice","thread","sky",
    "fire","water","earth","dream","path","night","day","moment",
    "hand","eye","heart","door","window","city","road"
  ];

  const out = [];
  for (let p = 0; p < 60; p++) {
    const paragraph = [];
    for (let s = 0; s < 5; s++) {
      const len = 6 + Math.floor(Math.random() * 10);
      const sentence = Array.from({ length: len }, () => words[Math.floor(Math.random() * words.length)]);
      let str = sentence.join(" ");
      str = str.charAt(0).toUpperCase() + str.slice(1) + ".";
      paragraph.push(str);
    }
    out.push("    " + paragraph.join(" "));
  }
  return out.join("\n\n");
}

/* ─────────────────── READ HISTORY ─────────────────── */

function markBookAsRead(book, currentWordIndex = 0) {
  if (!book?.id) return;

  const totalWords = calculateTotalWords(book.text);
  const progress   = totalWords > 0 ? (currentWordIndex / totalWords) * 100 : 0;
  const history    = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  const existingIdx = history.findIndex(item => item.id === book.id);

  const entry = {
    id:         book.id,
    title:      book.title,
    author:     book.author,
    totalWords,
    wordIndex:  currentWordIndex,
    progress:   Math.round(progress),
    lastRead:   new Date().toISOString()
  };

  if (existingIdx !== -1) history.splice(existingIdx, 1);
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));

  if (!readBooks.includes(book.id)) {
    readBooks.push(book.id);
    saveReadBooks();
  }
}

function updateBookProgress(bookId, wordIndex, totalWords) {
  const history = getBookHistory();
  const entry   = history.find(item => item.id === bookId);
  if (entry) {
    entry.wordIndex  = wordIndex;
    entry.totalWords = totalWords;
    entry.progress   = totalWords > 0 ? Math.round((wordIndex / totalWords) * 100) : 0;
    entry.lastRead   = new Date().toISOString();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }
}

function getBookHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function removeBookFromHistory(bookId) {
  if (!bookId) return;
  const history = getBookHistory().filter(item => item.id !== bookId);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  readBooks = readBooks.filter(id => id !== bookId);
  saveReadBooks();
}

/* ─────────────────── CURRENT BOOK STATE ─────────────────── */

function saveCurrentBook(book) {
  localStorage.setItem(CURRENT_BOOK_KEY, JSON.stringify(book));
  if (book?.id && book?.text) {
    try {
      localStorage.setItem(`book_text_${book.id}`, JSON.stringify({
        title: book.title, author: book.author, id: book.id, text: book.text
      }));
    } catch (err) {
      console.warn("[STORAGE] Could not cache book text:", err);
    }
  }
}

function loadCurrentBook() {
  try { return JSON.parse(localStorage.getItem(CURRENT_BOOK_KEY)); }
  catch { return null; }
}

function loadBookById(bookId) {
  try { return JSON.parse(localStorage.getItem(`book_text_${bookId}`)); }
  catch { return null; }
}

/* ─────────────────── POSITION ─────────────────── */

function savePosition(wordIndex) {
  localStorage.setItem(POSITION_KEY, String(wordIndex));
}

function loadPosition() {
  const v = parseInt(localStorage.getItem(POSITION_KEY), 10);
  return isNaN(v) ? 0 : v;
}

/* ─────────────────── PUBLIC API ─────────────────── */

async function restoreSavedBook() {
  console.log("[STARTUP] restoreSavedBook called");
  const savedBook     = loadCurrentBook();
  const savedPosition = loadPosition();
  console.log("[STARTUP] Restored book:", savedBook?.title || "none", "at position:", savedPosition);

  if (savedBook?.text) {
    console.log("[STARTUP] Using saved book");
    setLoadingStatus("Loading your book...", "📚 Restoring: " + (savedBook.title || "Unknown"), true);
    currentBook = savedBook;
    markBookAsRead(savedBook, savedPosition);
    savePosition(savedPosition);
    setBook({ ...savedBook, startPosition: savedPosition });
    return;
  }

  console.log("[STARTUP] No saved book – loading random book");
  setLoadingStatus("Loading your book...", "📖 Fetching new book…", true);
  await loadSampleBook();
}

async function loadSampleBook() {
  console.log("[STARTUP] loadSampleBook called");
  const book = await getRandomBook();
  console.log("[STARTUP] Retrieved book:", book.title, "by", book.author);
  setLoadingStatus("Loading your book...", "📚 Processing: " + (book.title || "Unknown"), true);

  currentBook = book;
  saveCurrentBook(book);
  markBookAsRead(book, 0);
  savePosition(0);
  console.log("[STARTUP] Book saved to storage");

  setBook({ ...book, startPosition: 0 });
}

async function loadHistoryBook(bookId) {
  console.log("[HISTORY] Loading book from history:", bookId);

  const history      = getBookHistory();
  const historyEntry = history.find(item => item.id === bookId);

  if (!historyEntry) {
    console.warn("[HISTORY] Book not found in history:", bookId);
    return;
  }

  // Try cached text first
  let book = loadBookById(bookId);

  if (!book) {
    console.warn("[HISTORY] Book text not cached, attempting fetch");

    if (bookId.startsWith("gutenberg_")) {
      const pgId = bookId.replace("gutenberg_", "");
      setLoadingStatus("Loading your book...", "📚 Fetching: " + (historyEntry.title || "Unknown"), true);
      showLoadingProgress("Fetching book text…");
      setLoadingProgress(10);

      try {
        const text = await fetchText(gutenbergTextUrl(pgId));
        if (!text || text.length < 500) throw new Error("Text too short");
        book = { id: bookId, title: historyEntry.title, author: historyEntry.author, text };
      } catch (err) {
        console.error("[HISTORY] Could not fetch book text:", err);
        book = {
          id:     bookId,
          title:  historyEntry.title,
          author: historyEntry.author,
          text:   "Book text unavailable. The original book could not be fetched.\n\n[This book was previously read, but the text is no longer available.]"
        };
      }
    } else {
      book = {
        id:     bookId,
        title:  historyEntry.title,
        author: historyEntry.author,
        text:   "Book text unavailable. [This book was previously read, but the text is no longer available.]"
      };
    }
  }

  setLoadingStatus("Loading your book...", "📚 Restoring: " + (historyEntry.title || "Unknown"), true);
  showLoadingProgress("Restoring position…");
  setLoadingProgress(90);

  currentBook = book;
  saveCurrentBook(book);
  const savedPosition = historyEntry.wordIndex || 0;
  savePosition(savedPosition);

  setLoadingProgress(100);
  hideLoadingProgress();

  setBook({ ...book, startPosition: savedPosition });
  console.log("[HISTORY] Book loaded at position:", savedPosition);
}
