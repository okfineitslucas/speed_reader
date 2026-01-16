const textInput = document.getElementById("textInput");
const docTitle = document.getElementById("docTitle");
const wordCountEl = document.getElementById("wordCount");
const progressEl = document.getElementById("progress");
const wordDisplay = document.getElementById("wordDisplay");
const leftSpan = wordDisplay.querySelector(".word-left");
const focusSpan = wordDisplay.querySelector(".word-focus");
const rightSpan = wordDisplay.querySelector(".word-right");
const speedRange = document.getElementById("speedRange");
const wpmValue = document.getElementById("wpmValue");
const sliderTrack = document.querySelector(".slider-track");
const readerPanel = document.getElementById("readerPanel");
const readerControls = document.getElementById("readerControls");
const toggleControlsBtn = document.getElementById("toggleControlsBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const customizeBtn = document.getElementById("customizeBtn");
const customizePanel = document.getElementById("customizePanel");
const readerDoc = document.getElementById("readerDoc");
const actionButtons = document.querySelectorAll("[data-action]");
const pauseButtons = document.querySelectorAll('[data-action="pause"]');
const pdfInput = document.getElementById("pdfInput");
const pdfStatus = document.getElementById("pdfStatus");
const epubInput = document.getElementById("epubInput");
const epubStatus = document.getElementById("epubStatus");
const ocrToggle = document.getElementById("ocrToggle");
const libraryList = document.getElementById("libraryList");
const libraryEmpty = document.getElementById("libraryEmpty");
const clearLibraryBtn = document.getElementById("clearLibraryBtn");
const historyLastRead = document.getElementById("historyLastRead");
const historySessions = document.getElementById("historySessions");
const historyTime = document.getElementById("historyTime");
const dropOverlay = document.getElementById("dropOverlay");
const inputPanel = document.querySelector(".input-panel");
const pdfjsLib = window.pdfjsLib;
const epubjsLib = window.ePub;
const focusHighlightToggle = document.getElementById("focusHighlightToggle");
const focusColorPicker = document.getElementById("focusColorPicker");
const focusColorButtons = document.querySelectorAll("[data-focus-color]");
const autoPaceToggle = document.getElementById("autoPaceToggle");
const autoPaceSettings = document.getElementById("autoPaceSettings");
const startPaceInput = document.getElementById("startPace");
const maxPaceInput = document.getElementById("maxPace");
const liveWpmEl = document.getElementById("liveWpm");
const contextView = document.getElementById("contextView");
const contextToggle = document.getElementById("contextToggle");
const contextNav = document.getElementById("contextNav");
const prevParagraphBtn = document.getElementById("prevParagraph");
const nextParagraphBtn = document.getElementById("nextParagraph");
const reader = document.querySelector(".reader");

let words = [];
let currentIndex = 0;
let timerId = null;
let isPlaying = false;
let wpm = Number(speedRange.value);
let isPseudoFullscreen = false;
let hasStarted = false;
let isPdfLoading = false;
let isEpubLoading = false;
let activeDoc = null;
let isSettingText = false;
let isOcrEnabled = false;
let saveTimer = null;
let libraryRefreshTimer = null;
let ocrWorker = null;
let ocrLoadingPromise = null;
let isAutoPaceEnabled = false;
let autoPaceStartWpm = 150;
let autoPaceMaxWpm = 400;
const AUTO_PACE_WORDS_PER_STEP = 25;
let sessionStartAt = null;
let focusHighlightEnabled = true;
let focusColor = "#ff3b30";
let isContextViewActive = false;
let originalText = "";
let contextParagraphs = [];
let currentParagraphIndex = 0;

const PDF_WORKER_SRC =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
const TESSERACT_SRC =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const DB_NAME = "focus-reader";
const DB_VERSION = 1;
const STORE_NAME = "documents";
const PREFS_KEY = "focusReaderPrefs";

if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
}

function openDb() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("DB open failed"));
  });
}

let dbPromise = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDb().catch((error) => {
      console.warn(error);
      return null;
    });
  }
  return dbPromise;
}

async function dbPut(doc) {
  const db = await getDb();
  if (!db) {
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).put(doc);
  });
}

async function dbGet(id) {
  const db = await getDb();
  if (!db) {
    return null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll() {
  const db = await getDb();
  if (!db) {
    return [];
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(id) {
  const db = await getDb();
  if (!db) {
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).delete(id);
  });
}

async function dbClear() {
  const db = await getDb();
  if (!db) {
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).clear();
  });
}

function hashText(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16);
}

