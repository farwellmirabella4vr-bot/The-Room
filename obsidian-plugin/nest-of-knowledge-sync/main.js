/* ============================================================
   NEST OF KNOWLEDGE SYNC — a one-way bridge from this vault into the
   life hub's Nest of Knowledge room. This vault stays the source of
   truth: nothing here ever writes back into it. Notes are copied out
   as JSON into a folder on this computer (the "bridge folder"); the
   life hub reads that same folder from the browser via the File
   System Access API (the same trick already used for Video Log's
   footage import) — no server, no accounts, nothing leaves this
   machine.

   Plain JS, no build step — matches the rest of this project's
   single-file, no-bundler convention. Desktop only (isDesktopOnly in
   manifest.json), since it needs Node's fs module to write outside
   the vault, which mobile Obsidian doesn't allow plugins to do.

   Dated notes (filename like 2026-08-22.md) get a `date` field so the
   life hub can slot them into the matching Calendar/Journal day;
   everything else just gets `date: null` and shows up in the
   knowledge base section instead.
   ============================================================ */

const { Plugin, PluginSettingTab, Setting, Notice, TFile } = require("obsidian");
const fs = require("fs");
const path = require("path");

const DEFAULT_SETTINGS = {
  bridgeFolder: "",
  excludedFolders: [],
  lastFullSyncAt: null,
  pendingQueue: [],
};

const DATED_NOTE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RETRY_INTERVAL_MS = 30000;

