/**
 * TypeScript Type Definitions for the Task Planner PWA
 * All interfaces are extensively commented as per styling instructions.
 */

// Represents the structure of a single Task stored locally in Dexie (IndexedDB)
export interface Task {
  id: string;             // Unique identifier (UUID or high-precision timestamp string)
  title: string;          // Main task title
  description?: string;   // Optional task details (supports markdown)
  status: 'todo' | 'in_progress' | 'done'; // Current task status/column
  priority: 'low' | 'medium' | 'high';    // Task priority tier
  due_date?: string;      // Optional deadline date string (YYYY-MM-DD)
  category: string;       // Task category group (e.g., 'Personal', 'Work')
  completed: boolean;     // Simple visual flag indicating task completion
  created_at: number;     // Creation epoch timestamp (ms)
  updated_at: number;     // Last modification epoch timestamp (ms)
  version: number;        // Logical clock version tracker (for conflict detection)
}

// Visual types of sync updates identified during a pull comparison
export type TaskChangeType = 'added' | 'deleted' | 'modified';

// Details of a single field change within a task
export interface FieldChange {
  field: keyof Task;      // The exact task attribute that changed
  localValue: any;        // Value on the current local device
  remoteValue: any;       // Value residing in the cloud database
}

// Represents a calculated difference between local and remote task states
export interface TaskDiff {
  id: string;             // ID of the target task
  type: TaskChangeType;   // Category of difference identified (added, deleted, modified)
  local?: Task;           // The task representation on the local client (null if added remotely)
  remote?: Task;          // The task representation on the remote server (null if deleted remotely)
  changes?: FieldChange[]; // Collection of specific field differences (only populated for 'modified' types)
  approved?: boolean;     // Tracks whether the user has approved merging this specific difference
}

// Configured credentials for passphrase-based cloud sync
export interface SyncConfig {
  supabaseUrl: string;    // URL endpoint of the user's Supabase instance
  supabaseKey: string;    // Anonymous API key of the user's Supabase instance
  passphrase: string;     // Raw private passphrase typed by the user
  hash: string;           // SHA-256 hash generated locally to access data
}