function deriveTitle(text) {
  const titleWords = text.trim().split(/\s+/).slice(0, 6);
  return titleWords.length ? titleWords.join(" ") : "Untitled";
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "new";
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseHtmlToText(html) {
  if (!html) {
    return "";
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return doc.body ? doc.body.textContent || "" : "";
  } catch (_) {
    return "";
  }
}

function formatDuration(ms) {
  if (!ms || ms <= 0) {
    return "0m";
  }
  const totalSeconds = Math.round(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function loadPrefs() {
  if (!("localStorage" in window)) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn(error);
    return {};
  }
}

function savePrefs() {
  if (!("localStorage" in window)) {
    return;
  }
  const payload = {
    focusHighlightEnabled,
    focusColor,
  };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn(error);
  }
}

function applyFocusColor() {
  const root = document.documentElement;
  const computed = window.getComputedStyle(root);
  const textColor = computed.getPropertyValue("--text").trim() || "#ffffff";
  const applied = focusHighlightEnabled ? focusColor : textColor;
  root.style.setProperty("--focus", applied);
  if (focusColorPicker) {
    focusColorPicker.disabled = !focusHighlightEnabled;
  }
}

function applyPrefs(prefs = {}) {
  if (typeof prefs.focusHighlightEnabled === "boolean") {
    focusHighlightEnabled = prefs.focusHighlightEnabled;
  }
  if (prefs.focusColor) {
    focusColor = prefs.focusColor;
  }
  applyFocusColor();
  if (focusHighlightToggle) {
    focusHighlightToggle.checked = focusHighlightEnabled;
  }
  if (focusColorPicker) {
    focusColorPicker.value = focusColor;
  }
  renderWordAtIndex(currentIndex);
}

function setFocusHighlightEnabled(enabled) {
  focusHighlightEnabled = Boolean(enabled);
  applyFocusColor();
  savePrefs();
}

function setFocusColor(nextColor) {
  focusColor = nextColor;
  applyFocusColor();
  savePrefs();
}

function tokenize(text) {
  return text.trim().match(/\S+/g) ?? [];
}

function updateReaderDocLabel() {
  if (!readerDoc) {
    return;
  }
  if (activeDoc && activeDoc.title) {
    readerDoc.textContent = activeDoc.title;
    return;
  }
  if (textInput.value.trim()) {
    readerDoc.textContent = "Unsaved text";
    return;
  }
  readerDoc.textContent = "No document loaded";
}

function updateHistoryPanel() {
  if (!historyLastRead || !historySessions || !historyTime) {
    return;
  }
  if (!activeDoc) {
    historyLastRead.textContent = "—";
    historySessions.textContent = "0";
    historyTime.textContent = "0m";
    return;
  }
  historyLastRead.textContent = formatTimestamp(activeDoc.lastReadAt);
  historySessions.textContent = `${activeDoc.sessions || 0}`;
  historyTime.textContent = formatDuration(activeDoc.totalReadMs || 0);
}

function getProgressPercent(index, total) {
  if (!total) {
    return 0;
  }
  return Math.min(100, Math.round((index / total) * 100));
}

function createDocumentFromText(text, options = {}) {
  const now = Date.now();
  const docTitleValue = (options.title || "").trim();
  const derivedTitle = docTitleValue || deriveTitle(text);
  const docWords = tokenize(text);
  return {
    id: hashText(text),
    title: derivedTitle || "Untitled",
    text,
    source: options.source || "paste",
    wordCount: docWords.length,
    lastIndex: 0,
    createdAt: now,
    updatedAt: now,
    lastReadAt: null,
    wpm,
    sessions: 0,
    totalReadMs: 0,
    meta: options.meta || {},
  };
}

function applyDocumentState(doc, options = {}) {
  if (activeDoc && sessionStartAt) {
    endSession();
  }
  activeDoc = doc;
  sessionStartAt = null;
  if (activeDoc) {
    activeDoc.sessions = activeDoc.sessions || 0;
    activeDoc.totalReadMs = activeDoc.totalReadMs || 0;
  }
  if (docTitle && doc) {
    docTitle.value = doc.title || "";
  }
  if (options.setText !== false && doc && typeof doc.text === "string") {
    isSettingText = true;
    textInput.value = doc.text;
    isSettingText = false;
  }
  originalText = doc ? (doc.text || "") : "";
  words = doc ? tokenize(doc.text || "") : [];
  currentIndex = doc ? Math.min(doc.lastIndex || 0, words.length) : 0;
  updateStats();
  if (words.length) {
    renderWordAtIndex(currentIndex);
  } else {
    renderWord("");
  }
  if (doc && typeof doc.wpm === "number") {
    wpm = doc.wpm;
    speedRange.value = wpm.toString();
    updateDial();
  }
  updateReaderDocLabel();
  updateHistoryPanel();
  updatePlayStateUI();
  scheduleLibraryRefresh();
}

function scheduleLibraryRefresh() {
  if (libraryRefreshTimer) {
    return;
  }
  libraryRefreshTimer = window.setTimeout(() => {
    libraryRefreshTimer = null;
    refreshLibrary();
  }, 400);
}

async function refreshLibrary() {
  if (!libraryList || !libraryEmpty) {
    return;
  }
  let docs = [];
  try {
    docs = await dbGetAll();
  } catch (error) {
    console.warn(error);
  }
  docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  libraryList.innerHTML = "";
  if (!docs.length) {
    libraryEmpty.style.display = "block";
    return;
  }
  libraryEmpty.style.display = "none";
  docs.forEach((doc) => {
    const item = document.createElement("li");
    item.className = "library-item";
    if (activeDoc && doc.id === activeDoc.id) {
      item.classList.add("active");
    }

    const info = document.createElement("div");
    const name = document.createElement("p");
    name.className = "library-name";
    name.textContent = doc.title || "Untitled";
    const meta = document.createElement("p");
    meta.className = "library-meta";
    const progress = getProgressPercent(doc.lastIndex || 0, doc.wordCount || 0);
    const sessions = doc.sessions || 0;
    const timeSpent = formatDuration(doc.totalReadMs || 0);
    meta.textContent = `${progress}% | ${doc.wordCount || 0} words | ${formatTimestamp(doc.lastReadAt)} | ${sessions} sessions | ${timeSpent}`;
    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "library-actions";

    const resumeButton = document.createElement("button");
    resumeButton.textContent = "Resume";
    resumeButton.dataset.docAction = "resume";
    resumeButton.dataset.docId = doc.id;

    const restartButton = document.createElement("button");
    restartButton.textContent = "Restart";
    restartButton.dataset.docAction = "restart";
    restartButton.dataset.docId = doc.id;

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "Delete";
    deleteButton.dataset.docAction = "delete";
    deleteButton.dataset.docId = doc.id;

    actions.appendChild(resumeButton);
    actions.appendChild(restartButton);
    actions.appendChild(deleteButton);

    item.appendChild(info);
    item.appendChild(actions);
    libraryList.appendChild(item);
  });
}

async function loadDocumentById(id, options = {}) {
  if (!id) {
    return;
  }
  const doc = await dbGet(id);
  if (!doc) {
    return;
  }
  if (options.restart) {
    doc.lastIndex = 0;
    doc.updatedAt = Date.now();
    doc.lastReadAt = Date.now();
  }
  applyDocumentState(doc);
  if (options.restart) {
    await dbPut(doc);
  }
}

function scheduleSaveProgress(force = false) {
  if (!activeDoc) {
    return;
  }
  if (saveTimer && !force) {
    return;
  }
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveActiveDocumentProgress().catch((error) => console.warn(error));
  }, force ? 0 : 600);
}

