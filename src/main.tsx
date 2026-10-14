import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import './styles.css';
import {
  isCloudConfigured, getSession, onAuthChange, signInWithEmail, signOut,
  fetchProjects, upsertProject, fetchContent, upsertContentItem,
  type CloudProject, type CloudContentItem,
} from './cloudSync';
import type { Session } from '@supabase/supabase-js';

type Status = 'active' | 'blocked' | 'planned' | 'done';
type Module = 'overview' | 'projects' | 'calendar' | 'content' | 'agent';
type Subtask = { id: string; text: string; done: boolean };
type Project = { id: string; name: string; owner: string; status: Status; priority: 'urgent' | 'normal'; next: string; notes: string; load: number; subtasks: Subtask[] };
type ContentItem = { id: string; title: string; channel: string; state: 'Draft' | 'In review' | 'Approved'; caption: string; planned: string; identity: string };
type CalendarEvent = { id: string; title: string; date: string; time: string; withWhom: string; memo: string };

const now = new Date();
const formatDate = (date: Date) => new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(date).toUpperCase();
const formatMonth = (date: Date) => new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(date);
const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};

const identities = [
  { name: 'Housing Hues', mark: 'H', color: '#c5ed63', instagram: 'https://www.instagram.com/housinghues', facebook: 'https://www.facebook.com/HousingHues' },
  { name: 'ntate.mongale', mark: 'N', color: '#55d8e9', instagram: 'https://www.instagram.com/ntate.mongale', facebook: 'https://www.facebook.com/ntate.mongale' },
  { name: '018 Productions', mark: '0', color: '#ff6b5c', instagram: 'https://www.instagram.com/018productions', facebook: '' },
];
const seedProjects: Project[] = [
  { id: 'p1', name: 'True Organics', owner: 'Housing Hues', status: 'blocked', priority: 'urgent', next: 'Resolve website delay', notes: '', load: 25, subtasks: [{ id: 's1', text: 'Resolve website delay', done: false }, { id: 's2', text: 'Send exit threat response', done: false }] },
  { id: 'p2', name: 'SuperFly · September', owner: 'Housing Hues', status: 'active', priority: 'normal', next: 'Keep artist roster moving', notes: '', load: 30, subtasks: [{ id: 's3', text: 'Confirm artists', done: true }, { id: 's4', text: 'Schedule logistics', done: false }] },
  { id: 'p3', name: 'Indigo Edit v2', owner: 'Housing Hues', status: 'blocked', priority: 'urgent', next: 'Deliver demo', notes: '', load: 15, subtasks: [] },
  { id: 'p4', name: 'D.U.C Tour', owner: 'Housing Hues', status: 'planned', priority: 'normal', next: 'Support collaborations', notes: '', load: 8, subtasks: [] },
];
const seedContent: ContentItem[] = [
  { id: 'c1', title: 'September roster announcement', channel: 'Instagram', state: 'In review', caption: 'The next chapter is taking shape. Meet the September roster.', planned: '05 Sep · 10:00', identity: 'Housing Hues' },
  { id: 'c2', title: 'Housing Hues studio note', channel: 'Instagram', state: 'Draft', caption: 'A quiet look inside the work behind the scenes.', planned: '08 Sep · 14:30', identity: 'Housing Hues' },
];

// --- Local <-> Cloud shape mapping ---
const toCloudProject = (p: Project): CloudProject => ({ id: p.id, name: p.name, identity: p.owner, status: p.status, priority: p.priority, next_action: p.next, notes: p.notes, workload: p.load });
const fromCloudProject = (c: CloudProject): Project => ({ id: c.id, name: c.name, owner: c.identity, status: c.status as Status, priority: c.priority as 'urgent' | 'normal', next: c.next_action, notes: c.notes ?? '', load: c.workload, subtasks: [] });
const toCloudContent = (c: ContentItem): CloudContentItem => ({ id: c.id, title: c.title, channel: c.channel, state: c.state, caption: c.caption, planned: c.planned, identity: c.identity });
const fromCloudContent = (c: CloudContentItem): ContentItem => ({ id: c.id, title: c.title, channel: c.channel, state: c.state as ContentItem['state'], caption: c.caption ?? '', planned: c.planned ?? '', identity: c.identity ?? 'Housing Hues' });

