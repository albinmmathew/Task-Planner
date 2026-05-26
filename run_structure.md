# Application Runtime & Architecture Structure

This document details the high-fidelity runtime lifecycle and data flow mechanisms of your **Local-First PWA Task Planner**. 

Because this application operates on a **local-first paradigm**, it prioritizes speed, absolute offline independence, and user data privacy, while leveraging a secure, on-demand cloud sync gateway.

---

## 1. File Boot & Serving Lifecycle (Offline Caching)

The application code behaves like a hybrid of a lightweight web app and a native desktop/mobile client.

```
       [ Client Device (PC or Phone) ]
                      │
            1. Open App Shortcut
                      │
         2. Service Worker Intercepts
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
   [ Offline Mode ]          [ Online Mode ]
   Serve assets from         Check for updates in background,
   local Cache immediately.  serve local cache immediately.
         │                         │
         └────────────┬────────────┘
                      ▼
            3. App Boots instantly
                 ( < 1 sec )
```

### Mechanics:
* **The PWA Service Worker**: Registered automatically via `vite-plugin-pwa`. When the app is built and hosted (Vercel/Netlify), opening the page caches all static assets (HTML, JS, CSS, SVG Favicon) inside the browser's persistent cache.
* **Instant Boot**: On subsequent launches, the browser entirely bypasses the network. The local Service Worker feeds files directly from cache storage, ensuring instant boot times even in complete offline mode.

---

## 2. Local-First Storage & Reactive UI Loop

Your day-to-day planning workflow takes place 100% locally on your device.

```
┌──────────────────────────────────────────────────────────────┐
│                      Local Client Device                     │
│                                                              │
│  [ User Action ]  ──► [ React UI Engine ] ──► [ Dexie.js ]   │
│         ▲                                         │          │
│         │                                         ▼          │
│  [ UI Rerender ]  ◄─── [ LiveQuery Hook ]  ◄── [ IndexedDB ] │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Mechanics:
* **Dexie (IndexedDB)**: A browser-native database that stores tasks directly on your physical hardware. It has no strict 5MB limit like `localStorage` and easily holds up to hundreds of megabytes.
* **Live Query Binding**: In `App.tsx`, the task board reads records using the Dexie hook: `useLiveQuery(() => db.tasks.toArray())`.
* **Zero Lag Loop**:
  1. You check a task completed, move a column, or edit text.
  2. The action is written to IndexedDB.
  3. Dexie instantly detects the mutation and reactive-pushes the state to the React UI component.
  4. The board updates smoothly within **2 milliseconds**, without any network lag or spinners.

---

## 3. On-Demand Version Sync Engine (Cloud Push & Pull)

The cloud database (**Supabase**) acts as a remote, secure Git-like version control repository. It is only contacted when you explicitly press **Push** or **Pull**.

### A. Uploading Local Snapshot (Push 📤)
Saves your current local task database state as a cloud version row.

```
 [ Local IndexedDB ] ──► [ Package as JSON ] ──► [ Local SHA-256 Hash ] ──► [ Push to Supabase ]
```
* **SHA-256 Passphrase Hashing**: When you configure sync settings, the app runs an industrial-grade SHA-256 hash on your private passphrase locally in browser memory. The raw passphrase is never transmitted over the network.
* **Database Upsert**: The task list is packaged as a single, compressed JSON snapshot and uploaded to your Supabase `planner_sync` table in the row keyed by your `passphrase_hash`.
* **Revision Control**: The sync engine auto-increments the cloud database revision number (e.g. Revision #3 ➔ #4) to represent a new "commit".

---

### B. Merging Cloud Changes (Pull 📥)
Fetches remote records and triggers the visual Git-diff selective merging workspace.

```
                           [ Pull Cloud Tasks JSON ]
                                      │
                                      ▼
                           [ Compute Git-Like Diff ]
                                      │
                 ┌────────────────────┼────────────────────┐
                 ▼                    ▼                    ▼
           [ Added Tasks ]      [ Deleted Tasks ]    [ Modified Tasks ]
            Exists remotely,     Exists locally,      Exists in both,
             missing locally      missing remotely     but fields differ
                 │                    │                    │
                 └────────────────────┼────────────────────┘
                                      ▼
                          [ Collapsible Review Panel ]
                                      │
                           [ Select Merges (Approve) ]
                                      │
                                      ▼
                       [ Write Approved rows to Dexie ]
```

* **Visual Git Diff**: The pull fetches the remote JSON array and compares it with your current local IndexedDB. It calculates three distinct difference types:
  * `added` (`+` Green): New tasks created on another device.
  * `deleted` (`-` Red): Tasks removed remotely.
  * `modified` (`~` Yellow): Core task fields (titles, status, priorities, etc.) that have different values.
* **Interactive Accordion Merges**:
  * You tap any modified task to open a side-by-side comparison showing *exactly* which fields changed (e.g., `Priority: Medium ➔ High`).
  * Tap **Approve** (accept cloud changes) or **Reject** (keep local changes).
* **Finalizing Writes**:
  * When you click **Finalize Merges**, only approved remote changes are committed to IndexedDB.
  * Rejected modifications are ignored locally, and will be pushed back to overwrite the cloud snapshot the next time you trigger a **Push**.

---

## 4. Native PWA App Shortcuts

To deliver an absolute premium native-app feel on both PC and mobile devices, the app utilizes native **PWA App Shortcuts**:

* **Windows Taskbar / Start Menu**: Right-clicking the installed app icon presents quick shortcut options.
* **Samsung Android Home Screen**: Long-pressing the home screen app icon brings up native quick actions.

### Active Shortcuts:
1. ➕ **Create New Task**:
   * Launches the app and injects `?action=new-task` into the URL query.
   * `App.tsx` intercepts the query string and automatically pops open the **Create Task** form immediately.
2. 🔄 **Cloud Pull Sync**:
   * Launches the app and injects `?action=pull` into the URL query.
   * `App.tsx` intercepts the query string and automatically triggers `handleCloudPullFetch()`, downloading the cloud database and opening the **Visual Git Diff Merging Modal** instantly!