async function saveActiveDocumentProgress() {
  if (!activeDoc) {
    return;
  }
  activeDoc.lastIndex = currentIndex;
  activeDoc.wordCount = words.length;
  activeDoc.updatedAt = Date.now();
  activeDoc.lastReadAt = Date.now();
  activeDoc.wpm = wpm;
  activeDoc.sessions = activeDoc.sessions || 0;
  activeDoc.totalReadMs = activeDoc.totalReadMs || 0;
  if (!activeDoc.title || !activeDoc.title.trim()) {
    activeDoc.title = deriveTitle(activeDoc.text || "") || "Untitled";
  }
  await dbPut(activeDoc);
  updateHistoryPanel();
  scheduleLibraryRefresh();
}

async function ensureActiveDocumentFromText() {
  const rawText = textInput.value.trim();
  if (!rawText) {
    return null;
  }
  const id = hashText(rawText);
  let doc = null;
  try {
    doc = await dbGet(id);
  } catch (error) {
    console.warn(error);
  }
  if (!doc) {
    doc = createDocumentFromText(rawText, {
      title: docTitle ? docTitle.value : "",
      source: "paste",
    });
  } else {
    doc.text = rawText;
    doc.wordCount = words.length;
    if (docTitle && docTitle.value.trim()) {
      doc.title = docTitle.value.trim();
    }
    doc.sessions = doc.sessions || 0;
    doc.totalReadMs = doc.totalReadMs || 0;
  }
  applyDocumentState(doc, { setText: false });
  await dbPut(doc);
  return doc;
}

function updateStats() {
  wordCountEl.textContent = words.length.toString();
  const progress = getProgressPercent(currentIndex, words.length);
  progressEl.textContent = `${progress}%`;
}

function updateDial() {
  wpmValue.textContent = wpm.toString();
  speedRange.value = wpm.toString();
}

function updateLiveWpm() {
  if (!liveWpmEl) return;
  if (isPlaying) {
    liveWpmEl.textContent = `${wpm} WPM`;
    liveWpmEl.classList.add("visible");
  } else {
    liveWpmEl.classList.remove("visible");
  }
}

function jumpWords(amount) {
  if (!words.length) return;
  const wasPlaying = isPlaying;
  if (wasPlaying) {
    pauseReading();
  }
  const nextIndex = Math.min(
    words.length - 1,
    Math.max(0, currentIndex + amount),
  );
  currentIndex = nextIndex;
  renderWordAtIndex(currentIndex);
  updateStats();
  scheduleSaveProgress();
}

function rewindSeconds(seconds) {
  if (!words.length) return;
  const wordsBack = Math.max(1, Math.round((wpm / 60) * seconds));
  jumpWords(-wordsBack);
}

function stepWord(direction) {
  if (!words.length) return;

  const wasPlaying = isPlaying;
  if (wasPlaying) {
    pauseReading();
  }

  if (direction === "back" && currentIndex > 0) {
    currentIndex -= 1;
  } else if (direction === "forward" && currentIndex < words.length - 1) {
    currentIndex += 1;
  }

  renderWordAtIndex(currentIndex);
  updateStats();
  scheduleSaveProgress();
}

function calculateAutoPaceWpm() {
  if (!isAutoPaceEnabled || !words.length) {
    return wpm;
  }
  const totalWords = words.length;
  const progress = currentIndex / totalWords;
  const wpmRange = autoPaceMaxWpm - autoPaceStartWpm;
  const newWpm = Math.round(autoPaceStartWpm + (wpmRange * progress));
  return Math.min(newWpm, autoPaceMaxWpm);
}

function updateAutoPace() {
  if (!isAutoPaceEnabled) {
    return;
  }
  const newWpm = calculateAutoPaceWpm();
  if (newWpm !== wpm) {
    wpm = newWpm;
    updateDial();
  }
}

function updatePlayStateUI() {
  let label = "Pause";
  if (!isPlaying && hasStarted) {
    label = "Resume";
  }
  pauseButtons.forEach((button) => {
    button.textContent = label;
  });
}

function setPlayingState(nextState) {
  isPlaying = nextState;
  updatePlayStateUI();
  updateLiveWpm();
}

function beginSession() {
  if (!activeDoc || sessionStartAt) {
    return;
  }
  sessionStartAt = Date.now();
  activeDoc.sessions = (activeDoc.sessions || 0) + 1;
  activeDoc.lastReadAt = Date.now();
  updateHistoryPanel();
  scheduleSaveProgress(true);
}