module.exports = class NestOfKnowledgeSync extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.syncQueue = new Set(this.settings.pendingQueue || []);

    this.addSettingTab(new NestSyncSettingTab(this.app, this));

    this.addCommand({
      id: "nest-sync-full-vault",
      name: "Sync entire vault to Nest of Knowledge",
      callback: () => this.syncEntireVault(),
    });
    this.addCommand({
      id: "nest-sync-retry-pending",
      name: "Retry pending Nest of Knowledge syncs",
      callback: () => this.flushQueue(true),
    });

    // Sync on save, create, delete, rename — keeps the bridge folder from
    // drifting out of sync with the vault without needing a manual re-run.
    this.registerEvent(this.app.vault.on("modify", (file) => this.handleChange(file)));
    this.registerEvent(this.app.vault.on("create", (file) => this.handleChange(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.handleDelete(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.handleRename(file, oldPath)));

    // Always-on, cheap retry sweep — a no-op when the queue is empty, so
    // there's no separate start/stop bookkeeping. registerInterval means
    // Obsidian clears it automatically on unload.
    this.registerInterval(window.setInterval(() => this.flushQueue(false), RETRY_INTERVAL_MS));
  }

  // ---------- exclusion / classification ----------
  isExcluded(filePath) {
    return (this.settings.excludedFolders || []).some((folder) => {
      const norm = folder.trim().replace(/\/+$/, "");
      return norm && (filePath === norm || filePath.startsWith(norm + "/"));
    });
  }
  extractDate(basename) {
    return DATED_NOTE_RE.test(basename) ? basename : null;
  }
  sanitizeFileName(vaultPath) {
    return vaultPath.replace(/\.md$/, "").replace(/[\\/:*?"<>|]/g, "_") + ".json";
  }
  bridgePaths() {
    if (!this.settings.bridgeFolder) return null;
    const root = this.settings.bridgeFolder;
    return { root, index: path.join(root, "_index.json"), notesDir: path.join(root, "notes") };
  }

  // ---------- vault event handlers ----------
  handleChange(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    if (this.isExcluded(file.path)) return;
    this.syncNote(file).catch(() => this.enqueueRetry(file.path));
  }
  handleDelete(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    this.removeSyncedNote(file.path).catch(() => { /* best effort — nothing else to do if this fails */ });
  }
  handleRename(file, oldPath) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    this.removeSyncedNote(oldPath).catch(() => {});
    this.handleChange(file);
  }

  // ---------- index read/write ----------
  async readIndex(bridge) {
    try {
      const raw = await fs.promises.readFile(bridge.index, "utf-8");
      return JSON.parse(raw);
    } catch (e) {
      return {}; // missing/corrupt index — rebuild fresh rather than fail
    }
  }
  async writeIndex(bridge, index) {
    await fs.promises.mkdir(bridge.root, { recursive: true });
    await fs.promises.writeFile(bridge.index, JSON.stringify(index, null, 2), "utf-8");
  }

  // ---------- core sync ----------
  async syncNote(file) {
    const bridge = this.bridgePaths();
    if (!bridge) { this.enqueueRetry(file.path); return; }

    const content = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const inlineTags = (cache && cache.tags ? cache.tags.map((t) => t.tag.replace(/^#/, "")) : []);
    const fmTags = cache && cache.frontmatter && cache.frontmatter.tags ? [].concat(cache.frontmatter.tags) : [];
    const date = this.extractDate(file.basename);

    const record = {
      path: file.path,
      title: file.basename,
      date,
      tags: Array.from(new Set(inlineTags.concat(fmTags))),
      content,
      modifiedAt: new Date(file.stat.mtime).toISOString(),
      syncedAt: new Date().toISOString(),
    };

    await fs.promises.mkdir(bridge.notesDir, { recursive: true });
    const fileName = this.sanitizeFileName(file.path);
    await fs.promises.writeFile(path.join(bridge.notesDir, fileName), JSON.stringify(record, null, 2), "utf-8");

    const index = await this.readIndex(bridge);
    index[file.path] = {
      path: file.path,
      title: file.basename,
      date,
      tags: record.tags,
      modifiedAt: record.modifiedAt,
      excerpt: content.slice(0, 200),
      file: fileName,
    };
    await this.writeIndex(bridge, index);

    this.syncQueue.delete(file.path);
    await this.persistQueue();
  }

  async removeSyncedNote(vaultPath) {
    const bridge = this.bridgePaths();
    if (!bridge) return;
    const fileName = this.sanitizeFileName(vaultPath);
    try { await fs.promises.unlink(path.join(bridge.notesDir, fileName)); } catch (e) { /* already gone */ }
    const index = await this.readIndex(bridge);
    if (index[vaultPath]) {
      delete index[vaultPath];
      await this.writeIndex(bridge, index);
    }
  }

  // ---------- retry queue — so a bridge folder that's temporarily
  // unavailable (unmounted drive, permissions hiccup, folder not yet
  // configured) queues changes instead of silently dropping them ----------
  enqueueRetry(vaultPath) {
    this.syncQueue.add(vaultPath);
    this.persistQueue();
  }
  async persistQueue() {
    this.settings.pendingQueue = Array.from(this.syncQueue);
    await this.saveData(this.settings);
  }
  async flushQueue(announce) {
    if (!this.syncQueue.size) return;
    const bridge = this.bridgePaths();
    if (!bridge) return; // still not configured, keep waiting quietly
    const paths = Array.from(this.syncQueue);
    let recovered = 0;
    for (const p of paths) {
      const file = this.app.vault.getAbstractFileByPath(p);
      if (file instanceof TFile) {
        try { await this.syncNote(file); recovered++; }
        catch (e) { /* stays queued, will retry again next sweep */ }
      } else {
        this.syncQueue.delete(p); // note no longer exists — nothing to retry
      }
    }
    await this.persistQueue();
    if (announce) new Notice("Nest of Knowledge: " + recovered + " of " + paths.length + " pending note(s) synced.");
  }

  // ---------- initial / manual full-vault sync ----------
  async syncEntireVault() {
    const bridge = this.bridgePaths();
    if (!bridge) {
      new Notice("Set a bridge folder in Nest of Knowledge Sync settings first.");
      return;
    }
    const files = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f.path));
    new Notice("Nest of Knowledge: syncing " + files.length + " note(s)...");
    let ok = 0, failed = 0;
    for (const file of files) {
      try { await this.syncNote(file); ok++; }
      catch (e) { failed++; this.enqueueRetry(file.path); }
    }
    this.settings.lastFullSyncAt = new Date().toISOString();
    await this.saveData(this.settings);
    new Notice("Nest of Knowledge: synced " + ok + " note(s)" + (failed ? ", " + failed + " queued for retry" : "") + ".");
  }
};

class NestSyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Nest of Knowledge Sync" });
    containerEl.createEl("p", {
      text: "One-way: this vault stays the source of truth. Notes are copied out to a folder on " +
        "this computer; the life hub reads that folder in your browser. Nothing here ever writes " +
        "back into your vault.",
    });

    new Setting(containerEl)
      .setName("Bridge folder")
      .setDesc(
        "An absolute path on this computer where synced notes are written, e.g. " +
        "C:\\Projects\\dev-team\\nest-of-knowledge\\synced-notes. Point the life hub's " +
        "\"Connect Notes Folder\" button at this same folder."
      )
      .addText((text) => text
        .setPlaceholder("C:\\path\\to\\synced-notes")
        .setValue(this.plugin.settings.bridgeFolder)
        .onChange(async (value) => {
          this.plugin.settings.bridgeFolder = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("One vault-relative folder path per line. Notes inside these folders are never synced.")
      .addTextArea((text) => text
        .setPlaceholder("Private\nTemplates\nAttachments")
        .setValue((this.plugin.settings.excludedFolders || []).join("\n"))
        .onChange(async (value) => {
          this.plugin.settings.excludedFolders = value.split("\n").map((s) => s.trim()).filter(Boolean);
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName("Sync entire vault now")
      .setDesc(this.plugin.settings.lastFullSyncAt
        ? "Last full sync: " + new Date(this.plugin.settings.lastFullSyncAt).toLocaleString()
        : "Never run yet — use this once after installing to catch existing notes.")
      .addButton((btn) => btn
        .setButtonText("Sync now")
        .setCta()
        .onClick(() => this.plugin.syncEntireVault()));

    new Setting(containerEl)
      .setName("Pending retries")
      .setDesc(this.plugin.syncQueue.size + " note(s) waiting to sync (retried automatically every 30s).");
  }
}