const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } };
const save = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

function App() {
  const [module, setModule] = useState<Module>('overview');
  const [identity, setIdentity] = useState('Housing Hues');
  const [projects, setProjects] = useState<Project[]>(() => read('huestasie-projects', seedProjects));
  const [content, setContent] = useState<ContentItem[]>(() => read('huestasie-content', seedContent));
  const [events, setEvents] = useState<CalendarEvent[]>(() => read('huestasie-events', []));
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => read('huestasie-theme', 'dark'));
  const [agentOpen, setAgentOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<'unavailable' | 'signed-out' | 'syncing' | 'synced' | 'error'>('unavailable');

  useEffect(() => { save('huestasie-projects', projects); }, [projects]);
  useEffect(() => { save('huestasie-content', content); }, [content]);
  useEffect(() => { save('huestasie-events', events); }, [events]);
  useEffect(() => { save('huestasie-theme', theme); document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timer); }, [toast]);

  // Cloud bootstrap: watch auth state, and on sign-in pull remote data (or push
  // local data up once if the cloud tables are still empty), then treat
  // Supabase as the source of truth for subsequent edits.
  useEffect(() => {
    if (!isCloudConfigured()) { setCloudStatus('unavailable'); setAuthReady(true); return; }
    let cancelled = false;
    (async () => {
      const current = await getSession();
      if (!cancelled) { setSession(current); setAuthReady(true); }
      setCloudStatus(current ? 'syncing' : 'signed-out');
      if (current) await syncFromCloud();
    })();
    const unsubscribe = onAuthChange((next) => {
      setSession(next);
      if (next) { setCloudStatus('syncing'); syncFromCloud(); }
      else setCloudStatus('signed-out');
    });
    return () => { cancelled = true; unsubscribe(); };
  }, []);


  async function syncFromCloud() {
    try {
      const [remoteProjects, remoteContent] = await Promise.all([fetchProjects(), fetchContent()]);
      if (remoteProjects.length === 0 && projects.length > 0) {
        await Promise.all(projects.map((p) => upsertProject(toCloudProject(p))));
      } else if (remoteProjects.length > 0) {
        setProjects(remoteProjects.map(fromCloudProject));
      }
      if (remoteContent.length === 0 && content.length > 0) {
        await Promise.all(content.map((c) => upsertContentItem(toCloudContent(c))));
      } else if (remoteContent.length > 0) {
        setContent(remoteContent.map(fromCloudContent));
      }
      setCloudStatus('synced');
    } catch (error) {
      console.warn('[Hue Stasie] Cloud sync failed:', error);
      setCloudStatus('error');
    }
  }

  async function connectCloud() {
    if (!isCloudConfigured()) {
      alert('Cloud sync is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.');
      return;
    }
    if (session) { await signOut(); setToast('Signed out of cloud sync'); return; }
    const email = window.prompt('Enter your Housing Hues email to receive a secure sign-in link:');
    if (!email) return;
    try {
      await signInWithEmail(email);
      setToast('Check your email for the sign-in link');
    } catch (error) {
      alert(`Could not send sign-in link: ${(error as Error).message}`);
    }
  }

  const scopedProjects = useMemo(() => projects.filter((project) => project.owner === identity || identity === 'Housing Hues'), [projects, identity]);
  const stats = useMemo(() => ({ active: scopedProjects.filter((p) => p.status === 'active').length, blocked: scopedProjects.filter((p) => p.status === 'blocked').length, load: scopedProjects.reduce((sum, p) => sum + p.load, 0) }), [scopedProjects]);
  if (!authReady) return <AccessScreen title="Checking your secure workspace…" detail="Verifying your Housing Hues session." />;
  if (isCloudConfigured() && !session) return <LoginScreen />;
  const currentIdentity = identities.find((item) => item.name === identity) || identities[0];

  const addProject = () => {
    const project: Project = { id: crypto.randomUUID(), name: 'New workspace project', owner: identity, status: 'planned', priority: 'normal', next: 'Define the next action', notes: '', load: 0, subtasks: [] };
    setProjects((items) => [project, ...items]); setModule('projects'); setToast('Project added to the workspace');
    if (session) upsertProject(toCloudProject(project));
  };
  const updateProject = (id: string, field: keyof Project, value: string | number) => {
    setProjects((items) => {
      const next = items.map((p) => p.id === id ? { ...p, [field]: value } as Project : p);
      const updated = next.find((p) => p.id === id);
      if (session && updated) upsertProject(toCloudProject(updated));
      return next;
    });
  };
  const approveContent = (id: string) => {
    setContent((items) => {
      const next = items.map((item) => item.id === id ? { ...item, state: 'Approved' as const } : item);
      const updated = next.find((item) => item.id === id);
      if (session && updated) upsertContentItem(toCloudContent(updated));
      return next;
    });
    setToast('Content approved — publishing is still gated');
  };
  const toggleSubtask = (projectId: string, subtaskId: string) => setProjects((items) => items.map((p) => p.id === projectId ? { ...p, subtasks: p.subtasks.map((s) => s.id === subtaskId ? { ...s, done: !s.done } : s) } : p));
  const addSubtask = (projectId: string, text: string) => { if (text.trim()) setProjects((items) => items.map((p) => p.id === projectId ? { ...p, subtasks: [...p.subtasks, { id: crypto.randomUUID(), text: text.trim(), done: false }] } : p)); };
  const removeSubtask = (projectId: string, subtaskId: string) => setProjects((items) => items.map((p) => p.id === projectId ? { ...p, subtasks: p.subtasks.filter((s) => s.id !== subtaskId) } : p));
  const addEvent = (event: Omit<CalendarEvent, 'id'>) => setEvents((items) => [...items, { ...event, id: crypto.randomUUID() }]);
  const deleteEvent = (id: string) => setEvents((items) => items.filter((event) => event.id !== id));
  const exportBackup = () => { const blob = new Blob([JSON.stringify({ projects, content, events, identity, theme }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'huestasie-backup.json'; link.click(); URL.revokeObjectURL(url); };
  const importBackup = (file: File) => { const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(String(reader.result)); if (Array.isArray(data.projects)) setProjects(data.projects.map((p: Project) => ({ ...p, subtasks: p.subtasks ?? [] }))); if (Array.isArray(data.content)) setContent(data.content); if (Array.isArray(data.events)) setEvents(data.events); setToast('Workspace backup restored'); } catch { setToast('Backup file could not be read'); } }; reader.readAsText(file); };

  return <>
    <Analytics />
    <div className="app-shell" data-theme={theme} style={{ '--identity': currentIdentity.color } as React.CSSProperties}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">⌬</div><div><strong>hues<span>tasie</span></strong><small>HOUSING HUES WORKSTATION</small></div></div>
      <div className="workspace-label">PRIVATE OFFICE <span>●</span></div>
      <nav aria-label="Primary navigation">
        {([['overview', 'Overview', '⌂'], ['projects', 'Projects', '▦'], ['calendar', 'Calendar', '◫'], ['content', 'Content studio', '◈']] as [Module, string, string][]).map(([key, label, icon]) => <button key={key} className={module === key ? 'nav-item active' : 'nav-item'} onClick={() => setModule(key)}><i>{icon}</i>{label}{key === 'content' && <em>{content.length}</em>}</button>)}
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setAgentOpen(true)}><i>✦</i>Active agent <span className="live-dot" /></button><button className="nav-item muted" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><i>{theme === 'dark' ? '☼' : '☾'}</i>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><div className="profile"><div className="avatar">HM</div><div><strong>Huesir</strong><small>Owner · all access</small></div><span>•••</span></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><p className="eyebrow">{formatDate(now)}</p><h1>{module === 'overview' ? `${greeting()}, Huesir.` : module === 'content' ? 'Content studio' : module[0].toUpperCase() + module.slice(1)}</h1></div><div className="top-actions"><button className="cloud-btn" onClick={connectCloud} title={cloudStatus === 'unavailable' ? 'Cloud sync not configured' : session ? 'Signed in — click to sign out' : 'Click to sign in and sync'}><i>{cloudStatus === 'synced' ? '☁' : cloudStatus === 'syncing' ? '↻' : cloudStatus === 'error' ? '⚠' : '☁'}</i>{cloudStatus === 'unavailable' ? 'LOCAL ONLY' : cloudStatus === 'signed-out' ? 'SIGN IN TO SYNC' : cloudStatus === 'syncing' ? 'SYNCING…' : cloudStatus === 'error' ? 'CLOUD ERROR' : 'CLOUD READY'}</button><button className="icon-button" aria-label="Notifications">♧<span /></button><button className="agent-button" onClick={() => setAgentOpen(true)}>✦ <span>Ask the agent</span></button><button className="primary-button" onClick={() => setComposerOpen(true)}>＋ Post now</button></div></header>
      <div className="identity-strip"><div className="identity-copy"><span className="identity-mark">{currentIdentity.mark}</span><div><small>ACTIVE IDENTITY</small><strong>{identity}</strong></div></div><div className="identity-switcher">{identities.map((item) => <button key={item.name} title={item.name} onClick={() => setIdentity(item.name)} className={item.name === identity ? 'identity-button selected' : 'identity-button'} style={{ '--id-color': item.color } as React.CSSProperties}>{item.mark}</button>)}</div></div>
      {module === 'overview' && <Overview stats={stats} content={content} projects={scopedProjects} identity={identity} onOpenContent={() => setModule('content')} onAgent={() => setAgentOpen(true)} />}
      {module === 'projects' && <Projects projects={scopedProjects} onAdd={addProject} onUpdate={updateProject} onToggleSubtask={toggleSubtask} onAddSubtask={addSubtask} onRemoveSubtask={removeSubtask} onExport={exportBackup} onImport={importBackup} />}
      {module === 'calendar' && <Calendar events={events} month={calendarMonth} onMonthChange={(delta) => setCalendarMonth((date) => new Date(date.getFullYear(), date.getMonth() + delta, 1))} onAdd={addEvent} onDelete={deleteEvent} />}
      {module === 'content' && <ContentStudio content={content} onApprove={approveContent} onNew={() => setComposerOpen(true)} />}
    </main>
    {agentOpen && <Agent onClose={() => setAgentOpen(false)} onToast={setToast} />}
    {composerOpen && <Composer identity={identity} onClose={() => setComposerOpen(false)} onSave={(item) => { setContent((items) => [item, ...items]); setComposerOpen(false); setModule('content'); setToast('Draft saved to content studio'); if (session) upsertContentItem(toCloudContent(item)); }} />}
    {toast && <div className="toast">✓ {toast}</div>}
  </div>
  </>;
}