function endSession() {
  if (!activeDoc || !sessionStartAt) {
    return;
  }
  const duration = Date.now() - sessionStartAt;
  sessionStartAt = null;
  activeDoc.totalReadMs = (activeDoc.totalReadMs || 0) + duration;
  activeDoc.updatedAt = Date.now();
  activeDoc.lastReadAt = Date.now();
  dbPut(activeDoc).catch((error) => console.warn(error));
  updateHistoryPanel();
  scheduleLibraryRefresh();
}

function setPdfStatus(message, isError = false) {
  if (!pdfStatus) {
    return;
  }
  pdfStatus.textContent = message;
  pdfStatus.classList.toggle("error", isError);
}

function setEpubStatus(message, isError = false) {
  if (!epubStatus) {
    return;
  }
  epubStatus.textContent = message;
  epubStatus.classList.toggle("error", isError);
}

function loadOcrScript() {
  if (window.Tesseract) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load OCR"));
    document.head.appendChild(script);
  });
}

async function getOcrWorker() {
  if (ocrWorker) {
    return ocrWorker;
  }
  if (ocrLoadingPromise) {
    return ocrLoadingPromise;
  }
  ocrLoadingPromise = (async () => {
    await loadOcrScript();
    const worker = await window.Tesseract.createWorker("eng", 1, {
      logger: (message) => {
        if (message && message.status) {
          setPdfStatus(`OCR ${message.status} ${Math.round((message.progress || 0) * 100)}%`);
        }
      },
    });
    ocrWorker = worker;
    return worker;
  })();
  return ocrLoadingPromise;
}

