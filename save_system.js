(function () {
  const DB_NAME = 'DeltaruneSaveStates';
  const DB_VERSION = 1;
  const STORE_NAME = 'saveStates';
  const SLOT_COUNT = 8;

  class DeltaruneSaveSystem {
    constructor() {
      this.currentChapter = this.getChapterName();
      this.db = null;
      this.moduleReady = false;
      this.toastTimer = null;
      this.initialize();
    }

    getChapterName() {
      const path = window.location.pathname || '';
      const match = path.match(/chapter\d+/i);
      return match ? match[0].toLowerCase() : 'game';
    }

    async initialize() {
      this.installHandlers();
      await this.openDatabase();
      this.createUI();
      this.attachHotkeys();
      this.waitForModule();
    }

    installHandlers() {
      if (window.__deltaruneSaveSystemHandlersInstalled) return;
      window.__deltaruneSaveSystemHandlersInstalled = true;
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason;
        const message = reason && (reason.message || reason.toString());
        if (typeof message === 'string' && /play\(\) failed/i.test(message)) {
          event.preventDefault();
        }
      });
    }

    openDatabase() {
      return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => {
          this.db = request.result;
          resolve();
          this.refreshSlotMeta();
        };
        request.onerror = () => {
          console.error('SaveSystem DB failed', request.error);
          resolve();
        };
      });
    }

    waitForModule() {
      const check = () => {
        const M = window.Module;
        if (M && M.HEAPU8) {
          this.moduleReady = true;
          this.showToast('Save system ready');
          this.refreshSlotMeta();
          return;
        }
        setTimeout(check, 150);
      };
      check();
    }

    attachHotkeys() {
      window.addEventListener('keydown', (event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        if (key === 'o') {
          event.preventDefault();
          this.togglePanel();
        } else if (key === 's') {
          event.preventDefault();
          this.saveSlot(0);
        } else if (key === 'l') {
          event.preventDefault();
          this.loadSlot(0);
        }
      });
    }

    createUI() {
      if (document.getElementById('deltarune-save-system')) return;
      const style = document.createElement('style');
      style.textContent = `
        #deltarune-save-system { font-family: Arial, sans-serif; }
        .deltarune-save-panel { position: fixed; top: 12px; right: 12px; width: 300px; background: rgba(10,12,18,0.96); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,0.45); color:#e1e8ff; z-index:2147483647; display:none; }
        .deltarune-save-panel.active { display:block; }
        .deltarune-save-panel header { display:flex; justify-content:space-between; align-items:center; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.06); }
        .deltarune-save-panel header h3 { margin:0; font-size:14px; }
        .deltarune-save-panel header button { border:none; background: rgba(255,255,255,0.08); color:#fff; border-radius:10px; width:30px; height:30px; cursor:pointer; }
        .deltarune-save-slots { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:12px; }
        .deltarune-slot { background: rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:10px; display:flex; flex-direction:column; gap:8px; min-height:120px; }
        .deltarune-slot .title { font-size:13px; font-weight:700; }
        .deltarune-slot .meta { font-size:11px; color:#94a3b8; min-height:34px; }
        .deltarune-slot .buttons { display:grid; gap:6px; }
        .deltarune-slot button { border:none; border-radius:10px; padding:8px 10px; color:#fff; cursor:pointer; font-size:12px; }
        .btn-save { background:#2563eb; }
        .btn-load { background:#16a34a; }
        .btn-export { background:#f59e0b; color:#111827; }
        .btn-import { background:#0ea5e9; }
        .btn-delete { background:#dc2626; }
        .deltarune-save-dock { position:fixed; bottom:16px; right:16px; display:flex; flex-direction:column; gap:10px; z-index:2147483647; }
        .deltarune-save-dock button { width:46px; height:46px; border:none; border-radius:14px; background:rgba(255,255,255,0.08); color:#eef2ff; cursor:pointer; font-size:18px; }
        .deltarune-toast { position:fixed; right:16px; bottom:16px; background:rgba(15,23,42,0.96); color:#e2e8f0; padding:10px 14px; border-radius:12px; box-shadow:0 18px 48px rgba(0,0,0,0.35); opacity:0; transition:opacity .16s ease; z-index:2147483648; }
        .deltarune-import-status { padding: 10px 14px; font-size: 12px; color: #cbd5e1; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.92); }
        .deltarune-import-status.error { color:#fecaca; }
        .deltarune-import-status.success { color:#86efac; }
      `;
      document.head.appendChild(style);

      const root = document.createElement('div');
      root.id = 'deltarune-save-system';
      root.innerHTML = `
        <section class="deltarune-save-panel" id="deltaruneSavePanel">
          <header>
            <h3>Save Manager • ${this.currentChapter}</h3>
            <div>
              <button id="deltaruneImportDebug" title="Show import debug info">🐞</button>
              <button id="deltaruneSaveClose">×</button>
            </div>
          </header>
          <div class="deltarune-import-status" id="deltaruneImportStatus">Import status: ready</div>
          <div class="deltarune-save-slots" id="deltaruneSaveSlots"></div>
        </section>
      `;
      document.body.appendChild(root);
      document.getElementById('deltaruneSaveClose').addEventListener('click', () => this.togglePanel());
      document.getElementById('deltaruneImportDebug').addEventListener('click', () => this.showImportDebugInfo());

      const dock = document.createElement('div');
      dock.className = 'deltarune-save-dock';
      dock.innerHTML = `
        <button id="deltaruneSaveOpen" title="Open save menu">📁</button>
        <button id="deltaruneSaveQuickSave" title="Quick save">💾</button>
        <button id="deltaruneSaveQuickLoad" title="Quick load">▶️</button>
      `;
      document.body.appendChild(dock);
      document.getElementById('deltaruneSaveOpen').addEventListener('click', () => this.togglePanel());
      document.getElementById('deltaruneSaveQuickSave').addEventListener('click', () => this.saveSlot(0));
      document.getElementById('deltaruneSaveQuickLoad').addEventListener('click', () => this.loadSlot(0));

      const toast = document.createElement('div');
      toast.id = 'deltaruneSaveToast';
      toast.className = 'deltarune-toast';
      document.body.appendChild(toast);

      this.renderSlots();
    }

    renderSlots() {
      const container = document.getElementById('deltaruneSaveSlots');
      if (!container) return;
      container.innerHTML = '';
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        const card = document.createElement('div');
        card.className = 'deltarune-slot';
        card.id = `deltarune-slot-${slot}`;
        card.innerHTML = `
          <div class="title">Slot ${slot + 1}</div>
          <div class="meta" id="deltaruneSlotMeta${slot}">Empty</div>
          <div class="buttons">
            <button class="btn-save" data-slot="${slot}">Save</button>
            <button class="btn-load" data-slot="${slot}">Load</button>
            <button class="btn-export" data-slot="${slot}">Export</button>
            <button class="btn-import" data-slot="${slot}">Import</button>
            <button class="btn-delete" data-slot="${slot}">Delete</button>
          </div>
        `;
        container.appendChild(card);
        card.querySelector('.btn-save').addEventListener('click', () => this.saveSlot(slot));
        card.querySelector('.btn-load').addEventListener('click', () => this.loadSlot(slot));
        card.querySelector('.btn-export').addEventListener('click', () => this.exportSlot(slot));
        card.querySelector('.btn-import').addEventListener('click', () => this.importSlot(slot));
        card.querySelector('.btn-delete').addEventListener('click', () => this.deleteSlot(slot));
      }
      this.refreshSlotMeta();
    }

    togglePanel() {
      const panel = document.getElementById('deltaruneSavePanel');
      if (!panel) return;
      panel.classList.toggle('active');
      if (panel.classList.contains('active')) {
        this.refreshSlotMeta();
      }
    }

    captureMemory() {
      const M = window.Module;
      if (!M || !M.HEAPU8) throw new Error('Game memory unavailable');
      return new Uint8Array(M.HEAPU8);
    }

    restoreMemory(buffer) {
      const M = window.Module;
      if (!M || !M.HEAPU8) throw new Error('Game memory unavailable');
      M.HEAPU8.set(new Uint8Array(buffer));
    }

    async saveSlot(slot) {
      if (!this.moduleReady) {
        this.showToast('Game not ready', 'error');
        return;
      }
      try {
        const memory = this.captureMemory();
        await this.putState({
          id: `${this.currentChapter}_slot_${slot}`,
          slot,
          chapter: this.currentChapter,
          timestamp: new Date().toISOString(),
          sizeBytes: memory.byteLength,
          memory: memory.buffer,
        });
        this.showToast(`Saved slot ${slot + 1}`);
        this.refreshSlotMeta();
      } catch (error) {
        console.error('Save failed', error);
        this.showToast('Save failed', 'error');
      }
    }

    async loadSlot(slot) {
      if (!this.moduleReady) {
        this.showToast('Game not ready', 'error');
        return;
      }
      try {
        const state = await this.getState(slot);
        if (!state) {
          this.showToast(`Slot ${slot + 1} empty`, 'error');
          return;
        }
        this.restoreMemory(state.memory);
        this.showToast(`Loaded slot ${slot + 1}`);
      } catch (error) {
        console.error('Load failed', error);
        this.showToast('Load failed', 'error');
      }
    }

    async deleteSlot(slot) {
      try {
        await this.deleteState(`${this.currentChapter}_slot_${slot}`);
        this.showToast(`Deleted slot ${slot + 1}`);
        this.refreshSlotMeta();
      } catch (error) {
        console.error('Delete failed', error);
        this.showToast('Delete failed', 'error');
      }
    }

    async exportSlot(slot) {
      try {
        const state = await this.getState(slot);
        if (!state) {
          this.showToast(`Slot ${slot + 1} empty`, 'error');
          return;
        }
        const headerJson = JSON.stringify({ slot: state.slot, chapter: state.chapter, timestamp: state.timestamp, sizeBytes: state.sizeBytes });
        const headerBytes = new TextEncoder().encode(headerJson);
        const headerSizeArr = new Uint32Array([headerBytes.byteLength]);

        // Build a single ArrayBuffer for the file: [4 bytes headerLen][headerBytes][memory]
        const memoryBuf = state.memory instanceof ArrayBuffer ? state.memory : state.memory.buffer || state.memory;
        const totalLen = 4 + headerBytes.byteLength + (memoryBuf.byteLength || memoryBuf.length || 0);
        const out = new Uint8Array(totalLen);
        out.set(new Uint8Array(headerSizeArr.buffer), 0);
        out.set(new Uint8Array(headerBytes.buffer), 4);
        out.set(new Uint8Array(memoryBuf), 4 + headerBytes.byteLength);

        const suggestedName = `${this.currentChapter}_slot${slot + 1}.deltarune-save`;

        // Prefer File System Access API when available (Chrome/Chromium, ChromeOS)
        if (window.showSaveFilePicker) {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName,
              // Use a safe extension pattern in the picker, while the suggested filename remains descriptive.
              types: [{ description: 'Deltarune save', accept: { 'application/octet-stream': ['.save'] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(out);
            await writable.close();
            this.showToast(`Saved slot ${slot + 1} to file`);
            return;
          } catch (fsErr) {
            console.warn('SaveSystem: filesystem save failed, falling back to download', fsErr);
            // fall through to blob download fallback
          }
        }

        // Fallback: trigger normal download
        const blob = new Blob([out.buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Keep the legacy filename with the more descriptive extension for downloads
        a.download = `${this.currentChapter}_slot${slot + 1}.deltarune-save`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast(`Exported slot ${slot + 1}`);
      } catch (error) {
        console.error('Export failed', error);
        this.showToast('Export failed', 'error');
      }
    }

    async importSlot(slot) {
      this.showToast('Importing...');
      console.log('SaveSystem importSlot start', slot, { picker: !!window.showOpenFilePicker });
      let file = null;
      const safeAccept = ['.deltarune-save', '.save', 'application/octet-stream'];

      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: [{ description: 'Deltarune save', accept: { 'application/octet-stream': ['.deltarune-save', '.save'] } }],
          });
          file = await handle.getFile();
        } catch (err) {
          console.warn('SaveSystem: open file picker failed, falling back to file input', err);
          file = null;
        }
      }

      if (!file) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = safeAccept.join(',');
        input.multiple = false;
        input.style.display = 'none';
        document.body.appendChild(input);

        file = await new Promise((resolve) => {
          let onChange = null;
          let onFocus = null;

          const cleanup = () => {
            if (onChange) input.removeEventListener('change', onChange);
            if (onFocus) window.removeEventListener('focus', onFocus);
          };

          onChange = (event) => {
            cleanup();
            resolve(event.target.files?.[0] || null);
          };

          onFocus = () => {
            setTimeout(() => {
              if (!input.files?.length) {
                cleanup();
                resolve(null);
              }
            }, 200);
          };

          input.addEventListener('change', onChange, { once: true });
          window.addEventListener('focus', onFocus, { once: true });
          input.click();
        });

        document.body.removeChild(input);
      }

      console.log('SaveSystem importSlot selected file', file && { name: file.name, size: file.size, type: file.type });
      if (!file) {
        this.setImportStatus('Import canceled or no file selected', 'error');
        this.showToast('Import canceled', 'error');
        return;
      }

      const parsed = await this.parseSaveFile(file);
      if (!parsed) {
        console.warn('SaveSystem importSlot parse failed', file);
        this.setImportStatus('Import error: invalid save file format', 'error');
        this.showToast('Invalid save file', 'error');
        return;
      }
      this.setImportStatus(`File parsed, metadata loaded for slot ${slot + 1}`, 'success');
      console.log('SaveSystem importSlot parsed metadata', parsed.metadata);

      try {
        const copy = new Uint8Array(parsed.memory.byteLength);
        copy.set(new Uint8Array(parsed.memory));
        await this.putState({
          id: `${this.currentChapter}_slot_${slot}`,
          slot,
          chapter: this.currentChapter,
          timestamp: new Date().toISOString(),
          sizeBytes: copy.byteLength,
          memory: copy.buffer,
        });
        this.setImportStatus(`Imported slot ${slot + 1} successfully`, 'success');
        this.showToast(`Imported slot ${slot + 1}`);
        this.refreshSlotMeta();
      } catch (error) {
        console.error('Import failed', error);
        this.setImportStatus('Import failed: see console logs', 'error');
        this.showToast('Import failed', 'error');
      }
    }

    parseSaveFile(file) {
      return file.arrayBuffer().then((buffer) => {
        console.log('SaveSystem parseSaveFile buffer length', buffer.byteLength);
        if (buffer.byteLength < 4) {
          console.warn('SaveSystem parseSaveFile file too short', buffer.byteLength);
          return null;
        }
        const headerSize = new DataView(buffer, 0, 4).getUint32(0, true);
        console.log('SaveSystem parseSaveFile headerSize', headerSize);
        if (buffer.byteLength < 4 + headerSize) {
          console.warn('SaveSystem parseSaveFile header truncated', { buffer: buffer.byteLength, headerSize });
          return null;
        }
        const headerBytes = new Uint8Array(buffer, 4, headerSize);
        let metadata;
        try {
          metadata = JSON.parse(new TextDecoder().decode(headerBytes));
        } catch (error) {
          console.error('SaveSystem parseSaveFile JSON parse failed', error);
          return null;
        }
        const memory = buffer.slice(4 + headerSize);
        return { metadata, memory };
      }).catch((error) => {
        console.error('Parse save file failed', error);
        return null;
      });
    }

    putState(state) {
      return new Promise((resolve, reject) => {
        if (!this.db) return reject(new Error('DB unavailable'));
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(state);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    getState(slot) {
      return new Promise((resolve, reject) => {
        if (!this.db) return resolve(null);
        const key = `${this.currentChapter}_slot_${slot}`;
        const tx = this.db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    deleteState(key) {
      return new Promise((resolve, reject) => {
        if (!this.db) return reject(new Error('DB unavailable'));
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    refreshSlotMeta() {
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        this.getState(slot).then((state) => {
          const meta = document.getElementById(`deltaruneSlotMeta${slot}`);
          if (!meta) return;
          if (!state) {
            meta.textContent = 'Empty';
            return;
          }
          const date = new Date(state.timestamp);
          meta.innerHTML = `Saved ${date.toLocaleString()}<br>${(state.sizeBytes / 1024).toFixed(1)} KB`;
        }).catch(() => {
          const meta = document.getElementById(`deltaruneSlotMeta${slot}`);
          if (meta) meta.textContent = 'Error';
        });
      }
    }

    setImportStatus(message, type = 'info') {
      const status = document.getElementById('deltaruneImportStatus');
      if (!status) return;
      status.textContent = message;
      status.className = `deltarune-import-status ${type}`;
    }

    showImportDebugInfo() {
      const debugMessage = 'Import debug: open DevTools and run window.deltaruneSaveSystem.importSlot(0) or inspect console logs.';
      this.setImportStatus(debugMessage, 'info');
      console.log('DeltaruneSaveSystem debug: use the following to test import directly:');
      console.log('  window.deltaruneSaveSystem.importSlot(0);');
      console.log('You can also inspect parseSaveFile and putState with:');
      console.log('  window.deltaruneSaveSystem.parseSaveFile(file).then(console.log);');
    }

    showToast(message, type = 'success') {
      const toast = document.getElementById('deltaruneSaveToast');
      if (!toast) return;
      toast.textContent = message;
      toast.style.opacity = '1';
      toast.style.background = type === 'error' ? 'rgba(185,28,28,0.95)' : 'rgba(15,23,42,0.96)';
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        toast.style.opacity = '0';
      }, 2400);
    }
  }

  const init = () => {
    try {
      window.deltaruneSaveSystem = new DeltaruneSaveSystem();
    } catch (error) {
      console.error('SaveSystem init failed', error);
    }
  };

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
