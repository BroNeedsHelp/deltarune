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
      this.setupHotkeys();
      this.waitForModule();
      console.log("[SaveSystem] Initialized");
    } catch (error) {
      console.error("[SaveSystem] Initialization failed", error);
    }
  }

  initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
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
      <button id="saveSystemOpenButton" class="save-system-open-button">Save Menu</button>
      <input type="file" id="saveSystemImportInput" accept=".deltarune-save" style="display:none" />
    `;
    document.body.appendChild(container);
    this.injectStyles();
    document.getElementById("saveSystemClose").addEventListener("click", () => this.closeMenu());
    document.getElementById("saveSystemOverlay").addEventListener("click", () => this.closeMenu());
    document.getElementById("saveSystemOpenButton").addEventListener("click", () => this.openMenu());
    document.getElementById("saveSystemImportButton").addEventListener("click", () => this.triggerImportDialog());
    document.getElementById("saveSystemImportInput").addEventListener("change", (e) => this.handleImportInput(e));
    this.renderSlots();
  }

  injectStyles() {
    if (document.getElementById("saveSystemStyles")) return;
    const style = document.createElement("style");
    style.id = "saveSystemStyles";
    style.textContent = `
      #deltarune-save-system { font-family: Arial, sans-serif; }
      .save-system-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        display: none;
        z-index: 9998;
      }
      .save-system-panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(90vw, 860px);
        max-height: 82vh;
        background: #121212;
        border: 2px solid #1a73e8;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 0 30px rgba(0, 0, 0, 0.6);
        display: none;
        z-index: 9999;
        overflow: hidden;
        color: #e0e0e0;
      }
      .save-system-panel.active,
      .save-system-overlay.active {
        display: block;
      }
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
    const input = document.getElementById("saveSystemImportInput");
    if (input) {
      input.value = "";
      input.click();
    }
  }

  async handleImportInput(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
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
      const saveState = {
        id: `${this.currentChapter}_slot_${slot - 1}`,
        slot: slot - 1,
        chapter: this.currentChapter,
        timestamp: new Date().toISOString(),
        sizeBytes: data.memory.byteLength,
        memory: data.memory,
      };
      await this.storeSaveState(saveState);
      this.showNotification(`Imported save to slot ${slot}`, "success");
      this.updateSaveListUI();
    } catch (error) {
      console.error(error);
      this.showNotification("Import failed", "error");
    }
  }

  async parseSaveFile(file) {
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
      return null;
    }
    const memory = new Uint8Array(arrayBuffer, 4 + headerLength);
    return { metadata, memory };
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

window.addEventListener("load", () => {
  window.deltaruneSaveSystem = new DeltaruneSaveSystem();
});