async function runOcrOnPage(page, pageNumber, totalPages) {
  const worker = await getOcrWorker();
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  setPdfStatus(`OCR page ${pageNumber} of ${totalPages}`);
  const result = await worker.recognize(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return result.data && result.data.text ? result.data.text : "";
}

function extractSectionText(contents) {
  if (!contents) {
    return "";
  }
  if (typeof contents === "string") {
    return parseHtmlToText(contents);
  }
  // epub.js returns a Document - check body first
  if (contents.body && contents.body.textContent) {
    return contents.body.textContent || "";
  }
  if (contents.documentElement && contents.documentElement.textContent) {
    return contents.documentElement.textContent || "";
  }
  if (contents.textContent) {
    return contents.textContent || "";
  }
  if (contents.ownerDocument && contents.ownerDocument.body) {
    return contents.ownerDocument.body.textContent || "";
  }
  return "";
}

function getFocusIndex(word) {
  const letterIndexes = [];
  for (let i = 0; i < word.length; i += 1) {
    if (/\p{L}/u.test(word[i])) {
      letterIndexes.push(i);
    }
  }
  if (!letterIndexes.length) {
    return -1;
  }
  const center = Math.floor((letterIndexes.length - 1) / 2);
  return letterIndexes[center];
}

function renderWord(word) {
  if (!word) {
    leftSpan.textContent = "";
    focusSpan.textContent = "";
    rightSpan.textContent = "";
    return;
  }
  const focusIndex = getFocusIndex(word);
  if (focusIndex === -1) {
    leftSpan.textContent = word;
    focusSpan.textContent = "";
    rightSpan.textContent = "";
    return;
  }
  leftSpan.textContent = word.slice(0, focusIndex);
  focusSpan.textContent = word[focusIndex];
  rightSpan.textContent = word.slice(focusIndex + 1);
}

function renderWordAtIndex(index) {
  if (!words.length || index < 0 || index >= words.length) {
    renderWord("");
    return;
  }
  const word = words[index];
  if (!word) {
    renderWord("");
    return;
  }
  renderWord(word);
}

function buildParagraphsData() {
  if (!originalText) {
    contextParagraphs = [];
    return;
  }

  // Normalize text: convert single newlines to spaces, keep double newlines as paragraph breaks
  // This handles PDFs where every line ends with \n but they're part of the same paragraph
  const normalized = originalText
    .replace(/\r\n/g, '\n')           // Normalize Windows line endings
    .replace(/\n{3,}/g, '\n\n')       // Collapse multiple newlines to double
    .replace(/([^\n])\n([^\n])/g, '$1 $2');  // Single newlines become spaces

  // Split into paragraphs by double newline
  const rawParagraphs = normalized.split(/\n\n+/).filter(p => p.trim());

  // Build paragraph data with word offsets
  // We need to map back to the original word indices from tokenize(originalText)
  const allWords = words; // Use the global words array that was tokenized from originalText
  let wordOffset = 0;

  contextParagraphs = rawParagraphs.map((text, index) => {
    const paraWords = tokenize(text);
    const startIndex = wordOffset;
    wordOffset += paraWords.length;
    return {
      text,
      words: paraWords,
      startIndex,
      endIndex: wordOffset - 1,
      index
    };
  });

  // If word counts don't match, fall back to treating entire text as one paragraph
  if (wordOffset !== allWords.length) {
    contextParagraphs = [{
      text: originalText,
      words: allWords,
      startIndex: 0,
      endIndex: allWords.length - 1,
      index: 0
    }];
  }
}

function findParagraphIndexForWord(wordIndex) {
  for (let i = 0; i < contextParagraphs.length; i++) {
    const para = contextParagraphs[i];
    if (wordIndex >= para.startIndex && wordIndex <= para.endIndex) {
      return i;
    }
  }
  return 0;
}

function renderContextView(highlightWordIndex) {
  if (!contextView || !contextParagraphs.length) {
    if (contextView) {
      contextView.innerHTML = "<p><em>No context available</em></p>";
    }
    return;
  }

  const para = contextParagraphs[currentParagraphIndex];
  if (!para) {
    contextView.innerHTML = "<p><em>No context available</em></p>";
    return;
  }

  // Determine which word to highlight within this paragraph
  let localHighlight = -1;
  if (highlightWordIndex >= para.startIndex && highlightWordIndex <= para.endIndex) {
    localHighlight = highlightWordIndex - para.startIndex;
  }

  // Build HTML with highlighted word
  const parts = [];
  for (let i = 0; i < para.words.length; i++) {
    if (i === localHighlight) {
      parts.push(`<span class="highlight">${para.words[i]}</span>`);
    } else {
      parts.push(para.words[i]);
    }
  }
  contextView.innerHTML = `<p>${parts.join(" ")}</p>`;

  // Update nav button states
  updateContextNavButtons();
}

function updateContextNavButtons() {
  if (!prevParagraphBtn || !nextParagraphBtn) return;
  prevParagraphBtn.disabled = currentParagraphIndex <= 0;
  nextParagraphBtn.disabled = currentParagraphIndex >= contextParagraphs.length - 1;
}

function goToPrevParagraph() {
  if (currentParagraphIndex > 0) {
    currentParagraphIndex -= 1;
    const para = contextParagraphs[currentParagraphIndex];
    // Update currentIndex to first word of this paragraph (accounting for the +1 offset)
    currentIndex = para.startIndex + 1;
    renderContextView(para.startIndex);
    updateStats();
  }
}

function goToNextParagraph() {
  if (currentParagraphIndex < contextParagraphs.length - 1) {
    currentParagraphIndex += 1;
    const para = contextParagraphs[currentParagraphIndex];
    // Update currentIndex to first word of this paragraph (accounting for the +1 offset)
    currentIndex = para.startIndex + 1;
    renderContextView(para.startIndex);
    updateStats();
  }
}

function showContextView() {
  if (!contextView || !contextToggle || !reader) return;

  // Build paragraphs data and find current paragraph
  buildParagraphsData();
  const displayedIndex = hasStarted ? Math.max(0, currentIndex - 1) : currentIndex;
  currentParagraphIndex = findParagraphIndexForWord(displayedIndex);

  isContextViewActive = true;
  renderContextView(displayedIndex);
  contextView.classList.remove("hidden");
  if (contextNav) contextNav.classList.remove("hidden");
  reader.classList.add("context-view-active");
  contextToggle.textContent = "Back to Focus";
}

function hideContextView() {
  if (!contextView || !contextToggle || !reader) return;
  isContextViewActive = false;
  contextView.classList.add("hidden");
  if (contextNav) contextNav.classList.add("hidden");
  reader.classList.remove("context-view-active");
  contextToggle.textContent = "Show Context";
  // Update the word display to show current position
  renderWordAtIndex(Math.max(0, currentIndex - 1));
}

function toggleContextView() {
  if (isContextViewActive) {
    hideContextView();
  } else {
    showContextView();
  }
}

function updateContextToggleVisibility() {
  if (!contextToggle) return;
  // Show button when paused and we have words
  if (!isPlaying && words.length > 0 && hasStarted) {
    contextToggle.classList.remove("hidden");
  } else {
    contextToggle.classList.add("hidden");
    if (isContextViewActive) {
      hideContextView();
    }
  }
}

function getDelay(word) {
  const baseDelay = 60000 / wpm;
  if (/[.!?]$/.test(word)) {
    return baseDelay * 1.5;
  }
  if (/[,:;]$/.test(word)) {
    return baseDelay * 1.2;
  }
  return baseDelay;
}

function scheduleNext() {
  if (!isPlaying) {
    return;
  }
  if (currentIndex >= words.length) {
    currentIndex = words.length;
    updateStats();
    scheduleSaveProgress(true);
    stopReading();
    renderWord("Done");
    return;
  }
  updateAutoPace();
  updateLiveWpm();
  const word = words[currentIndex];
  renderWordAtIndex(currentIndex);
  currentIndex += 1;
  updateStats();
  scheduleSaveProgress();
  timerId = window.setTimeout(scheduleNext, getDelay(word));
}

async function startReading() {
  if (isPdfLoading || isEpubLoading) {
    renderWord("Loading file...");
    return;
  }
  if (!words.length) {
    originalText = textInput.value;
    words = tokenize(textInput.value);
    currentIndex = 0;
    updateStats();
  }
  if (!words.length) {
    renderWord("Paste text or upload a PDF");
    return;
  }
  if (isAutoPaceEnabled && !hasStarted) {
    wpm = autoPaceStartWpm;
    updateDial();
  }
  const rawText = textInput.value.trim();
  if (!activeDoc || (activeDoc.text || "").trim() !== rawText) {
    try {
      await ensureActiveDocumentFromText();
    } catch (error) {
      console.warn(error);
    }
  }
  if (isPlaying) {
    return;
  }
  hasStarted = true;
  setPlayingState(true);
  updateContextToggleVisibility();
  beginSession();
  scheduleNext();
}

function pauseReading() {
  setPlayingState(false);
  if (timerId) {
    window.clearTimeout(timerId);
    timerId = null;
  }
  endSession();
  scheduleSaveProgress(true);
  updateContextToggleVisibility();
}

function stopReading() {
  pauseReading();
}

function resetReading() {
  hasStarted = false;
  pauseReading();
  currentIndex = 0;
  updateStats();
  renderWord("");
  if (activeDoc) {
    activeDoc.lastIndex = 0;
    activeDoc.updatedAt = Date.now();
    dbPut(activeDoc).catch((error) => console.warn(error));
    scheduleLibraryRefresh();
  }
}

function setControlsOpen(open) {
  readerControls.classList.toggle("closed", !open);
  toggleControlsBtn.textContent = open ? "Hide Controls" : "Show Controls";
}

function setCustomizeOpen(open) {
  if (!customizePanel || !customizeBtn) {
    return;
  }
  customizePanel.classList.toggle("closed", !open);
  customizeBtn.textContent = open ? "Close" : "Customize";
}

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  );
}

