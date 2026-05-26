import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  Plus, Edit2, Trash2, CheckCircle, Circle, Calendar, 
  RefreshCw, Settings, ChevronDown, ChevronUp, Database, UploadCloud, 
  DownloadCloud, Check, X, GitMerge, Search, Lock,
  FolderOpen, ShieldCheck, WifiOff
} from 'lucide-react';

import { db, seedMockDataIfEmpty } from './db';
import { type Task, type TaskDiff, type FieldChange } from './types';
import { 
  hashPassphrase, testSyncConnection, pushTasksToCloud, 
  pullTasksFromCloud, computeTaskDifferences 
} from './sync';

// Default categories available for tasks
const AVAILABLE_CATEGORIES = ['All', 'Personal', 'Work', 'Design', 'Development', 'Urgent'];

export default function App() {
  // ----------------------------------------------------
  // 1. STATE VARIABLES & REACTIVE DATABASE BINDINGS
  // ----------------------------------------------------
  
  // Reactively query Dexie local database. Rerenders automatically on any DB write!
  const localTasks = useLiveQuery(() => db.tasks.toArray()) || [];

  // Search, Sort, and Filter UI states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState<'created' | 'due' | 'priority'>('created');

  // Task Add/Edit Form states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [taskForm, setTaskForm] = useState<Partial<Task>>({
    title: '',
    description: '',
    status: 'todo',
    priority: 'medium',
    due_date: '',
    category: 'Personal'
  });

  // Sync Settings form states (stored locally in localStorage)
  const [isSyncSettingsOpen, setIsSyncSettingsOpen] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState(() => localStorage.getItem('sync_supabase_url') || '');
  const [supabaseKey, setSupabaseKey] = useState(() => localStorage.getItem('sync_supabase_key') || '');
  const [syncPassphrase, setSyncPassphrase] = useState(() => localStorage.getItem('sync_passphrase') || '');
  
  // Live Syncing process tracking
  const [syncState, setSyncState] = useState<'idle' | 'connecting' | 'pushing' | 'pulling' | 'diff_review'>('idle');
  const [syncStatusMsg, setSyncStatusMsg] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  // Git-like interactive Diff and Merge states
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [diffs, setDiffs] = useState<TaskDiff[]>([]);
  const [expandedDiffTaskId, setExpandedDiffTaskId] = useState<string | null>(null);
  const [remoteRevision, setRemoteRevision] = useState(0);

  // Custom PWA installation promotion event state
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  // Seed mock data if database is empty on first load
  useEffect(() => {
    seedMockDataIfEmpty().catch(console.error);
  }, []);

  // Proactively check if configured sync settings are working
  useEffect(() => {
    if (supabaseUrl && supabaseKey) {
      testSyncConnection(supabaseUrl, supabaseKey)
        .then(res => setIsConnected(res))
        .catch(() => setIsConnected(false));
    }
  }, [supabaseUrl, supabaseKey]);

  // Handle native PWA App Shortcuts on launch (?action=new-task or ?action=pull)
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const action = queryParams.get('action');
    
    if (action === 'new-task') {
      // Clean query string from browser bar without triggering refresh
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => {
        openAddModal();
      }, 250);
    } else if (action === 'pull') {
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => {
        handleCloudPullFetch();
      }, 500);
    }
  }, [isConnected]); // Run when connection is checked to trigger sync securely if configured

  // PWA Promotion: Listen for the standard browser beforeinstallprompt trigger
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as any);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as any);
    };
  }, []);

  // Action callback linked to custom Install button in app UI
  const handleInstallAppClick = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') {
        console.log('App install accepted by user');
      }
      setInstallPrompt(null);
    }
  };

  // ----------------------------------------------------
  // 2. TASK OPERATIONS (LOCAL CRUD IN INDEXEDDB)
  // ----------------------------------------------------

  // Fast completion toggling from the board list
  const toggleTaskCompletion = async (task: Task) => {
    const nextCompleted = !task.completed;
    const nextStatus = nextCompleted ? 'done' : 'todo';
    
    await db.tasks.update(task.id, {
      completed: nextCompleted,
      status: nextStatus,
      updated_at: Date.now(),
      version: task.version + 1 // Logical clock increment
    });
  };

  // Triggers when opening Edit Modal
  const openEditModal = (task: Task) => {
    setModalMode('edit');
    setTaskForm(task);
    setIsModalOpen(true);
  };

  // Triggers when opening Add Modal
  const openAddModal = () => {
    setModalMode('add');
    setTaskForm({
      title: '',
      description: '',
      status: 'todo',
      priority: 'medium',
      due_date: new Date().toISOString().split('T')[0],
      category: 'Personal'
    });
    setIsModalOpen(true);
  };

  // Submits Add/Edit task forms directly to Dexie
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.title?.trim()) return;

    const timestamp = Date.now();

    if (modalMode === 'add') {
      const newTask: Task = {
        id: crypto.randomUUID(), // High-precision unique identifier
        title: taskForm.title.trim(),
        description: taskForm.description?.trim() || '',
        status: taskForm.status || 'todo',
        priority: taskForm.priority || 'medium',
        due_date: taskForm.due_date || '',
        category: taskForm.category || 'Personal',
        completed: taskForm.status === 'done',
        created_at: timestamp,
        updated_at: timestamp,
        version: 1 // Start version
      };
      await db.tasks.add(newTask);
    } else if (modalMode === 'edit' && taskForm.id) {
      const currentVersion = taskForm.version || 1;
      await db.tasks.update(taskForm.id, {
        title: taskForm.title.trim(),
        description: taskForm.description?.trim() || '',
        status: taskForm.status || 'todo',
        priority: taskForm.priority || 'medium',
        due_date: taskForm.due_date || '',
        category: taskForm.category || 'Personal',
        completed: taskForm.status === 'done',
        updated_at: timestamp,
        version: currentVersion + 1 // Increment clock
      });
    }

    setIsModalOpen(false);
  };

  // Deletes task from Dexie
  const handleDeleteTask = async (id: string) => {
    if (confirm('Are you sure you want to delete this task? This is stored locally.')) {
      await db.tasks.delete(id);
    }
  };

  // ----------------------------------------------------
  // 3. CLOUD SYNC LOGIC (PUSH / PULL / DIFF COMPUTE)
  // ----------------------------------------------------

  // Saves credentials to localStorage
  const handleSaveSyncSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncState('connecting');
    setSyncStatusMsg('Verifying connection credentials...');

    const connected = await testSyncConnection(supabaseUrl, supabaseKey);

    if (connected) {
      localStorage.setItem('sync_supabase_url', supabaseUrl);
      localStorage.setItem('sync_supabase_key', supabaseKey);
      localStorage.setItem('sync_passphrase', syncPassphrase);
      setIsConnected(true);
      setSyncState('idle');
      setIsSyncSettingsOpen(false);
      alert('Sync credentials configured successfully!');
    } else {
      setIsConnected(false);
      setSyncState('idle');
      alert('Connection test failed. Please check your Supabase credentials.');
    }
  };

  // Push Local snapshot to Cloud (Overwrites Remote with local state)
  const handleCloudPush = async () => {
    if (!isConnected || !syncPassphrase) {
      setIsSyncSettingsOpen(true);
      return;
    }

    setSyncState('pushing');
    setSyncStatusMsg('Preparing local snapshot for commit...');

    try {
      const hash = await hashPassphrase(syncPassphrase);
      const allLocalTasks = await db.tasks.toArray();

      const result = await pushTasksToCloud(supabaseUrl, supabaseKey, hash, allLocalTasks);

      if (result.success) {
        setSyncStatusMsg(`Successfully pushed state! Revision #${result.revision}`);
        setTimeout(() => setSyncState('idle'), 2000);
      } else {
        alert(`Push failed: ${result.error}`);
        setSyncState('idle');
      }
    } catch (err: any) {
      alert(`Push error: ${err.message || err}`);
      setSyncState('idle');
    }
  };

  // Fetch cloud snapshot and prepare visual Diff comparison
  const handleCloudPullFetch = async () => {
    if (!isConnected || !syncPassphrase) {
      setIsSyncSettingsOpen(true);
      return;
    }

    setSyncState('pulling');
    setSyncStatusMsg('Fetching cloud version snapshot...');

    try {
      const hash = await hashPassphrase(syncPassphrase);
      const result = await pullTasksFromCloud(supabaseUrl, supabaseKey, hash);

      if (result.success) {
        const allLocalTasks = await db.tasks.toArray();
        // Compute differences field-by-field
        const calculatedDiffs = computeTaskDifferences(allLocalTasks, result.tasks);

        setRemoteRevision(result.revision);

        if (calculatedDiffs.length === 0) {
          alert('Local tasks are already 100% in sync with the cloud database. No changes detected.');
          setSyncState('idle');
        } else {
          // Open Visual Git Diff and selective merge Modal
          setDiffs(calculatedDiffs);
          setSyncState('diff_review');
          setIsDiffModalOpen(true);
        }
      } else {
        alert(`Fetch failed: ${result.error}`);
        setSyncState('idle');
      }
    } catch (err: any) {
      alert(`Fetch error: ${err.message || err}`);
      setSyncState('idle');
    }
  };

  // ----------------------------------------------------
  // LOCAL FILE BACKUP OPERATIONS (OFFLINE JSON STORAGE)
  // ----------------------------------------------------

  // Exports the active Dexie task database as a downloadable JSON file
  const handleExportBackup = async () => {
    try {
      const allTasks = await db.tasks.toArray();
      const backupData = JSON.stringify(allTasks, null, 2);
      
      // Create a blob representing the JSON file
      const blob = new Blob([backupData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      // Build a temporary anchor tag to programmatically download the file
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', url);
      const today = new Date().toISOString().split('T')[0];
      downloadAnchor.setAttribute('download', `task-planner-backup-${today}.json`);
      
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Backup failed: ${err.message || err}`);
    }
  };

  // Reads a JSON backup file and merges it into the local IndexedDB
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileReader = new FileReader();
    fileReader.onload = async (event) => {
      try {
        const fileContent = event.target?.result as string;
        const importedTasks = JSON.parse(fileContent);

        // Safety validation: Ensure it is a valid task array
        if (!Array.isArray(importedTasks)) {
          throw new Error('Import format must be a JSON array of tasks.');
        }

        if (importedTasks.length > 0) {
          const sampleTask = importedTasks[0];
          if (!sampleTask.id || !sampleTask.title || !sampleTask.status) {
            throw new Error('Parsed array does not contain valid task records.');
          }
        }

        const confirmMsg = `Are you sure you want to import ${importedTasks.length} tasks? This will merge them with your current local database.`;
        if (confirm(confirmMsg)) {
          // Bulk put tasks into local Dexie (keys on task.id to overwrite duplicates/preserve edits)
          await db.tasks.bulkPut(importedTasks);
          alert('Local tasks imported and merged successfully!');
          // Reset file input value
          e.target.value = '';
        }
      } catch (err: any) {
        alert(`Import failed: ${err.message || 'Ensure this is a valid JSON task planner backup.'}`);
      }
    };
    fileReader.readAsText(file);
  };

  // ----------------------------------------------------
  // 4. INTERACTIVE MERGE ACTIONS (GIT REBASE ENGINE)
  // ----------------------------------------------------

  // Approves a specific task diff
  const handleApproveDiff = (id: string, approved: boolean) => {
    setDiffs(prev => prev.map(d => d.id === id ? { ...d, approved } : d));
  };

  // Global bulk operation: Approve All
  const handleApproveAll = () => {
    setDiffs(prev => prev.map(d => ({ ...d, approved: true })));
  };

  // Global bulk operation: Reject All
  const handleRejectAll = () => {
    setDiffs(prev => prev.map(d => ({ ...d, approved: false })));
  };

  // Finalizes the merge, writing only approved remote tasks to IndexedDB
  const handleFinalizeMerge = async () => {
    setSyncStatusMsg('Merging approved changes to local database...');
    
    let appliedCount = 0;

    for (const diff of diffs) {
      if (diff.approved) {
        appliedCount++;
        
        if (diff.type === 'added' && diff.remote) {
          // Remote added: Insert into local Dexie
          await db.tasks.put(diff.remote);
        } else if (diff.type === 'deleted') {
          // Remote deleted: Delete from local Dexie
          await db.tasks.delete(diff.id);
        } else if (diff.type === 'modified' && diff.remote) {
          // Remote modified: Overwrite local task
          await db.tasks.put(diff.remote);
        }
      }
    }

    setIsDiffModalOpen(false);
    setSyncState('idle');
    alert(`Merge completed! Applied ${appliedCount} of ${diffs.length} cloud differences to local storage.`);
  };

  // ----------------------------------------------------
  // 5. SORTING & FILTERING MATHEMATICS
  // ----------------------------------------------------
  
  const filteredTasks = localTasks
    .filter(task => {
      const matchSearch = 
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchCategory = selectedCategory === 'All' || task.category === selectedCategory;
      return matchSearch && matchCategory;
    })
    .sort((a, b) => {
      if (sortBy === 'created') {
        return b.created_at - a.created_at;
      }
      if (sortBy === 'due') {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date);
      }
      if (sortBy === 'priority') {
        const priorityWeight = { high: 3, medium: 2, low: 1 };
        return priorityWeight[b.priority] - priorityWeight[a.priority];
      }
      return 0;
    });

  // Split tasks into Kanban Status Columns
  const todoTasks = filteredTasks.filter(t => t.status === 'todo');
  const inProgressTasks = filteredTasks.filter(t => t.status === 'in_progress');
  const doneTasks = filteredTasks.filter(t => t.status === 'done');

  // Simple drag-over support to switch columns smoothly
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Required to allow drop events
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: 'todo' | 'in_progress' | 'done') => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const task = localTasks.find(t => t.id === id);
    if (task && task.status !== targetStatus) {
      await db.tasks.update(id, {
        status: targetStatus,
        completed: targetStatus === 'done',
        updated_at: Date.now(),
        version: task.version + 1
      });
    }
  };

  return (
    <div className="app-container">
      {/* ----------------------------------------------------
          HEADER SECTION
         ---------------------------------------------------- */}
      <header className="app-header">
        <div className="brand-section">
          <GitMerge size={32} className="logo-icon" />
          <h1 className="app-title">Task Planner</h1>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {/* Custom PWA Install Promotion Button */}
          {installPrompt && (
            <button 
              className="btn btn-success"
              onClick={handleInstallAppClick}
              title="Install Standalone PWA App"
            >
              <DownloadCloud size={16} />
              <span>Install App</span>
            </button>
          )}

          {/* Synchronized indicator */}
          <div className={`sync-indicator ${isConnected ? 'synced' : ''}`}>
            <Database size={14} />
            <span>{isConnected ? 'Sync Online' : 'Local Only'}</span>
          </div>

          <button 
            className="btn btn-secondary"
            onClick={() => setIsSyncSettingsOpen(true)}
            title="Configure Cloud Sync & Backups"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* ----------------------------------------------------
          SYNC CARD (IF UNCONNECTED & HAS CREDENTIALS IN LS)
         ---------------------------------------------------- */}
      {isSyncSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSyncSettingsOpen(false)}>
          <div className="modal-content glass-panel diff-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '850px' }}>
            {/* Modal Title */}
            <div className="diff-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Settings size={22} className="logo-icon" />
                <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Sync & backups</h2>
              </div>
              <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={() => setIsSyncSettingsOpen(false)}>
                <X size={18} />
              </button>
            </div>

            {/* Split Grid Layout for PC (side-by-side) and Mobile (stacked) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', marginTop: '1rem' }}>
              
              {/* LEFT COLUMN: LOCAL BACKUP & APP CORE VALUES */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                
                {/* 1. Offline Backups Section */}
                <div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1rem', marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
                    Local data transfer (Offline)
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: '1rem' }}>
                    Save tasks directly to your PC or phone as a JSON backup file. No internet required.
                  </p>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleExportBackup}>
                      <FolderOpen size={16} style={{ color: 'var(--accent-secondary)' }} />
                      <span>Export JSON</span>
                    </button>

                    <button 
                      className="btn btn-secondary" 
                      style={{ flex: 1 }}
                      onClick={() => document.getElementById('import-file-selector')?.click()}
                    >
                      <UploadCloud size={16} style={{ color: 'var(--color-success)' }} />
                      <span>Import JSON</span>
                    </button>
                    
                    {/* Hidden Native File Selector */}
                    <input 
                      type="file" 
                      id="import-file-selector" 
                      style={{ display: 'none' }} 
                      accept=".json"
                      onChange={handleImportBackup} 
                    />
                  </div>
                </div>

                {/* 2. Core App Principles cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1rem', color: 'var(--color-text-primary)' }}>
                    Core principles
                  </h3>

                  {/* Principle 1 */}
                  <div style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)' }}>
                    <FolderOpen size={20} style={{ color: 'var(--accent-secondary)', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>File-Based Storage</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', lineHeight: 1.4, marginTop: '0.15rem' }}>
                        Projects are saved as JSON in folders you control, making backup and transfer easy.
                      </p>
                    </div>
                  </div>

                  {/* Principle 2 */}
                  <div style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)' }}>
                    <ShieldCheck size={20} style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>No Accounts Needed</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', lineHeight: 1.4, marginTop: '0.15rem' }}>
                        No sign-up or login required. Install and start planning immediately.
                      </p>
                    </div>
                  </div>

                  {/* Principle 3 */}
                  <div style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)' }}>
                    <WifiOff size={20} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>Works Offline</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', lineHeight: 1.4, marginTop: '0.15rem' }}>
                        No internet required. Your planning workflow remains available everywhere.
                      </p>
                    </div>
                  </div>

                </div>
              </div>

              {/* RIGHT COLUMN: CLOUD SYNC CONFIGURATION */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderLeft: '1px solid var(--border-glass)', paddingLeft: '1.5rem' }} className="cloud-sync-col">
                <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1rem', color: 'var(--color-text-primary)' }}>
                  Cloud sync (Multi-Device)
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Configure your free Supabase details to synchronize your tasks across your Windows PC and Samsung Android phone.
                </p>

                <form onSubmit={handleSaveSyncSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="form-row">
                    <label>Supabase URL</label>
                    <input 
                      type="url" 
                      className="glass-input" 
                      placeholder="https://your-project-id.supabase.co"
                      value={supabaseUrl}
                      onChange={e => setSupabaseUrl(e.target.value)}
                      required 
                    />
                  </div>

                  <div className="form-row">
                    <label>Anonymous API Key</label>
                    <input 
                      type="password" 
                      className="glass-input" 
                      placeholder="eyJhbGciOiJIUzI1NiIs..."
                      value={supabaseKey}
                      onChange={e => setSupabaseKey(e.target.value)}
                      required 
                    />
                  </div>

                  <div className="form-row">
                    <label>Private Sync Passphrase</label>
                    <input 
                      type="password" 
                      className="glass-input" 
                      placeholder="Enter private sync key"
                      value={syncPassphrase}
                      onChange={e => setSyncPassphrase(e.target.value)}
                      required 
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setIsSyncSettingsOpen(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={syncState === 'connecting'}>
                      {syncState === 'connecting' ? 'Verifying...' : 'Save & Sync'}
                    </button>
                  </div>
                </form>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          ACTION CONTROL BAR (SEARCH, FILTERS, SYNC TRIGGER)
         ---------------------------------------------------- */}
      <section className="action-bar glass-panel">
        <div style={{ display: 'flex', gap: '0.75rem', flex: 1, flexWrap: 'wrap' }}>
          {/* Search bar */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', color: 'var(--color-text-muted)' }} />
            <input 
              type="text" 
              className="glass-input" 
              placeholder="Search tasks..." 
              style={{ paddingLeft: '36px', width: '100%' }}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Category filter */}
          <select 
            className="glass-select"
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
          >
            {AVAILABLE_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat} Category</option>
            ))}
          </select>

          {/* Sort dropdown */}
          <select 
            className="glass-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
          >
            <option value="created">Sort: Date Created</option>
            <option value="due">Sort: Due Date</option>
            <option value="priority">Sort: Priority</option>
          </select>
        </div>

        {/* Sync panel operations */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn btn-secondary"
            onClick={handleCloudPullFetch}
            disabled={syncState !== 'idle'}
            title="Pull and merge changes"
          >
            <DownloadCloud size={16} />
            <span>Pull</span>
          </button>
          
          <button 
            className="btn btn-secondary"
            onClick={handleCloudPush}
            disabled={syncState !== 'idle'}
            title="Push local commits"
          >
            <UploadCloud size={16} />
            <span>Push</span>
          </button>

          <button 
            className="btn btn-primary"
            onClick={openAddModal}
          >
            <Plus size={16} />
            <span>New Task</span>
          </button>
        </div>
      </section>

      {/* Sync process logs loader */}
      {syncState !== 'idle' && syncState !== 'diff_review' && (
        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', borderColor: 'var(--accent-primary)' }}>
          <RefreshCw size={18} className="logo-icon" style={{ animation: 'spin 2s linear infinite' }} />
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{syncStatusMsg}</span>
        </div>
      )}

      {/* ----------------------------------------------------
          MAIN KANBAN BOARD SYSTEM
         ---------------------------------------------------- */}
      <main className="board-grid">
        {/* TO DO COLUMN */}
        <section 
          className="glass-panel"
          onDragOver={handleDragOver}
          onDrop={e => handleDrop(e, 'todo')}
        >
          <div className="column-header">
            <span style={{ color: 'var(--color-text-primary)' }}>To Do</span>
            <span className="column-count">{todoTasks.length}</span>
          </div>

          <div className="task-list">
            {todoTasks.length === 0 ? (
              <div className="empty-state">
                <Circle size={28} className="empty-state-icon" />
                <p style={{ fontSize: '0.8rem' }}>No pending tasks</p>
              </div>
            ) : (
              todoTasks.map(task => (
                <div 
                  key={task.id} 
                  className={`glass-panel task-card priority-${task.priority}`}
                  draggable
                  onDragStart={e => handleDragStart(e, task.id)}
                >
                  <div className="task-card-header">
                    <button 
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', marginTop: '2px' }}
                      onClick={() => toggleTaskCompletion(task)}
                    >
                      <Circle size={18} />
                    </button>
                    <span className="task-card-title" style={{ flex: 1, marginLeft: '0.5rem' }}>{task.title}</span>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.3rem' }} onClick={() => openEditModal(task)}>
                        <Edit2 size={12} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '0.3rem' }} onClick={() => handleDeleteTask(task.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {task.description && (
                    <p className="task-card-desc">{task.description}</p>
                  )}

                  <div className="task-card-footer">
                    <span className={`task-badge badge-${task.category.toLowerCase()} badge-default`}>
                      {task.category}
                    </span>

                    <div className="task-meta-group">
                      {task.due_date && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Calendar size={12} />
                          <span>{task.due_date}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* IN PROGRESS COLUMN */}
        <section 
          className="glass-panel"
          onDragOver={handleDragOver}
          onDrop={e => handleDrop(e, 'in_progress')}
        >
          <div className="column-header">
            <span style={{ color: 'var(--color-warning)' }}>In Progress</span>
            <span className="column-count">{inProgressTasks.length}</span>
          </div>

          <div className="task-list">
            {inProgressTasks.length === 0 ? (
              <div className="empty-state">
                <RefreshCw size={28} className="empty-state-icon" />
                <p style={{ fontSize: '0.8rem' }}>Move tasks here</p>
              </div>
            ) : (
              inProgressTasks.map(task => (
                <div 
                  key={task.id} 
                  className={`glass-panel task-card priority-${task.priority}`}
                  draggable
                  onDragStart={e => handleDragStart(e, task.id)}
                >
                  <div className="task-card-header">
                    <button 
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', marginTop: '2px' }}
                      onClick={() => toggleTaskCompletion(task)}
                    >
                      <Circle size={18} />
                    </button>
                    <span className="task-card-title" style={{ flex: 1, marginLeft: '0.5rem' }}>{task.title}</span>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.3rem' }} onClick={() => openEditModal(task)}>
                        <Edit2 size={12} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '0.3rem' }} onClick={() => handleDeleteTask(task.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {task.description && (
                    <p className="task-card-desc">{task.description}</p>
                  )}

                  <div className="task-card-footer">
                    <span className={`task-badge badge-${task.category.toLowerCase()} badge-default`}>
                      {task.category}
                    </span>

                    <div className="task-meta-group">
                      {task.due_date && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Calendar size={12} />
                          <span>{task.due_date}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* DONE COLUMN */}
        <section 
          className="glass-panel"
          onDragOver={handleDragOver}
          onDrop={e => handleDrop(e, 'done')}
        >
          <div className="column-header">
            <span style={{ color: 'var(--color-success)' }}>Completed</span>
            <span className="column-count">{doneTasks.length}</span>
          </div>

          <div className="task-list">
            {doneTasks.length === 0 ? (
              <div className="empty-state">
                <CheckCircle size={28} className="empty-state-icon" />
                <p style={{ fontSize: '0.8rem' }}>Check off tasks</p>
              </div>
            ) : (
              doneTasks.map(task => (
                <div 
                  key={task.id} 
                  className={`glass-panel task-card completed priority-${task.priority}`}
                  draggable
                  onDragStart={e => handleDragStart(e, task.id)}
                >
                  <div className="task-card-header">
                    <button 
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success)', marginTop: '2px' }}
                      onClick={() => toggleTaskCompletion(task)}
                    >
                      <CheckCircle size={18} />
                    </button>
                    <span className="task-card-title" style={{ flex: 1, marginLeft: '0.5rem' }}>{task.title}</span>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.3rem' }} onClick={() => openEditModal(task)}>
                        <Edit2 size={12} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '0.3rem' }} onClick={() => handleDeleteTask(task.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {task.description && (
                    <p className="task-card-desc">{task.description}</p>
                  )}

                  <div className="task-card-footer">
                    <span className={`task-badge badge-${task.category.toLowerCase()} badge-default`}>
                      {task.category}
                    </span>

                    <div className="task-meta-group">
                      {task.due_date && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Calendar size={12} />
                          <span>{task.due_date}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {/* Floating Plus button for Mobile Devices */}
      <button className="fab-button" onClick={openAddModal} title="Create New Task">
        <Plus size={24} />
      </button>

      {/* ----------------------------------------------------
          ADD / EDIT TASK POPUP MODAL
         ---------------------------------------------------- */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                {modalMode === 'add' ? 'Create new task' : 'Modify task'}
              </h2>
              <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={() => setIsModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveTask} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-row">
                <label>Task Title</label>
                <input 
                  type="text" 
                  className="glass-input" 
                  value={taskForm.title || ''}
                  onChange={e => setTaskForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="What needs to be done?" 
                  required 
                  autoFocus
                />
              </div>

              <div className="form-row">
                <label>Description Details</label>
                <textarea 
                  className="glass-textarea" 
                  rows={3}
                  value={taskForm.description || ''}
                  onChange={e => setTaskForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Task notes, checklist steps, or guidelines..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-row">
                  <label>Priority</label>
                  <select 
                    className="glass-select"
                    value={taskForm.priority || 'medium'}
                    onChange={e => setTaskForm(prev => ({ ...prev, priority: e.target.value as any }))}
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                  </select>
                </div>

                <div className="form-row">
                  <label>Status</label>
                  <select 
                    className="glass-select"
                    value={taskForm.status || 'todo'}
                    onChange={e => setTaskForm(prev => ({ ...prev, status: e.target.value as any }))}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Completed</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-row">
                  <label>Category</label>
                  <select 
                    className="glass-select"
                    value={taskForm.category || 'Personal'}
                    onChange={e => setTaskForm(prev => ({ ...prev, category: e.target.value }))}
                  >
                    {AVAILABLE_CATEGORIES.filter(c => c !== 'All').map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="form-row">
                  <label>Due Date</label>
                  <input 
                    type="date" 
                    className="glass-input" 
                    value={taskForm.due_date || ''}
                    onChange={e => setTaskForm(prev => ({ ...prev, due_date: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          VISUAL GIT DIFF SELECTIVE MERGING BOARD
         ---------------------------------------------------- */}
      {isDiffModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel diff-modal">
            
            {/* Header info */}
            <div className="diff-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <GitMerge size={20} className="logo-icon" />
                  <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Review cloud diffs</h2>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                  Hashed Sync revision <strong>#{remoteRevision}</strong>.
                  Toggle modifications and selectively choose updates to merge.
                </p>
              </div>
              <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={() => setIsDiffModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            {/* General approval operations */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', margin: '0.75rem 0', border: '1px solid var(--border-glass)' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Bulk actions</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={handleApproveAll}>
                  Approve all
                </button>
                <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={handleRejectAll}>
                  Reject all
                </button>
              </div>
            </div>

            {/* Diff review lists */}
            <div className="diff-body">
              {diffs.map(diff => {
                const isExpanded = expandedDiffTaskId === diff.id;
                const taskTitle = diff.remote?.title || diff.local?.title || 'Untitled task';
                
                return (
                  <div key={diff.id} className={`diff-row type-${diff.type} ${isExpanded ? 'expanded' : ''}`}>
                    {/* Header bar */}
                    <div className="diff-row-header" onClick={() => setExpandedDiffTaskId(isExpanded ? null : diff.id)}>
                      <div className="diff-row-info">
                        <div className="diff-indicator">
                          {diff.type === 'added' ? '+' : diff.type === 'deleted' ? '-' : '~'}
                        </div>
                        <span className="diff-task-title">{taskTitle}</span>
                        <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', padding: '0.1rem 0.4rem', background: 'var(--border-glass)', borderRadius: '4px', color: 'var(--color-text-muted)' }}>
                          {diff.type}
                        </span>
                      </div>

                      {/* Approval badge and expansion toggle */}
                      <div className="diff-row-actions" onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className={`approval-status-badge ${diff.approved ? 'approved' : 'rejected'}`}>
                            {diff.approved ? 'Approved' : 'Rejected'}
                          </span>
                          
                          {/* Sync toggle button */}
                          <button 
                            className={`btn ${diff.approved ? 'btn-success' : 'btn-secondary'}`}
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                            onClick={() => handleApproveDiff(diff.id, !diff.approved)}
                          >
                            {diff.approved ? <Check size={14} /> : <X size={14} />}
                          </button>
                        </div>

                        <div style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted)' }}>
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </div>
                    </div>

                    {/* Detailed field-by-field differences */}
                    {isExpanded && (
                      <div className="diff-row-details">
                        {diff.type === 'added' && diff.remote && (
                          <div style={{ fontSize: '0.85rem', color: 'var(--color-success)', background: 'var(--color-success-bg)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px dashed hsla(142, 70%, 45%, 0.2)' }}>
                            <strong>New Remote Task Details:</strong>
                            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', color: 'var(--color-text-primary)' }}>
                              <div>• Title: {diff.remote.title}</div>
                              <div>• Status: {diff.remote.status}</div>
                              <div>• Priority: {diff.remote.priority}</div>
                              <div>• Category: {diff.remote.category}</div>
                              {diff.remote.description && <div>• Description: {diff.remote.description}</div>}
                            </div>
                          </div>
                        )}

                        {diff.type === 'deleted' && diff.local && (
                          <div style={{ fontSize: '0.85rem', color: 'var(--color-danger)', background: 'var(--color-danger-bg)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px dashed hsla(350, 89%, 60%, 0.2)' }}>
                            <strong>Warning: Task was deleted in the cloud database.</strong>
                            <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                              Approving this change will remove the task permanently from your local device.
                              Rejecting this change will preserve the task in your local planner list.
                            </p>
                          </div>
                        )}

                        {diff.type === 'modified' && diff.changes && (
                          <div className="field-diff-grid">
                            <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 20px 1fr', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                              <span>Field</span>
                              <span>Local Value (Your Device)</span>
                              <span></span>
                              <span>Remote Value (Cloud)</span>
                            </div>
                            
                            {diff.changes.map((change: FieldChange) => (
                              <div key={change.field} className="field-diff-item">
                                <span className="field-diff-name">{change.field === 'due_date' ? 'Due Date' : change.field}</span>
                                <span className="field-diff-val local">
                                  {change.localValue === undefined || change.localValue === null || change.localValue === '' 
                                    ? '[Empty]' 
                                    : change.localValue.toString()}
                                </span>
                                <span className="field-diff-arrow">➔</span>
                                <span className="field-diff-val remote">
                                  {change.remoteValue === undefined || change.remoteValue === null || change.remoteValue === '' 
                                    ? '[Empty]' 
                                    : change.remoteValue.toString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Collapsible Action Footer */}
                        <div className="diff-detail-footer">
                          <span>Approve remote value?</span>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                            onClick={() => handleApproveDiff(diff.id, false)}
                          >
                            Keep local (Reject)
                          </button>
                          <button 
                            className="btn btn-success" 
                            style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                            onClick={() => handleApproveDiff(diff.id, true)}
                          >
                            Accept remote (Merge)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Merge finalize button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1rem', marginTop: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setIsDiffModalOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleFinalizeMerge}>
                <GitMerge size={16} />
                <span>Finalize approved merges</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          VISUAL FOOTER WITH PRIVACY NOTE & LOCAL INDICATOR
         ---------------------------------------------------- */}
      <footer style={{ marginTop: 'auto', paddingTop: '2rem', borderTop: '1px solid var(--border-glass)', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <span>Offline-First Task Planner • 2026</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span>Hashed Passphrase Security Active</span>
          <Lock size={10} style={{ color: 'var(--color-success)' }} />
        </div>
      </footer>
    </div>
  );
}