function AccessScreen({ title, detail }: { title: string; detail: string }) {
  return <div className="access-screen"><div className="access-card"><div className="brand-symbol">⌬</div><p className="eyebrow">HUESTASIE · PRIVATE OFFICE</p><h1>{title}</h1><p>{detail}</p></div></div>;
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await signInWithEmail(email);
      setMessage('Check your email for the secure sign-in link.');
    } catch (error) {
      setMessage(`Sign-in failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="access-screen"><form className="access-card login-card" onSubmit={submit}><div className="brand-symbol">⌬</div><p className="eyebrow">HUESTASIE · PRIVATE OFFICE</p><h1>Sign in to Housing Hues.</h1><p>Your workstation is private. We will email you a secure, one-time sign-in link.</p><label htmlFor="login-email">Housing Hues email</label><input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@housinghues.co.za" autoComplete="email" required /><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send secure link'}</button>{message && <p className="login-message" role="status">{message}</p>}</form></div>;
}

function Overview({ stats, content, projects, identity, onOpenContent, onAgent }: { stats: { active: number; blocked: number; load: number }; content: ContentItem[]; projects: Project[]; identity: string; onOpenContent: () => void; onAgent: () => void }) { return <>
  <section className="hero-grid"><div className="hero-card"><div className="hero-kicker">WORKSPACE BRIEFING <span>LIVE</span></div><h2>The work is moving.<br /><i>Here’s what needs you.</i></h2><p>{stats.blocked} blocked threads need a decision. Your active workload is sitting at {stats.load}% across {projects.length} tracked projects.</p><button className="text-button" onClick={onAgent}>Open agent briefing <span>↗</span></button></div><div className="signal-card"><div className="card-title">Workspace pulse <span>Today</span></div><div className="ring"><strong>{Math.min(99, stats.load)}</strong><small>LOAD</small></div><div className="signal-legend"><span><b className="dot sage" />{stats.active} active</span><span><b className="dot coral" />{stats.blocked} blocked</span></div></div></section>
  <section className="stat-row"><Stat label="Active projects" value={String(stats.active).padStart(2, '0')} hint="in motion" tone="sage" /><Stat label="Needs attention" value={String(stats.blocked).padStart(2, '0')} hint="blocked threads" tone="coral" /><Stat label="Content queue" value={String(content.length).padStart(2, '0')} hint="drafts & reviews" tone="lavender" /><Stat label="Next milestone" value="05" hint="September" tone="blue" /></section>
  <div className="section-heading"><div><p className="eyebrow">OPERATIONS</p><h2>What’s in motion</h2></div><button className="quiet-button" onClick={() => {}}>View activity ↗</button></div>
  <div className="motion-grid"><div className="panel project-panel"><div className="panel-heading"><strong>Priority projects</strong><button className="quiet-button" onClick={() => {}}>All projects ↗</button></div>{projects.slice(0, 3).map((p) => <ProjectRow key={p.id} project={p} />)}</div><div className="panel"><div className="panel-heading"><strong>Content queue</strong><button className="quiet-button" onClick={onOpenContent}>Open studio ↗</button></div>{content.slice(0, 3).map((item) => <ContentRow key={item.id} item={item} />)}</div></div>
  <SocialHub identity={identity} />
  </>; }
function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) { return <div className={`stat-card ${tone}`}><small>{label}</small><strong>{value}</strong><span>{hint}</span></div>; }
function ProjectRow({ project }: { project: Project }) { return <div className="project-row"><div className="status-mark" data-status={project.status} /><div className="row-main"><strong>{project.name}</strong><small>{project.next}</small></div><span className={`tag ${project.priority}`}>{project.priority === 'urgent' ? 'Urgent' : project.status}</span><span className="row-load">{project.load}%</span></div>; }
function ContentRow({ item }: { item: ContentItem }) { return <div className="content-row"><div className="content-thumb">{item.channel === 'Instagram' ? '◎' : '◈'}</div><div className="row-main"><strong>{item.title}</strong><small>{item.planned} · {item.channel}</small></div><span className={`tag ${item.state.toLowerCase().replace(' ', '-')}`}>{item.state}</span></div>; }
function SocialHub({ identity }: { identity: string }) { const profile = identities.find((item) => item.name === identity) ?? identities[0]; return <section className="social-grid"><div className="panel"><div className="panel-heading"><strong>Instagram</strong><span className="muted-label">{profile.name}</span></div><div className="social-profile"><span className="social-avatar" style={{ background: profile.color }}>{profile.mark}</span><div><strong>@{profile.instagram ? profile.instagram.split('/').filter(Boolean).pop() : profile.name.replace(/\s/g, '')}</strong><small>{profile.name}</small></div>{profile.instagram && <a className="quiet-button" href={profile.instagram} target="_blank" rel="noreferrer">Open ↗</a>}</div></div><div className="panel"><div className="panel-heading"><strong>Facebook</strong><span className="muted-label">{profile.name}</span></div>{profile.facebook ? <iframe className="facebook-frame" title={`${profile.name} Facebook page`} src={`https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(profile.facebook)}&tabs=timeline&width=420&height=260&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=true`} /> : <p className="empty">No Facebook page linked for this identity.</p>}</div></section>; }
function Projects({ projects, onAdd, onUpdate, onToggleSubtask, onAddSubtask, onRemoveSubtask, onExport, onImport }: { projects: Project[]; onAdd: () => void; onUpdate: (id: string, field: keyof Project, value: string | number) => void; onToggleSubtask: (projectId: string, subtaskId: string) => void; onAddSubtask: (projectId: string, text: string) => void; onRemoveSubtask: (projectId: string, subtaskId: string) => void; onExport: () => void; onImport: (file: File) => void }) { const [drafts, setDrafts] = useState<Record<string, string>>({}); const total = projects.reduce((sum, p) => sum + p.load, 0) || 1; return <section className="page-section"><div className="section-heading"><div><p className="eyebrow">OPERATIONS / PROJECTS</p><h2>Project control room</h2></div><div className="section-actions"><button className="quiet-button" onClick={onExport}>↓ Export JSON</button><label className="quiet-button file-button">↑ Import JSON<input type="file" accept="application/json" onChange={(e) => { const file = e.target.files?.[0]; if (file) onImport(file); e.currentTarget.value = ''; }} /></label><button className="primary-button" onClick={onAdd}>＋ New project</button></div></div><div className="workload-panel"><div className="panel workload-chart"><div className="panel-heading"><strong>Workload overview</strong><span className="muted-label">{total === 1 ? 0 : total}% allocated</span></div><div className="workload-ring" style={{ '--ring-progress': `${Math.min(100, total)}%` } as React.CSSProperties}><strong>{Math.min(100, total)}%</strong><small>LOAD</small></div><div className="workload-legend">{projects.slice(0, 5).map((p) => <span key={p.id}><b className="dot" style={{ background: identities.find((i) => i.name === p.owner)?.color }} />{p.name} · {p.load}%</span>)}</div></div><div className="panel workload-table-panel"><div className="panel-heading"><strong>Progress by project</strong></div>{projects.map((p) => { const done = p.subtasks.filter((s) => s.done).length; const pct = p.subtasks.length ? Math.round(done / p.subtasks.length * 100) : 0; return <div className="workload-row" key={p.id}><span>{p.name}</span><i><b style={{ width: `${Math.min(100, p.load)}%` }} /></i><small>{p.load}% · {pct}% done</small></div>; })}</div></div><div className="projects-table">{projects.map((project) => <div className="project-card" key={project.id}><div className="project-card-top"><span className="status-mark" data-status={project.status} /><input value={project.name} onChange={(e) => onUpdate(project.id, 'name', e.target.value)} /><span className={`tag ${project.priority}`}>{project.priority}</span></div><p>{project.next}</p><div className="project-controls"><label>Status<select value={project.status} onChange={(e) => onUpdate(project.id, 'status', e.target.value)}>{['active', 'blocked', 'planned', 'done'].map((s) => <option key={s}>{s}</option>)}</select></label><label>Load <input type="number" min="0" max="100" value={project.load} onChange={(e) => onUpdate(project.id, 'load', Number(e.target.value))} />%</label></div><div className="subtask-block"><small>SUBTASKS</small>{project.subtasks.map((subtask) => <div className={`subtask-row ${subtask.done ? 'done' : ''}`} key={subtask.id}><input type="checkbox" checked={subtask.done} onChange={() => onToggleSubtask(project.id, subtask.id)} /><span>{subtask.text}</span><button className="icon-button" onClick={() => onRemoveSubtask(project.id, subtask.id)} aria-label="Delete subtask">×</button></div>)}<div className="subtask-add"><input value={drafts[project.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [project.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { onAddSubtask(project.id, drafts[project.id] ?? ''); setDrafts({ ...drafts, [project.id]: '' }); } }} placeholder="Add subtask…" /><button className="quiet-button" onClick={() => { onAddSubtask(project.id, drafts[project.id] ?? ''); setDrafts({ ...drafts, [project.id]: '' }); }}>＋</button></div></div></div>)}</div></section>; }
function Calendar({ events, month, onMonthChange, onAdd, onDelete }: { events: CalendarEvent[]; month: Date; onMonthChange: (delta: number) => void; onAdd: (event: Omit<CalendarEvent, 'id'>) => void; onDelete: (id: string) => void }) { const [selected, setSelected] = useState(() => new Date().toISOString().slice(0, 10)); const [draft, setDraft] = useState({ title: '', time: '', withWhom: '', memo: '' }); const year = month.getFullYear(); const monthIndex = month.getMonth(); const days = new Date(year, monthIndex + 1, 0).getDate(); const first = (new Date(year, monthIndex, 1).getDay() + 6) % 7; const dayKey = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; const selectedEvents = events.filter((e) => e.date === selected); return <section className="page-section"><div className="section-heading"><div><p className="eyebrow">OPERATIONS / CALENDAR</p><h2>{formatMonth(month)}</h2></div><div className="calendar-nav"><button className="quiet-button" onClick={() => onMonthChange(-1)}>←</button><button className="quiet-button" onClick={() => onMonthChange(1)}>→</button></div></div><div className="calendar-panel"><div className="calendar-head"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div className="calendar-grid">{Array.from({ length: first + days }, (_, index) => index < first ? <div className="calendar-day empty-day" key={`empty-${index}`} /> : <button className={`calendar-day ${dayKey(index - first + 1) === selected ? 'selected-day' : ''} ${events.some((e) => e.date === dayKey(index - first + 1)) ? 'has-event' : ''}`} key={dayKey(index - first + 1)} onClick={() => setSelected(dayKey(index - first + 1))}><span>{index - first + 1}</span>{events.some((e) => e.date === dayKey(index - first + 1)) && <small>●</small>}</button>)}</div><div className="event-editor"><div className="panel-heading"><strong>Events for {selected}</strong></div>{selectedEvents.map((event) => <div className="event-item" key={event.id}><div><strong>{event.title}</strong><small>{event.time || 'No time'} · {event.withWhom || 'No guest'}</small><p>{event.memo}</p></div><button className="icon-button" onClick={() => onDelete(event.id)} aria-label="Delete event">×</button></div>)}{!selectedEvents.length && <p className="empty">No events on this date.</p>}<div className="event-form"><input placeholder="Event title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /><input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} /><input placeholder="With whom" value={draft.withWhom} onChange={(e) => setDraft({ ...draft, withWhom: e.target.value })} /><textarea placeholder="Memo…" value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} /><button className="primary-button" disabled={!draft.title.trim()} onClick={() => { onAdd({ ...draft, date: selected }); setDraft({ title: '', time: '', withWhom: '', memo: '' }); }}>＋ Add event</button></div></div></div></section>; }
function ContentStudio({ content, onApprove, onNew }: { content: ContentItem[]; onApprove: (id: string) => void; onNew: () => void }) { return <section className="page-section"><div className="section-heading"><div><p className="eyebrow">PUBLISHING / PLANNING</p><h2>Content studio</h2></div><button className="primary-button" onClick={onNew}>＋ New draft</button></div><div className="notice"><span>◈</span><div><strong>Publishing is safely gated.</strong><p>Drafts and approvals are live. External publishing will only be enabled after provider permissions and confirmation controls are configured.</p></div></div><div className="content-list">{content.map((item) => <div className="content-card" key={item.id}><div className="content-card-top"><div className="content-thumb large">◎</div><div><p className="eyebrow">{item.channel} · {item.planned}</p><h3>{item.title}</h3></div><span className={`tag ${item.state.toLowerCase().replace(' ', '-')}`}>{item.state}</span></div><p className="caption">{item.caption}</p><div className="card-actions"><button className="quiet-button">Edit draft</button>{item.state === 'In review' && <button className="text-button" onClick={() => onApprove(item.id)}>Approve for handoff ↗</button>}{item.state === 'Approved' && <span className="approval-note">Ready for handoff · no provider connected</span>}</div></div>)}</div></section>; }
function Agent({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) { const [question, setQuestion] = useState(''); const submit = () => { const prompt = question.trim(); if (!prompt) return; const answer = /block|risk|urgent/i.test(prompt) ? 'The current workspace has two blocked projects marked urgent: True Organics and Indigo Edit v2.' : /content|post|social/i.test(prompt) ? 'The content queue has two items. One is in review and one is a draft; publishing remains approval-gated.' : 'I can summarize projects, blocked work, or the content queue from the records loaded in this browser.'; onToast(answer); setQuestion(''); }; return <div className="agent-backdrop" onClick={onClose}><aside className="agent-drawer" onClick={(e) => e.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">HOUSING HUES AGENT</p><h2>What are we solving?</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="agent-status"><span className="live-dot" /> Context loaded · Housing Hues workspace</div><div className="agent-message"><div className="agent-avatar">✦</div><div><p>Good evening. I found <strong>2 blocked threads</strong> and one content review waiting for attention.</p><p>Would you like a concise briefing, a next-action plan, or help preparing a post?</p></div></div><div className="suggestions"><button onClick={() => onToast('Briefing prepared from current workspace records')}>Give me the briefing</button><button onClick={() => onToast('Next actions prepared for review')}>Find next actions</button><button onClick={() => onToast('Post preparation is available in Content studio')}>Prepare a post</button></div><div className="agent-input"><input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Ask about this workspace…" /><button onClick={submit} aria-label="Ask agent">↗</button></div><p className="agent-footnote">Local briefing mode is active. External actions require your confirmation.</p></aside></div>; }
function Composer({ identity, onClose, onSave }: { identity: string; onClose: () => void; onSave: (item: ContentItem) => void }) { const [caption, setCaption] = useState(''); const [selectedIdentity, setSelectedIdentity] = useState(identity); return <div className="modal-backdrop" onClick={onClose}><div className="composer" onClick={(e) => e.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">CONTENT STUDIO</p><h2>New social draft</h2></div><button className="icon-button" onClick={onClose}>×</button></div><label>Identity<select value={selectedIdentity} onChange={(e) => setSelectedIdentity(e.target.value)}>{identities.map((item) => <option key={item.name}>{item.name}</option>)}</select></label><label>Channel<select><option>Instagram</option><option>Facebook</option><option>TikTok</option></select></label><label>Caption<textarea autoFocus value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption for review…" /></label><p className="agent-footnote">Saving creates a draft only. It will not publish externally.</p><div className="composer-actions"><button className="quiet-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!caption.trim()} onClick={() => onSave({ id: crypto.randomUUID(), title: 'Untitled social draft', channel: 'Instagram', state: 'Draft', caption, planned: 'Unscheduled', identity: selectedIdentity })}>Save draft</button></div></div></div>; }

createRoot(document.getElementById('root')!).render(<App />);