function setFullscreenState(active) {
  readerPanel.classList.toggle("fullscreen", active);
  fullscreenBtn.textContent = active ? "Exit Fullscreen" : "Fullscreen";
  document.body.style.overflow = active ? "hidden" : "";
}

function enterFullscreen() {
  isPseudoFullscreen = true;
  setFullscreenState(true);
  const request =
    readerPanel.requestFullscreen ||
    readerPanel.webkitRequestFullscreen ||
    readerPanel.msRequestFullscreen;
  if (request) {
    try {
      const result = request.call(readerPanel);
      if (result && typeof result.catch === "function") {
        result.catch((err) => console.debug("Fullscreen request failed:", err));
      }
    } catch (err) {
      console.debug("Fullscreen not supported:", err);
    }
  }
}

function exitFullscreen() {
  isPseudoFullscreen = false;
  setFullscreenState(false);
  const exit =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.msExitFullscreen;
  if (exit) {
    try {
      const result = exit.call(document);
      if (result && typeof result.catch === "function") {
        result.catch((err) => console.debug("Exit fullscreen failed:", err));
      }
    } catch (err) {
      console.debug("Exit fullscreen not supported:", err);
    }
  }
}

function syncFullscreen() {
  const active = Boolean(getFullscreenElement());
  if (active) {
    isPseudoFullscreen = false;
    setFullscreenState(true);
    return;
  }
  if (!isPseudoFullscreen) {
    setFullscreenState(false);
  }
}

async function loadPdfFile(file) {
  if (!file) {
    setPdfStatus("No PDF loaded");
    return;
  }
  if (!pdfjsLib || typeof pdfjsLib.getDocument !== "function") {
    setPdfStatus("PDF reader unavailable. Reload the page.", true);
    return;
  }
  if (file.type && file.type !== "application/pdf") {
    setPdfStatus("Please select a PDF file.", true);
    return;
  }
  isPdfLoading = true;
  isOcrEnabled = Boolean(ocrToggle && ocrToggle.checked);
  if (pdfInput) {
    pdfInput.disabled = true;
  }
  pauseReading();
  hasStarted = false;
  renderWord("Loading PDF...");
  setPdfStatus(`Loading ${file.name}...`);

  try {
    const data = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    const pageTexts = [];
    let usedOcr = false;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setPdfStatus(`Reading ${file.name} — page ${pageNumber} of ${pdf.numPages}`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const strings = content.items
        .map((item) => item.str)
        .filter((value) => value && value.trim());
      let pageText = strings.join(" ");
      if (!pageText.trim() && isOcrEnabled) {
        try {
          const ocrText = await runOcrOnPage(page, pageNumber, pdf.numPages);
          if (ocrText.trim()) {
            usedOcr = true;
          }
          pageText = ocrText;
        } catch (error) {
          console.warn(error);
          setPdfStatus(`OCR failed on page ${pageNumber}`, true);
        }
      }
      pageTexts.push(pageText);
    }

    const text = pageTexts.join("\n");
    if (!text.trim()) {
      if (isOcrEnabled) {
        setPdfStatus(`${file.name} loaded, but OCR found no text.`, true);
        renderWord("No text found");
      } else {
        setPdfStatus(
          `${file.name} loaded, but no selectable text found. Enable OCR to scan.`,
          true,
        );
        renderWord("No selectable text");
      }
      return;
    }
    const cleanedText = text.trim();
    const baseTitle = file.name.replace(/\.pdf$/i, "");
    const docId = hashText(cleanedText);
    let doc = await dbGet(docId);
    if (!doc) {
      doc = createDocumentFromText(cleanedText, {
        title: baseTitle,
        source: usedOcr ? "pdf-ocr" : "pdf",
        meta: { fileName: file.name },
      });
    } else {
      doc.text = cleanedText;
      doc.wordCount = tokenize(cleanedText).length;
      doc.updatedAt = Date.now();
      doc.title = doc.title || baseTitle;
      doc.source = usedOcr ? "pdf-ocr" : doc.source || "pdf";
      doc.meta = { ...(doc.meta || {}), fileName: file.name };
      doc.sessions = doc.sessions || 0;
      doc.totalReadMs = doc.totalReadMs || 0;
    }
    applyDocumentState(doc);
    await dbPut(doc);
    setPdfStatus(`${file.name} loaded (${pdf.numPages} pages)`);
  } catch (error) {
    console.error(error);
    if (error && error.name === "PasswordException") {
      setPdfStatus("That PDF is password protected.", true);
      renderWord("PDF locked");
    } else {
      setPdfStatus("Could not read that PDF. Try another file.", true);
      renderWord("PDF load failed");
    }
  } finally {
    isPdfLoading = false;
    if (pdfInput) {
      pdfInput.disabled = false;
      pdfInput.value = "";
    }
  }
}

