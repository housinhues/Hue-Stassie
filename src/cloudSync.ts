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

export async function upsertProject(project: CloudProject) {
  if (!supabase) return;
  const { error } = await supabase.from('projects').upsert(project, { onConflict: 'id' });
  if (error) console.warn('[Hue Stasie] upsertProject failed:', error.message);
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

export async function upsertContentItem(item: CloudContentItem) {
  if (!supabase) return;
  const { error } = await supabase.from('content_items').upsert(item, { onConflict: 'id' });
  if (error) console.warn('[Hue Stasie] upsertContentItem failed:', error.message);
}

export async function deleteContentItem(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from('content_items').delete().eq('id', id);
  if (error) console.warn('[Hue Stasie] deleteContentItem failed:', error.message);
}
