import { createClient } from '@supabase/supabase-js';
import { type Task, type TaskDiff, type FieldChange } from './types';

/**
 * SHA-256 Hash Function
 * Hashes the user's private sync passphrase securely in the browser.
 * This guarantees the raw passphrase never touches network streams or databases.
 */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const trimmed = passphrase.trim();
  if (!trimmed) return '';
  const msgBuffer = new TextEncoder().encode(trimmed);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Creates an ephemeral Supabase client instance using provided credentials.
 */
function getClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false } // We manage state locally, no browser cookie storage
  });
}

/**
 * Tests connection to the user's Supabase instance.
 * Attempts to make a lightweight query. If the credentials or tables are missing, returns an error.
 */
export async function testSyncConnection(url: string, key: string): Promise<boolean> {
  try {
    const supabase = getClient(url, key);
    // Ping the planner_sync table just to verify the table exists and access is open
    const { error } = await supabase
      .from('planner_sync')
      .select('updated_at')
      .limit(1);

    if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found", which is technically a success (table exists)
      throw error;
    }
    return true;
  } catch (err) {
    console.error('Connection test failed:', err);
    return false;
  }
}

/**
 * Push Engine (Upload Snapshot)
 * Sends the entire active local task array to Supabase.
 * It inserts or updates the row keyed by the hashed passphrase.
 */
export async function pushTasksToCloud(
  url: string,
  key: string,
  hash: string,
  tasks: Task[]
): Promise<{ success: boolean; revision: number; error?: string }> {
  try {
    const supabase = getClient(url, key);

    // 1. Fetch current revision if it exists
    const { data: current, error: fetchErr } = await supabase
      .from('planner_sync')
      .select('revision')
      .eq('passphrase_hash', hash)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    const nextRevision = current ? (current.revision || 1) + 1 : 1;

    // 2. Perform upsert operation
    const { error: upsertErr } = await supabase
      .from('planner_sync')
      .upsert({
        passphrase_hash: hash,
        tasks_json: tasks,
        revision: nextRevision,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'passphrase_hash'
      });

    if (upsertErr) throw upsertErr;

    return { success: true, revision: nextRevision };
  } catch (err: any) {
    console.error('Push failed:', err);
    return { success: false, revision: 0, error: err.message || 'Database error occurred' };
  }
}

/**
 * Pull Engine (Download Snapshot)
 * Fetches the remote task array from Supabase.
 */
export async function pullTasksFromCloud(
  url: string,
  key: string,
  hash: string
): Promise<{ success: boolean; tasks: Task[]; revision: number; error?: string }> {
  try {
    const supabase = getClient(url, key);

    const { data, error } = await supabase
      .from('planner_sync')
      .select('tasks_json, revision')
      .eq('passphrase_hash', hash)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // No snapshot found for this passphrase. Treat as success with empty list (initial setup)
      return { success: true, tasks: [], revision: 0 };
    }

    return {
      success: true,
      tasks: (data.tasks_json as Task[]) || [],
      revision: data.revision || 1
    };
  } catch (err: any) {
    console.error('Pull failed:', err);
    return { success: false, tasks: [], revision: 0, error: err.message || 'Database pull error occurred' };
  }
}

/**
 * Git-like Diff Comparison Engine
 * Compares your local database task array with the remote database task array.
 * Calculates exactly which tasks were:
 *  - Added Remotely (Exists remotely, missing locally)
 *  - Deleted Remotely (Exists locally, missing remotely)
 *  - Modified Remotely (Exists in both, but fields differ)
 */
export function computeTaskDifferences(localTasks: Task[], remoteTasks: Task[]): TaskDiff[] {
  const diffs: TaskDiff[] = [];
  const localMap = new Map<string, Task>(localTasks.map(t => [t.id, t]));
  const remoteMap = new Map<string, Task>(remoteTasks.map(t => [t.id, t]));

  // 1. Check for Added or Modified remotely
  for (const remoteTask of remoteTasks) {
    const localTask = localMap.get(remoteTask.id);

    if (!localTask) {
      // Exists in remote, but not local => Added Remotely
      diffs.push({
        id: remoteTask.id,
        type: 'added',
        remote: remoteTask,
        approved: false // Starts unapproved as per user directive
      });
    } else {
      // Exists in both. Compare field by field to see if modified.
      const fieldsToCompare: (keyof Task)[] = [
        'title',
        'description',
        'status',
        'priority',
        'due_date',
        'category',
        'completed'
      ];

      const changes: FieldChange[] = [];

      for (const field of fieldsToCompare) {
        const localVal = localTask[field];
        const remoteVal = remoteTask[field];

        // Format dates or handle undefined elegantly to avoid fake diffs
        const normLocal = localVal === undefined || localVal === null ? '' : localVal.toString();
        const normRemote = remoteVal === undefined || remoteVal === null ? '' : remoteVal.toString();

        if (normLocal !== normRemote) {
          changes.push({
            field,
            localValue: localVal,
            remoteValue: remoteVal
          });
        }
      }

      if (changes.length > 0) {
        diffs.push({
          id: remoteTask.id,
          type: 'modified',
          local: localTask,
          remote: remoteTask,
          changes,
          approved: false // Starts unapproved
        });
      }
    }
  }

  // 2. Check for Deleted remotely
  // If a task is present locally, but missing from remote:
  // In a single-user backup, it means either:
  //   - It was deleted on the other device and pushed to the cloud (so it should be deleted locally).
  //   - Or it was created locally and never pushed.
  // To keep the visual diff clear, we present it as a remote deletion ('deleted' type)
  // so the user can explicitly choose whether to delete it locally (approved = yes)
  // or keep it locally (approved = no, which saves the local task).
  for (const localTask of localTasks) {
    if (!remoteMap.has(localTask.id) && !localTask.id.startsWith('mock-')) {
      diffs.push({
        id: localTask.id,
        type: 'deleted',
        local: localTask,
        approved: false // Starts unapproved (meaning we default to KEEPING it unless user explicitly approves deleting it)
      });
    }
  }

  return diffs;
}