async function loadEpubFile(file) {
  if (!file) {
    setEpubStatus("No EPUB loaded");
    return;
  }
  if (!epubjsLib || typeof epubjsLib !== "function") {
    setEpubStatus("EPUB reader unavailable. Reload the page.", true);
    return;
  }
  const isValidEpub = file.type === "application/epub+zip" ||
    file.name.toLowerCase().endsWith(".epub");
  if (!isValidEpub) {
    setEpubStatus("Please select an EPUB file.", true);
    return;
  }
  isEpubLoading = true;
  if (epubInput) {
    epubInput.disabled = true;
  }
  if (pdfInput) {
    pdfInput.disabled = true;
  }
  pauseReading();
  hasStarted = false;
  renderWord("Loading EPUB...");
  setEpubStatus(`Loading ${file.name}...`);

  try {
    const data = await file.arrayBuffer();
    const book = epubjsLib(data);

    // Wait for full book initialization - opened is required in epub.js 0.3.x
    await book.opened;

    const spine = book.spine;
    const spineLength = spine.length || (spine.spineItems ? spine.spineItems.length : 0);
    const sectionTexts = [];

    for (let i = 0; i < spineLength; i += 1) {
      const section = spine.get(i);
      if (!section) {
        continue;
      }
      if (section.linear === false) {
        continue;
      }
      setEpubStatus(`Reading ${file.name} — section ${i + 1} of ${spineLength}`);
      try {
        const contents = await section.load(book.load.bind(book));
        const sectionText = extractSectionText(contents);
        if (sectionText && sectionText.trim()) {
          sectionTexts.push(sectionText.trim());
        }
        section.unload();
      } catch (sectionError) {
        console.warn(`Failed to load section ${i}:`, sectionError);
      }
    }

    const text = sectionTexts.join("\n");
    if (!text.trim()) {
      setEpubStatus(`${file.name} loaded, but no readable text found.`, true);
      renderWord("No text found");
      return;
    }

    const cleanedText = text.trim();
    const baseTitle = file.name.replace(/\.epub$/i, "");
    const docId = hashText(cleanedText);
    let doc = await dbGet(docId);
    if (!doc) {
      doc = createDocumentFromText(cleanedText, {
        title: baseTitle,
        source: "epub",
        meta: { fileName: file.name },
      });
    } else {
      doc.text = cleanedText;
      doc.wordCount = tokenize(cleanedText).length;
      doc.updatedAt = Date.now();
      doc.title = doc.title || baseTitle;
      doc.source = doc.source || "epub";
      doc.meta = { ...(doc.meta || {}), fileName: file.name };
      doc.sessions = doc.sessions || 0;
      doc.totalReadMs = doc.totalReadMs || 0;
    }
    applyDocumentState(doc);
    await dbPut(doc);
    setEpubStatus(`${file.name} loaded (${spineLength} sections)`);
    if (book.destroy) {
      book.destroy();
    }
  } catch (error) {
    console.error(error);
    setEpubStatus("Could not read that EPUB. Try another file.", true);
    renderWord("EPUB load failed");
  } finally {
    isEpubLoading = false;
    if (epubInput) {
      epubInput.disabled = false;
      epubInput.value = "";
    }
    if (pdfInput) {
      pdfInput.disabled = false;
    }
  }
}

textInput.addEventListener("input", () => {
  if (isSettingText) {
    return;
  }
  originalText = textInput.value;
  words = tokenize(textInput.value);
  currentIndex = 0;
  hasStarted = false;
  updateStats();
  if (words.length) {
    currentIndex = 0;
    renderWordAtIndex(0);
  } else {
    renderWord("Paste text or upload a PDF");
  }
  updatePlayStateUI();
  if (activeDoc) {
    activeDoc = null;
  }
  updateReaderDocLabel();
  updateHistoryPanel();
});

if (docTitle) {
  docTitle.addEventListener("input", () => {
    if (activeDoc) {
      activeDoc.title = docTitle.value.trim() || activeDoc.title;
      scheduleSaveProgress(true);
      updateReaderDocLabel();
    } else {
      updateReaderDocLabel();
    }
  });
}

if (pdfInput) {
  pdfInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      setPdfStatus("No PDF loaded");
      return;
    }
    loadPdfFile(file);
  });
}

if (epubInput) {
  epubInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      setEpubStatus("No EPUB loaded");
      return;
    }
    loadEpubFile(file);
  });
}

if (ocrToggle) {
  ocrToggle.addEventListener("change", () => {
    isOcrEnabled = Boolean(ocrToggle.checked);
    if (isOcrEnabled) {
      setPdfStatus("OCR enabled for scanned PDFs");
    } else {
      setPdfStatus("OCR disabled");
    }
  });
}

if (focusHighlightToggle) {
  focusHighlightToggle.addEventListener("change", () => {
    setFocusHighlightEnabled(focusHighlightToggle.checked);
  });
}

if (focusColorPicker) {
  focusColorPicker.addEventListener("input", () => {
    setFocusColor(focusColorPicker.value);
  });
}

if (focusColorButtons && focusColorButtons.length) {
  focusColorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.dataset.focusColor;
      if (color) {
        if (focusColorPicker) {
          focusColorPicker.value = color;
        }
        setFocusColor(color);
      }
    });
  });
}

if (libraryList) {
  libraryList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.docAction;
    const id = target.dataset.docId;
    if (!action || !id) {
      return;
    }
    if (action === "resume") {
      loadDocumentById(id, { restart: false }).catch((error) => console.warn(error));
    }
    if (action === "restart") {
      loadDocumentById(id, { restart: true }).catch((error) => console.warn(error));
    }
    if (action === "delete") {
      dbDelete(id)
        .then(() => {
          if (activeDoc && activeDoc.id === id) {
            activeDoc = null;
            updateReaderDocLabel();
            updateHistoryPanel();
          }
          refreshLibrary();
        })
        .catch((error) => console.warn(error));
    }
  });
}

