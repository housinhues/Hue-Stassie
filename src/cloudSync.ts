import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabaseClient';

export type CloudProject = {
  id: string;
  name: string;
  identity: string;
  status: string;
  priority: string;
  next_action: string;
  notes: string;
  workload: number;
};

export type CloudContentItem = {
  id: string;
  title: string;
  channel: string;
  state: string;
  caption: string;
  planned: string;
  identity: string;
};

export function isCloudConfigured() {
  return supabaseConfigured;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn('[Hue Stasie] getSession failed:', error.message);
    return null;
  }
  return data.session ?? null;
}

export function onAuthChange(callback: (session: Session | null) => void) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email: string) {
  if (!supabase) throw new Error('Cloud sync is not configured yet.');
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function fetchProjects(): Promise<CloudProject[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, identity, status, priority, next_action, notes, workload')
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`Could not load projects: ${error.message}`);
  }
  return data ?? [];
}

export async function upsertProject(project: CloudProject): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('projects').upsert(project, { onConflict: 'id' });
  if (error) { console.warn('[Hue Stasie] upsertProject failed:', error.message); return false; }
  return true;
}

export async function deleteProjectRemote(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) { console.warn('[Hue Stasie] deleteProject failed:', error.message); return false; }
  return true;
}

export async function fetchContent(): Promise<CloudContentItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('content_items')
    .select('id, title, channel, state, caption, planned, identity')
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`Could not load content: ${error.message}`);
  }
  return data ?? [];
}

export async function upsertContentItem(item: CloudContentItem): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('content_items').upsert(item, { onConflict: 'id' });
  if (error) { console.warn('[Hue Stasie] upsertContentItem failed:', error.message); return false; }
  return true;
}

export async function deleteContentItem(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('content_items').delete().eq('id', id);
  if (error) { console.warn('[Hue Stasie] deleteContentItem failed:', error.message); return false; }
  return true;
}

export type CloudSubtask = { id: string; project_id: string; text: string; done: boolean };

// Returns null when the subtasks table is unreachable so callers can fall back to local data.
export async function fetchSubtasks(): Promise<CloudSubtask[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('subtasks').select('id, project_id, text, done');
  if (error) { console.warn('[Hue Stasie] fetchSubtasks failed:', error.message); return null; }
  return data ?? [];
}

export async function syncProjectSubtasks(projectId: string, subtasks: { id: string; text: string; done: boolean }[]): Promise<boolean> {
  if (!supabase) return false;
  const keep = subtasks.map((t) => t.id);
  const del = keep.length
    ? await supabase.from('subtasks').delete().eq('project_id', projectId).not('id', 'in', `(${keep.map((id) => `"${id}"`).join(',')})`)
    : await supabase.from('subtasks').delete().eq('project_id', projectId);
  if (del.error) { console.warn('[Hue Stasie] subtask cleanup failed:', del.error.message); return false; }
  if (!subtasks.length) return true;
  const { error } = await supabase.from('subtasks').upsert(subtasks.map((t) => ({ id: t.id, project_id: projectId, text: t.text, done: t.done })), { onConflict: 'id' });
  if (error) { console.warn('[Hue Stasie] subtask upsert failed:', error.message); return false; }
  return true;
}

