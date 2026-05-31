class DeltaruneSaveSystem {
  constructor() {
    this.DB_NAME = "DeltaruneSaveStates";
    this.DB_VERSION = 1;
    this.STORE_NAME = "saveStates";
    this.NUM_SLOTS = 8;
    this.quickSaveSlot = 0;
    this.currentChapter = this.detectChapter();
    this.db = null;
    this.gameModule = null;
    this.menuOpen = false;
    this.isReady = false;

    this.init();
  }

  detectChapter() {
    const path = window.location.pathname || "";
    const match = path.match(/chapter\d+/i);
    return match ? match[0].toLowerCase() : "game";
  }

  async init() {
    try {
      await this.initDB();
      this.createUI();
      // Improved detection: wrap runtime hooks if present, watch property, and poll with backoff.
      let interval = 200;
      const maxInterval = 1000;

      const checkReady = () => {
        if (window.Module && window.Module.HEAPU8) {
          this.gameModule = window.Module;
          this.isReady = true;
          this.updateSaveListUI();
          console.log("[SaveSystem] Game module ready");
          try { this.debugLog('SaveSystem: ready'); } catch (e) { /* ignore */ }
          return true;
        }
        return false;
      };

      const tryWrapRuntimeHooks = () => {
        try {
          const M = window.Module;
          if (!M) return;
          // Wrap onRuntimeInitialized if present
          if (typeof M.onRuntimeInitialized === 'function' && !M.__saveSystemWrapped_onRuntime) {
            const orig = M.onRuntimeInitialized;
            M.onRuntimeInitialized = function() {
              try { orig.apply(this, arguments); } catch (e) { console.error(e); }
              try { if (window.deltaruneSaveSystem) window.deltaruneSaveSystem.debugLog('[SaveSystem] onRuntimeInitialized'); } catch (_) {}
              try { if (window.deltaruneSaveSystem) window.deltaruneSaveSystem.waitForModule(); } catch (_) {}
            };
            M.__saveSystemWrapped_onRuntime = true;
          }
          // Wrap postRun array or function
          if (Array.isArray(M.postRun) && !M.__saveSystemWrapped_postRun) {
            M.postRun = M.postRun.concat(() => { try { if (window.deltaruneSaveSystem) window.deltaruneSaveSystem.debugLog('[SaveSystem] postRun'); } catch (_) {} });
            M.__saveSystemWrapped_postRun = true;
          } else if (typeof M.postRun === 'function' && !M.__saveSystemWrapped_postRun) {
            const orig = M.postRun;
            M.postRun = function() { try { orig.apply(this, arguments); } catch (e) { console.error(e); } try { if (window.deltaruneSaveSystem) window.deltaruneSaveSystem.debugLog('[SaveSystem] postRun'); } catch (_) {} };
            M.__saveSystemWrapped_postRun = true;
          }

          // Try to watch HEAPU8 property being set (best-effort)
          try {
            const desc = Object.getOwnPropertyDescriptor(M, 'HEAPU8');
            if ((!desc || desc.configurable) && !M.__saveSystemWatching_HEAPU8) {
              let current = M.HEAPU8;
              Object.defineProperty(M, 'HEAPU8', {
                configurable: true,
                enumerable: true,
                get() { return current; },
                set(v) { current = v; try { if (window.deltaruneSaveSystem) window.deltaruneSaveSystem.debugLog('[SaveSystem] HEAPU8 set'); } catch (_) {} }
              });
              M.__saveSystemWatching_HEAPU8 = true;
            }
          } catch (e) {
            // ignore failures to redefine Module properties
          }
        } catch (e) {
          // swallow
        }
      };

      const poll = () => {
        if (checkReady()) return;
        tryWrapRuntimeHooks();
        interval = Math.min(maxInterval, interval + 150);
        setTimeout(poll, interval);
      };

      poll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: "id" });
        }
      };
    });
  }

  waitForModule() {
    const tryReady = () => {
      if (window.Module && window.Module.HEAPU8) {
        this.gameModule = window.Module;
        this.isReady = true;
        this.updateSaveListUI();
        console.log("[SaveSystem] Game module ready");
        try { this.debugLog('SaveSystem: ready'); } catch(e) { /* ignore */ }
      } else {
        setTimeout(tryReady, 300);
      }
    };
    tryReady();
  }

  setupHotkeys() {
    window.addEventListener("keydown", (event) => {
      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        this.toggleMenu();
      } else if (key === "s") {
        event.preventDefault();
        this.saveState(this.quickSaveSlot);
      } else if (key === "l") {
        event.preventDefault();
        this.loadState(this.quickSaveSlot);
      }
    });
  }

  createUI() {
    const container = document.createElement("div");
    container.id = "deltarune-save-system";
    container.innerHTML = `
      <div class="save-system-overlay" id="saveSystemOverlay"></div>
      <div class="save-system-panel" id="saveSystemPanel">
        <div class="save-system-header">
          <div>
            <strong>Save States</strong>
            <span class="save-system-chapter">${this.currentChapter}</span>
          </div>
          <button id="saveSystemClose" class="save-system-close">×</button>
        </div>
        <div class="save-system-body" id="saveSystemBody"></div>
        <div class="save-system-footer">
            <div>Alt+O = Open menu  ·  Alt+S = Save quick slot  ·  Alt+L = Load quick slot</div>
            <button id="saveSystemImportButton" class="footer-button">Import Save</button>
          </div>
        </div>
        <div class="save-system-dock" id="saveSystemDock" aria-hidden="false">
          <button id="saveSystemQuickSave" class="dock-button" title="Quick Save">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3h14v14H5z" stroke="#fff" stroke-width="1.2" fill="#1e88e5"/><path d="M7 7h10v6H7z" fill="#fff"/></svg>
            <div class="dock-label">Save</div>
          </button>
          <button id="saveSystemQuickLoad" class="dock-button" title="Quick Load">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 21H5a2 2 0 0 1-2-2V7" stroke="#fff" stroke-width="1.2" fill="#43a047"/><path d="M7 9l5 5 5-5" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <div class="dock-label">Load</div>
          </button>
          <button id="saveSystemExport" class="dock-button" title="Export Save">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v12" stroke="#121212" stroke-width="1.6" stroke-linecap="round"/><path d="M8 7l4-4 4 4" stroke="#121212" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="15" width="18" height="6" rx="2" fill="#f0a500"/></svg>
            <div class="dock-label">Export</div>
          </button>
          <button id="saveSystemImportDock" class="dock-button" title="Import Save">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 21V9" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M8 13l4 4 4-4" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="3" width="18" height="6" rx="2" fill="#1565c0"/></svg>
            <div class="dock-label">Import</div>
          </button>
          <button id="saveSystemOpenButton" class="dock-button" title="Open Save Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="3" fill="#f6b93b"/><path d="M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6" stroke="#f6b93b" stroke-width="1.2" stroke-linecap="round"/></svg>
            <div class="dock-label">Menu</div>
          </button>
        </div>
        <input type="file" id="saveSystemImportInput" accept=".deltarune-save" style="display:none" />
    `;
    document.body.appendChild(container);
    // Debug badge for quick status and click logs
    if (!document.getElementById('saveSystemDebugBadge')) {
      const dbg = document.createElement('div');
      dbg.id = 'saveSystemDebugBadge';
      dbg.textContent = 'SaveSystem: init';
      document.body.appendChild(dbg);
    }
    // Suppress noisy autoplay promise rejections related to play() policy
    if (!window.__saveSystemUnhandledRejectionHandlerAdded) {
      window.addEventListener('unhandledrejection', (ev) => {
        try {
          const reason = ev && ev.reason && (ev.reason.message || ev.reason.toString && ev.reason.toString());
          if (reason && /play\(\) failed/i.test(reason)) {
            console.warn('[SaveSystem] Suppressed autoplay rejection:', reason);
            ev.preventDefault();
          }
        } catch (e) {
          /* ignore */
        }
      });
      window.__saveSystemUnhandledRejectionHandlerAdded = true;
    }
    this.injectStyles();
    document.getElementById("saveSystemClose").addEventListener("click", () => this.closeMenu());
    document.getElementById("saveSystemOverlay").addEventListener("click", () => this.closeMenu());
    // Dock button handlers
    const qs = document.getElementById("saveSystemQuickSave");
    if (qs) qs.addEventListener("click", (e) => { console.log('[SaveSystem] QuickSave clicked'); e.stopPropagation(); this.debugLog('[SaveSystem] QuickSave clicked'); this.saveState(this.quickSaveSlot); });
    const ql = document.getElementById("saveSystemQuickLoad");
    if (ql) ql.addEventListener("click", (e) => { console.log('[SaveSystem] QuickLoad clicked'); e.stopPropagation(); this.debugLog('[SaveSystem] QuickLoad clicked'); this.loadState(this.quickSaveSlot); });
    const exp = document.getElementById("saveSystemExport");
    if (exp) exp.addEventListener("click", (e) => { console.log('[SaveSystem] Export clicked'); e.stopPropagation(); this.debugLog('[SaveSystem] Export clicked'); this.exportSaveState(this.quickSaveSlot); });
    const impDock = document.getElementById("saveSystemImportDock");
    if (impDock) impDock.addEventListener("click", (e) => { console.log('[SaveSystem] Import dock clicked'); e.stopPropagation(); this.debugLog('[SaveSystem] Import dock clicked'); this.triggerImportDialog(); });
    const openBtn = document.getElementById("saveSystemOpenButton");
    if (openBtn) openBtn.addEventListener("click", (e) => { console.log('[SaveSystem] OpenMenu clicked'); e.stopPropagation(); this.debugLog('[SaveSystem] OpenMenu clicked'); this.openMenu(); });
    const importBtn = document.getElementById("saveSystemImportButton");
    if (importBtn) importBtn.addEventListener("click", (e) => { console.log('[SaveSystem] Import button clicked'); e.stopPropagation(); this.debugLog('[SaveSystem] Import button clicked'); this.triggerImportDialog(); });
    document.getElementById("saveSystemImportInput").addEventListener("change", (e) => this.handleImportInput(e));
    this.renderSlots();
  }

  debugLog(msg) {
    try {
      const el = document.getElementById('saveSystemDebugBadge');
      if (el) el.textContent = msg;
      console.log(msg);
    } catch (e) { /* ignore */ }
  }

  injectStyles() {
    if (document.getElementById("saveSystemStyles")) return;
    const style = document.createElement("style");
    style.id = "saveSystemStyles";
    style.textContent = `
      #deltarune-save-system {
        font-family: Arial, sans-serif;
        position: fixed;
        inset: 0;
        pointer-events: auto;
        z-index: 2147483647 !important;
      }
      .save-system-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        display: none;
        z-index: 2147483646;
        pointer-events: none; /* allow interaction with game while panel is open */
      }
      .save-system-panel {
        position: fixed;
        right: 18px;
        top: 8vh;
        transform: none;
        width: 360px;
        height: 84vh;
        background: #121212;
        border: 2px solid #1a73e8;
        border-radius: 12px;
        padding: 12px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
        display: none;
        z-index: 2147483651;
        overflow: auto;
        color: #e0e0e0;
      }
      .save-system-panel.active { display: block; }
      .save-system-overlay.active { display: block; }
      .save-system-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        gap: 12px;
      }
      .save-system-header strong { font-size: 18px; color: #fff; }
      .save-system-chapter { margin-left: 8px; color: #8ab4f8; font-size: 12px; }
      .save-system-close {
        background: #f44336;
        border: none;
        color: white;
        font-size: 20px;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        cursor: pointer;
      }
      .save-system-body {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        overflow-y: auto;
        max-height: calc(82vh - 140px);
      }
      .save-system-dock {
        position: fixed;
        bottom: 18px;
        right: 18px;
        z-index: 2147483647;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
        padding: 8px;
        background: rgba(18, 18, 18, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 14px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(6px);
      }
      .dock-label { font-size: 11px; margin-top: 6px; color: #e6eefb; text-align: center; }
      .dock-button { flex-direction: column; }
        #saveSystemDebugBadge {
          position: fixed;
          top: 8px;
          right: 8px;
          z-index: 2147483650;
          background: rgba(0,0,0,0.75);
          color: #cfe8ff;
          padding: 6px 10px;
          font-size: 12px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.06);
          pointer-events: none;
        }
      .dock-button {
        width: 48px;
        height: 48px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        border: none;
        cursor: pointer;
        background: transparent;
        padding: 6px;
      }
      .dock-button svg { width: 24px; height: 24px; }
      #saveSystemDock .dock-button:hover { transform: translateY(-2px); transition: transform 0.12s ease; }
      .save-slot-card {
        background: #1f1f1f;
        border: 1px solid #333;
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .save-slot-card.empty { justify-content: center; align-items: center; color: #8a8a8a; }
      .save-slot-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .save-slot-title span { color: #fff; font-weight: 700; }
      .save-slot-badge { background: #16a34a; color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
      .slot-meta { font-size: 12px; color: #b0b0b0; line-height: 1.4; }
      .slot-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .slot-actions button {
        flex: 1;
        min-width: 62px;
        padding: 8px 10px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 700;
        color: #fff;
      }
      .slot-actions button.save { background: #1e88e5; }
      .slot-actions button.load { background: #43a047; }
      .slot-actions button.export { background: #f0a500; color: #121212; }
      .slot-actions button.delete { background: #e53935; }
      .save-system-footer {
        margin-top: 12px;
        font-size: 12px;
        color: #cfd8dc;
        border-top: 1px solid #2c2c2c;
        padding-top: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .footer-button {
        background: #1565c0;
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
        font-weight: 700;
      }
      .save-system-open-button {
        position: fixed;
        bottom: 18px;
        right: 18px;
        z-index: 9999;
        background: #1e88e5;
        color: #fff;
        border: none;
        border-radius: 999px;
        padding: 12px 18px;
        font-size: 14px;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
      }
      .save-notification {
        position: fixed;
        bottom: 90px;
        right: 18px;
        background: rgba(33, 33, 33, 0.95);
        color: #fff;
        padding: 12px 16px;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        z-index: 10000;
        opacity: 0;
        animation: saveSystemToastIn 0.25s forwards;
      }
      .save-notification.success { background: #2e7d32; }
      .save-notification.error { background: #c62828; }
      @keyframes saveSystemToastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
  }

  renderSlots() {
    const body = document.getElementById("saveSystemBody");
    body.innerHTML = "";
    for (let slot = 0; slot < this.NUM_SLOTS; slot++) {
      const card = document.createElement("div");
      card.className = "save-slot-card";
      card.id = `save-slot-card-${slot}`;
      card.innerHTML = `
        <div class="save-slot-title">
          <span>Slot ${slot + 1}</span>
          ${slot === this.quickSaveSlot ? '<span class="save-slot-badge">Quick</span>' : ''}
        </div>
        <div class="slot-meta" id="slot-meta-${slot}">Empty</div>
        <div class="slot-actions">
          <button class="save" data-slot="${slot}">Save</button>
          <button class="load" data-slot="${slot}">Load</button>
          <button class="export" data-slot="${slot}">Export</button>
          <button class="delete" data-slot="${slot}">Delete</button>
        </div>
      `;
      body.appendChild(card);
      card.querySelector("button.save").addEventListener("click", () => this.saveState(slot));
      card.querySelector("button.load").addEventListener("click", () => this.loadState(slot));
      card.querySelector("button.export").addEventListener("click", () => this.exportSaveState(slot));
      card.querySelector("button.delete").addEventListener("click", () => this.deleteState(slot));
    }
  }

  toggleMenu() {
    this.menuOpen ? this.closeMenu() : this.openMenu();
  }

  openMenu() {
    document.getElementById("saveSystemOverlay").classList.add("active");
    document.getElementById("saveSystemPanel").classList.add("active");
    this.menuOpen = true;
    this.updateSaveListUI();
  }

  closeMenu() {
    document.getElementById("saveSystemOverlay").classList.remove("active");
    document.getElementById("saveSystemPanel").classList.remove("active");
    this.menuOpen = false;
  }

  async saveState(slot) {
    if (!this.isReady) {
      this.showNotification("Game not ready for save yet", "error");
      return;
    }
    try {
      const memory = this.captureMemoryState();
      const saveState = {
        id: `${this.currentChapter}_slot_${slot}`,
        slot,
        chapter: this.currentChapter,
        timestamp: new Date().toISOString(),
        sizeBytes: memory.byteLength,
        memory: memory.buffer,
      };
      await this.storeSaveState(saveState);
      this.showNotification(`Saved slot ${slot + 1}`, "success");
      this.updateSaveListUI();
    } catch (error) {
      console.error(error);
      this.showNotification("Save failed", "error");
    }
  }

  async loadState(slot) {
    if (!this.isReady) {
      this.showNotification("Game not ready for load yet", "error");
      return;
    }
    try {
      const saveState = await this.getSaveState(slot);
      if (!saveState) {
        this.showNotification(`Slot ${slot + 1} is empty`, "error");
        return;
      }
      this.restoreMemoryState(saveState.memory);
      this.showNotification(`Loaded slot ${slot + 1}`, "success");
      this.closeMenu();
    } catch (error) {
      console.error(error);
      this.showNotification("Load failed", "error");
    }
  }

  async deleteState(slot) {
    try {
      await this.deleteSaveState(`${this.currentChapter}_slot_${slot}`);
      this.showNotification(`Deleted slot ${slot + 1}`, "success");
      this.updateSaveListUI();
    } catch (error) {
      console.error(error);
      this.showNotification("Delete failed", "error");
    }
  }

  async exportSaveState(slot) {
    const saveState = await this.getSaveState(slot);
    if (!saveState) {
      this.showNotification(`Slot ${slot + 1} is empty`, "error");
      return;
    }
    try {
      const metadata = {
        id: saveState.id,
        slot: saveState.slot,
        chapter: saveState.chapter,
        timestamp: saveState.timestamp,
        sizeBytes: saveState.sizeBytes,
      };
      const headerText = JSON.stringify(metadata);
      const encoder = new TextEncoder();
      const headerBytes = encoder.encode(headerText);
      const headerLength = new Uint32Array([headerBytes.byteLength]);
      const blob = new Blob([headerLength.buffer, headerBytes, saveState.memory], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${this.currentChapter}_slot${slot + 1}.deltarune-save`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.showNotification(`Exported slot ${slot + 1}`, "success");
    } catch (error) {
      console.error(error);
      this.showNotification("Export failed", "error");
    }
  }

  triggerImportDialog() {
    // Create a visible temporary file-picker modal so user interaction is obvious
    try {
      if (document.getElementById('saveSystemFileModal')) return;
      const modal = document.createElement('div');
      modal.id = 'saveSystemFileModal';
      modal.style.position = 'fixed';
      modal.style.left = '50%';
      modal.style.top = '50%';
      modal.style.transform = 'translate(-50%, -50%)';
      modal.style.zIndex = 2147483660;
      modal.style.background = 'rgba(18,18,18,0.98)';
      modal.style.border = '1px solid rgba(255,255,255,0.06)';
      modal.style.padding = '14px';
      modal.style.borderRadius = '10px';
      modal.style.display = 'flex';
      modal.style.flexDirection = 'column';
      modal.style.gap = '10px';

      const title = document.createElement('div');
      title.textContent = 'Import Save File';
      title.style.color = '#e6eefb';
      title.style.fontWeight = '700';
      modal.appendChild(title);

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.deltarune-save,application/octet-stream';
      fileInput.style.color = '#fff';
      modal.appendChild(fileInput);

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '8px';

      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.className = 'footer-button';
      cancel.addEventListener('click', () => { if (modal.parentElement) modal.parentElement.removeChild(modal); });
      row.appendChild(cancel);

      const pick = document.createElement('button');
      pick.textContent = 'Pick File';
      pick.className = 'footer-button';
      pick.addEventListener('click', () => fileInput.click());
      row.appendChild(pick);

      modal.appendChild(row);

      fileInput.addEventListener('change', async (ev) => {
        try {
          console.log('[SaveSystem] Visible import input change event', ev);
          await this.handleImportInput(ev);
        } finally {
          if (modal.parentElement) modal.parentElement.removeChild(modal);
        }
      });

      document.body.appendChild(modal);
      // focus the pick button for keyboard users
      pick.focus();
    } catch (e) {
      // fallback to hidden input
      const input = document.getElementById("saveSystemImportInput");
      if (input) {
        input.value = "";
        input.click();
      }
    }
  }

  async handleImportInput(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      console.log('[SaveSystem] Import file selected:', file.name, file.size);
      const slot = parseInt(window.prompt("Import to slot number (1-8):", "1"), 10);
      if (!slot || slot < 1 || slot > this.NUM_SLOTS) {
        this.showNotification("Import cancelled: invalid slot", "error");
        return;
      }
      const data = await this.parseSaveFile(file);
      if (!data) {
        this.showNotification("Invalid save file", "error");
        return;
      }
      // Create a detached copy of the memory so IndexedDB stores a clean ArrayBuffer
      const memView = new Uint8Array(data.memory);
      const memCopy = new Uint8Array(memView.length);
      memCopy.set(memView);
      const saveState = {
        id: `${this.currentChapter}_slot_${slot - 1}`,
        slot: slot - 1,
        chapter: this.currentChapter,
        timestamp: new Date().toISOString(),
        sizeBytes: memCopy.byteLength,
        memory: memCopy.buffer,
      };
      await this.storeSaveState(saveState);
      console.log('[SaveSystem] Import stored to DB', saveState.id, 'bytes', saveState.sizeBytes);
      this.showNotification(`Imported save to slot ${slot}`, "success");
      this.updateSaveListUI();
    } catch (error) {
      console.error('[SaveSystem] Import failed', error);
      this.showNotification("Import failed", "error");
    }
  }

  async parseSaveFile(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (arrayBuffer.byteLength < 4) return null;
      const headerLengthView = new DataView(arrayBuffer, 0, 4);
      const headerLength = headerLengthView.getUint32(0, true);
      if (arrayBuffer.byteLength < 4 + headerLength) return null;
      const headerBytes = new Uint8Array(arrayBuffer, 4, headerLength);
      const decoder = new TextDecoder();
      const headerText = decoder.decode(headerBytes);
      let metadata;
      try {
        metadata = JSON.parse(headerText);
      } catch (error) {
        console.error('[SaveSystem] Failed to parse save header JSON', error);
        return null;
      }
      const memory = new Uint8Array(arrayBuffer, 4 + headerLength);
      console.log('[SaveSystem] Parsed save file:', metadata, 'memoryBytes:', memory.byteLength);
      return { metadata, memory };
    } catch (error) {
      console.error('[SaveSystem] Error reading save file', error);
      return null;
    }
  }

  captureMemoryState() {
    if (!this.gameModule || !this.gameModule.HEAPU8) {
      throw new Error("Game memory not available");
    }
    return new Uint8Array(this.gameModule.HEAPU8);
  }

  restoreMemoryState(memory) {
    if (!this.gameModule || !this.gameModule.HEAPU8) {
      throw new Error("Game memory not available");
    }
    this.gameModule.HEAPU8.set(memory);
  }

  storeSaveState(saveState) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);
      const item = { ...saveState, memory: saveState.memory };
      const request = store.put(item);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  getSaveState(slot) {
    return new Promise((resolve, reject) => {
      const key = `${this.currentChapter}_slot_${slot}`;
      const transaction = this.db.transaction([this.STORE_NAME], "readonly");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) return resolve(null);
        let memory = result.memory;
        if (memory instanceof ArrayBuffer) {
          memory = new Uint8Array(memory);
        } else if (Array.isArray(memory)) {
          memory = new Uint8Array(memory);
        }
        resolve({ ...result, memory });
      };
    });
  }

  deleteSaveState(key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async updateSaveListUI() {
    for (let slot = 0; slot < this.NUM_SLOTS; slot++) {
      const saveState = await this.getSaveState(slot);
      const metaElement = document.getElementById(`slot-meta-${slot}`);
      if (!metaElement) continue;
      if (!saveState) {
        metaElement.textContent = "Empty";
        metaElement.parentElement.classList.add("empty");
      } else {
        metaElement.parentElement.classList.remove("empty");
        const date = new Date(saveState.timestamp);
        const sizeKB = (saveState.sizeBytes / 1024).toFixed(1);
        metaElement.innerHTML = `Saved: ${date.toLocaleString()}<br>Size: ${sizeKB} KB`;
      }
    }
  }

  showNotification(message, type = "success") {
    const notif = document.createElement("div");
    notif.className = `save-notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => {
      notif.style.opacity = "0";
      setTimeout(() => {
        if (notif.parentElement) notif.parentElement.removeChild(notif);
      }, 250);
    }, 2200);
  }
}

const initializeDeltaruneSaveSystem = () => {
  try {
    window.deltaruneSaveSystem = new DeltaruneSaveSystem();
  } catch (e) {
    console.error('[SaveSystem] Initialization exception', e);
    try { if (window.deltaruneSaveSystem && typeof window.deltaruneSaveSystem.showNotification === 'function') window.deltaruneSaveSystem.showNotification('SaveSystem init error', 'error'); } catch (_) {}
  }
};

// Global error listener to capture runtime exceptions relevant to the save system
if (!window.__saveSystemGlobalErrorHandlerAdded) {
  window.addEventListener('error', (ev) => {
    try {
      console.error('[SaveSystem] Global error', ev.message, ev.filename, ev.lineno, ev.colno, ev.error);
    } catch (e) { /* ignore */ }
  });
  window.__saveSystemGlobalErrorHandlerAdded = true;
}
if (document.readyState === "complete" || document.readyState === "interactive") {
  initializeDeltaruneSaveSystem();
} else {
  window.addEventListener("load", initializeDeltaruneSaveSystem);
}