if (clearLibraryBtn) {
  clearLibraryBtn.addEventListener("click", () => {
    if (!window.confirm("Clear all saved documents?")) {
      return;
    }
    dbClear()
      .then(() => {
        if (activeDoc) {
          activeDoc = null;
          updateReaderDocLabel();
          updateHistoryPanel();
        }
        refreshLibrary();
      })
      .catch((error) => console.warn(error));
  });
}

if (inputPanel) {
  const stopDefaults = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  ["dragenter", "dragover"].forEach((eventName) => {
    inputPanel.addEventListener(eventName, (event) => {
      stopDefaults(event);
      inputPanel.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    inputPanel.addEventListener(eventName, (event) => {
      stopDefaults(event);
      inputPanel.classList.remove("drag-over");
    });
  });
  inputPanel.addEventListener("drop", (event) => {
    const files = event.dataTransfer ? Array.from(event.dataTransfer.files || []) : [];
    const epubFile = files.find((item) => item.type === "application/epub+zip" || /\.epub$/i.test(item.name));
    const pdfFile = files.find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name));
    if (epubFile) {
      loadEpubFile(epubFile);
      return;
    }
    if (pdfFile) {
      loadPdfFile(pdfFile);
      return;
    }
    setPdfStatus("Drop a PDF or EPUB file to load.", true);
    setEpubStatus("Drop a PDF or EPUB file to load.", true);
  });
}

actionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "start") {
      void startReading();
      return;
    }
    if (action === "pause") {
      if (isPlaying) {
        pauseReading();
      } else {
        void startReading();
      }
      return;
    }
    if (action === "reset") {
      resetReading();
    }
    if (action === "back10") {
      jumpWords(-10);
    }
    if (action === "forward10") {
      jumpWords(10);
    }
    if (action === "rewind3") {
      rewindSeconds(3);
    }
  });
});

toggleControlsBtn.addEventListener("click", () => {
  const isClosed = readerControls.classList.contains("closed");
  setControlsOpen(isClosed);
});

if (customizeBtn) {
  customizeBtn.addEventListener("click", () => {
    const isClosed = customizePanel ? customizePanel.classList.contains("closed") : true;
    setCustomizeOpen(isClosed);
  });
}

fullscreenBtn.addEventListener("click", () => {
  const isActive =
    Boolean(getFullscreenElement()) ||
    readerPanel.classList.contains("fullscreen");
  if (isActive) {
    exitFullscreen();
  } else {
    enterFullscreen();
  }
});

if (contextToggle) {
  contextToggle.addEventListener("click", toggleContextView);
}

if (prevParagraphBtn) {
  prevParagraphBtn.addEventListener("click", goToPrevParagraph);
}

if (nextParagraphBtn) {
  nextParagraphBtn.addEventListener("click", goToNextParagraph);
}

speedRange.addEventListener("input", (event) => {
  wpm = Number(event.target.value);
  updateDial();
  if (activeDoc) {
    scheduleSaveProgress(true);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target === textInput || event.target.tagName === "INPUT") {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (isPlaying) {
      pauseReading();
    } else {
      void startReading();
    }
  }
  if (event.key.toLowerCase() === "r") {
    resetReading();
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (isContextViewActive) {
      goToPrevParagraph();
    } else if (event.shiftKey) {
      jumpWords(-10);
    } else {
      stepWord("back");
    }
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (isContextViewActive) {
      goToNextParagraph();
    } else if (event.shiftKey) {
      jumpWords(10);
    } else {
      stepWord("forward");
    }
  }
  if (event.key.toLowerCase() === "c" && !isPlaying && hasStarted) {
    toggleContextView();
  }
  if (event.key === "Escape" && isContextViewActive) {
    hideContextView();
  }
});

document.addEventListener("fullscreenchange", syncFullscreen);
document.addEventListener("webkitfullscreenchange", syncFullscreen);
document.addEventListener("msfullscreenchange", syncFullscreen);

if (autoPaceToggle) {
  autoPaceToggle.addEventListener("change", () => {
    isAutoPaceEnabled = autoPaceToggle.checked;
    autoPaceSettings.classList.toggle("visible", isAutoPaceEnabled);
    if (isAutoPaceEnabled) {
      autoPaceStartWpm = Number(startPaceInput.value) || 150;
      autoPaceMaxWpm = Number(maxPaceInput.value) || 400;
      if (!isPlaying && !hasStarted) {
        wpm = autoPaceStartWpm;
        updateDial();
      }
    }
  });
}

if (startPaceInput) {
  startPaceInput.addEventListener("change", () => {
    autoPaceStartWpm = Number(startPaceInput.value) || 150;
    if (isAutoPaceEnabled && !hasStarted) {
      wpm = autoPaceStartWpm;
      updateDial();
    }
  });
}

if (maxPaceInput) {
  maxPaceInput.addEventListener("change", () => {
    autoPaceMaxWpm = Number(maxPaceInput.value) || 400;
  });
}

updateStats();
updateDial();
applyPrefs(loadPrefs());
renderWord("Paste text or upload a PDF");
updatePlayStateUI();
setControlsOpen(false);
setCustomizeOpen(false);
updateReaderDocLabel();
updateHistoryPanel();
refreshLibrary();

window.addEventListener("beforeunload", () => {
  if (ocrWorker) {
    ocrWorker.terminate().catch(() => {});
    ocrWorker = null;
  }
});
