import Dexie, { type Table } from 'dexie';
import { type Task } from './types';

/**
 * TaskPlannerDatabase class
 * Inherits from Dexie to manage high-performance IndexedDB operations on client devices (PC & Phone).
 * Fully operational offline, preserving all task entries securely inside browser storage.
 */
class TaskPlannerDatabase extends Dexie {
  // Strongly-typed table matching our Dexie store
  tasks!: Table<Task>;

  constructor() {
    // Name of the IndexedDB browser database
    super('TaskPlannerOfflineDB');

    // Declare schema versions and indexes
    // We index status, priority, and updated_at for high-performance sorting/filtering
    this.version(1).stores({
      tasks: 'id, title, status, priority, due_date, category, completed, updated_at'
    });
  }
}

// Instantiate the singleton offline database
export const db = new TaskPlannerDatabase();

/**
 * Seed initial mock data so the app looks beautiful, premium, and functional on first launch.
 * Designed using realistic personal planner tasks.
 */
export async function seedMockDataIfEmpty() {
  const count = await db.tasks.count();
  if (count > 0) return; // Database already has items, do not overwrite

  const mockTasks: Task[] = [
    {
      id: 'mock-1',
      title: 'Design glassmorphic task board dashboard',
      description: 'Implement highly aesthetic dark mode styling using custom modern CSS variables, backdrop blur filters, and fluid layouts.',
      status: 'in_progress',
      priority: 'high',
      due_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], // 2 days in the future
      category: 'Design',
      completed: false,
      created_at: Date.now() - 3600000 * 2, // 2 hours ago
      updated_at: Date.now() - 3600000 * 2,
      version: 1
    },
    {
      id: 'mock-2',
      title: 'Configure Dexie.js local database layer',
      description: 'Verify local IndexedDB schema, write queries, and enable full offline operations without a live network connection.',
      status: 'done',
      priority: 'high',
      due_date: new Date().toISOString().split('T')[0], // Today
      category: 'Development',
      completed: true,
      created_at: Date.now() - 3600000 * 5, // 5 hours ago
      updated_at: Date.now() - 3600000 * 4,
      version: 1
    },
    {
      id: 'mock-3',
      title: 'Connect Supabase passphrase sync gateway',
      description: 'Write local hashing algorithms (SHA-256) for passwordless sync and structure visual Git-like pull/diff interactive boards.',
      status: 'todo',
      priority: 'medium',
      due_date: new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0], // 5 days in the future
      category: 'Development',
      completed: false,
      created_at: Date.now() - 3600000 * 1, // 1 hour ago
      updated_at: Date.now() - 3600000 * 1,
      version: 1
    },
    {
      id: 'mock-4',
      title: 'Plan morning run & healthy breakfast',
      description: 'Get fresh air in the morning and prepare oatmeal with fresh berries and walnuts.',
      status: 'todo',
      priority: 'low',
      due_date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
      category: 'Personal',
      completed: false,
      created_at: Date.now() - 3600000 * 24, // 24 hours ago
      updated_at: Date.now() - 3600000 * 24,
      version: 1
    }
  ];

  // Bulk add tasks to IndexedDB
  await db.tasks.bulkAdd(mockTasks);
}
