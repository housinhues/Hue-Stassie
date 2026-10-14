import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import './styles.css';
import {
  isCloudConfigured, getSession, onAuthChange, signInWithEmail, signOut,
  fetchProjects, upsertProject, fetchContent, upsertContentItem, deleteContentItem,
  type CloudProject, type CloudContentItem,
} from './cloudSync';
import type { Session } from '@supabase/supabase-js';

type Status = 'active' | 'blocked' | 'planned' | 'done';
type Module = 'overview' | 'projects' | 'calendar' | 'content' | 'talent' | 'agent';
type Subtask = { id: string; text: string; done: boolean };
type Project = { id: string; name: string; owner: string; status: Status; priority: 'urgent' | 'normal'; next: string; notes: string; load: number; subtasks: Subtask[] };
type ContentState = 'Draft' | 'In review' | 'Changes requested' | 'Approved';
type ContentItem = { id: string; title: string; channel: string; state: ContentState; caption: string; planned: string; identity: string; mediaUrl?: string; plannedAt?: string };
type TalentEntry = { id: string; name: string; instagram: string; note: string };
type TalentBook = { active: string; categories: Record<string, TalentEntry[]> };
type CalendarEvent = { id: string; title: string; date: string; time: string; withWhom: string; memo: string };

const now = new Date();
const formatDate = (date: Date) => new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(date).toUpperCase();
const formatMonth = (date: Date) => new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(date);
const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};

const identities = [
  { name: 'Housing Hues', mark: 'H', color: '#c5ed63', greeting: 'Yessir', emoji: '🫡', role: "I'm Agentic here", instagram: 'https://www.instagram.com/housinghues', facebook: 'https://www.facebook.com/HousingHues' },
  { name: 'ntate.mongale', mark: 'N', color: '#55d8e9', greeting: 'Eya Ntate Mongale', emoji: '🧘🏾', role: 'Personal', instagram: 'https://www.instagram.com/ntate.mongale', facebook: 'https://www.facebook.com/ntate.mongale' },
  { name: 'Clean Totty', mark: 'C', color: '#ff5fa2', greeting: 'Ayy, Fresh', emoji: '🧼', role: 'Keeping it clean', instagram: 'https://www.instagram.com/cleantotty', facebook: '' },
  { name: 'DMNT', mark: 'D', color: '#ffa733', greeting: 'Tapped in sir?', emoji: '🌐', role: 'Internet cafe', instagram: 'https://www.instagram.com/don_mention_it', facebook: '' },
  { name: 'Music Xhefs', mark: 'M', color: '#3ddc97', greeting: 'Waddup Chef', emoji: '🎧', role: 'Music production', instagram: 'https://www.instagram.com/music.xhefs', facebook: '' },
  { name: '018 Productions', mark: '0', color: '#ff6b5c', greeting: 'Fede Whuzet', emoji: '🎬', role: "I'm a creative director here", instagram: 'https://www.instagram.com/018productions', facebook: '' },
];
const seedTalent: TalentBook = {
  active: 'models',
  categories: {
    models: [
      { id: 'tm1', name: 'Amogelang Mogale', instagram: 'https://www.instagram.com/_amogelangmogale', note: '' },
      { id: 'tm2', name: 'Davis (Nhlanhla Nkacha)', instagram: 'https://www.instagram.com/nhlanhla_nkacha', note: 'Editorial | Fittings | Runway | Commercial' },
    ],
  },
};
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
  const [talent, setTalent] = useState<TalentBook>(() => read('huestasie-talent', seedTalent));
  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
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
  useEffect(() => { save('huestasie-talent', talent); }, [talent]);
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
        const local = new Map(content.map((c) => [c.id, c]));
        setContent(remoteContent.map((c) => { const mine = local.get(c.id); return { ...fromCloudContent(c), mediaUrl: mine?.mediaUrl, plannedAt: mine?.plannedAt }; }));
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
  const setContentState = (id: string, state: ContentState) => {
    setContent((items) => {
      const next = items.map((item) => item.id === id ? { ...item, state } : item);
      const updated = next.find((item) => item.id === id);
      if (session && updated) upsertContentItem(toCloudContent(updated));
      return next;
    });
    setToast(state === 'Approved' ? 'Content approved — publishing is still gated' : `Draft moved to “${state}”`);
  };
  const deleteContent = (id: string) => {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    setContent((items) => items.filter((item) => item.id !== id));
    if (session) deleteContentItem(id);
    setToast('Draft deleted');
  };
  const saveContent = (item: ContentItem) => {
    const exists = content.some((c) => c.id === item.id);
    setContent((items) => exists ? items.map((c) => c.id === item.id ? item : c) : [item, ...items]);
    setComposerOpen(false); setEditingItem(null); setModule('content');
    setToast(exists ? 'Draft updated' : 'Draft saved to content studio');
    if (session) upsertContentItem(toCloudContent(item));
  };
  const closeComposer = () => { setComposerOpen(false); setEditingItem(null); };
  const toggleSubtask = (projectId: string, subtaskId: string) => setProjects((items) => items.map((p) => p.id === projectId ? { ...p, subtasks: p.subtasks.map((s) => s.id === subtaskId ? { ...s, done: !s.done } : s) } : p));
  const addSubtask = (projectId: string, text: string) => { if (text.trim()) setProjects((items) => items.map((p) => p.id === projectId ? { ...p, subtasks: [...p.subtasks, { id: crypto.randomUUID(), text: text.trim(), done: false }] } : p)); };
  const removeSubtask = (projectId: string, subtaskId: string) => setProjects((items) => items.map((p) => p.id === projectId ? { ...p, subtasks: p.subtasks.filter((s) => s.id !== subtaskId) } : p));
  const addEvent = (event: Omit<CalendarEvent, 'id'>) => setEvents((items) => [...items, { ...event, id: crypto.randomUUID() }]);
  const deleteEvent = (id: string) => setEvents((items) => items.filter((event) => event.id !== id));
  const exportBackup = () => { const blob = new Blob([JSON.stringify({ projects, content, events, talent, identity, theme }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'huestasie-backup.json'; link.click(); URL.revokeObjectURL(url); };
  const importBackup = (file: File) => { const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(String(reader.result)); if (Array.isArray(data.projects)) setProjects(data.projects.map((p: Project) => ({ ...p, subtasks: p.subtasks ?? [] }))); if (Array.isArray(data.content)) setContent(data.content); if (Array.isArray(data.events)) setEvents(data.events); if (data.talent && data.talent.categories) setTalent(data.talent); setToast('Workspace backup restored'); } catch { setToast('Backup file could not be read'); } }; reader.readAsText(file); };

  return <>
    <Analytics />
    <div className="app-shell" data-theme={theme} style={{ '--identity': currentIdentity.color } as React.CSSProperties}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">⌬</div><div><strong>hues<span>tasie</span></strong><small>HOUSING HUES WORKSTATION</small></div></div>
      <div className="workspace-label">PRIVATE OFFICE <span>●</span></div>
      <nav aria-label="Primary navigation">
        {([['overview', 'Overview', '⌂'], ['projects', 'Projects', '▦'], ['calendar', 'Calendar', '◫'], ['content', 'Content studio', '◈'], ['talent', 'Talent', '◐']] as [Module, string, string][]).map(([key, label, icon]) => <button key={key} className={module === key ? 'nav-item active' : 'nav-item'} onClick={() => setModule(key)}><i>{icon}</i>{label}{key === 'content' && <em>{content.length}</em>}</button>)}
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setAgentOpen(true)}><i>✦</i>Active agent <span className="live-dot" /></button><button className="nav-item muted" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><i>{theme === 'dark' ? '☼' : '☾'}</i>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><div className="profile"><div className="avatar">HM</div><div><strong>Huesir</strong><small>Owner · all access</small></div><span>•••</span></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><p className="eyebrow">{formatDate(now)}</p><h1>{module === 'overview' ? `${greeting()}, Huesir.` : module === 'content' ? 'Content studio' : module[0].toUpperCase() + module.slice(1)}</h1></div><div className="top-actions"><button className="cloud-btn" onClick={connectCloud} title={cloudStatus === 'unavailable' ? 'Cloud sync not configured' : session ? 'Signed in — click to sign out' : 'Click to sign in and sync'}><i>{cloudStatus === 'synced' ? '☁' : cloudStatus === 'syncing' ? '↻' : cloudStatus === 'error' ? '⚠' : '☁'}</i>{cloudStatus === 'unavailable' ? 'LOCAL ONLY' : cloudStatus === 'signed-out' ? 'SIGN IN TO SYNC' : cloudStatus === 'syncing' ? 'SYNCING…' : cloudStatus === 'error' ? 'CLOUD ERROR' : 'CLOUD READY'}</button><button className="icon-button" aria-label="Notifications">♧<span /></button><button className="agent-button" onClick={() => setAgentOpen(true)}>✦ <span>Ask the agent</span></button><button className="primary-button" onClick={() => { setEditingItem(null); setComposerOpen(true); }}>＋ Post now</button></div></header>
      <div className="identity-strip"><div className="identity-copy"><span className="identity-mark">{currentIdentity.mark}</span><div><small>ACTIVE IDENTITY</small><strong>{identity}</strong><p className="identity-greeting">{currentIdentity.emoji} {currentIdentity.greeting} · {currentIdentity.role}</p></div></div><div className="identity-switcher">{identities.map((item) => <button key={item.name} title={item.name} onClick={() => setIdentity(item.name)} className={item.name === identity ? 'identity-button selected' : 'identity-button'} style={{ '--id-color': item.color } as React.CSSProperties}>{item.mark}</button>)}</div></div>
      {module === 'overview' && <Overview stats={stats} content={content} projects={scopedProjects} identity={identity} onOpenContent={() => setModule('content')} onAgent={() => setAgentOpen(true)} />}
      {module === 'projects' && <Projects projects={scopedProjects} onAdd={addProject} onUpdate={updateProject} onToggleSubtask={toggleSubtask} onAddSubtask={addSubtask} onRemoveSubtask={removeSubtask} onExport={exportBackup} onImport={importBackup} />}
      {module === 'calendar' && <Calendar events={events} month={calendarMonth} onMonthChange={(delta) => setCalendarMonth((date) => new Date(date.getFullYear(), date.getMonth() + delta, 1))} onAdd={addEvent} onDelete={deleteEvent} />}
      {module === 'content' && <ContentStudio content={content} onStatus={setContentState} onEdit={(item) => { setEditingItem(item); setComposerOpen(true); }} onDelete={deleteContent} onNew={() => { setEditingItem(null); setComposerOpen(true); }} />}
      {module === 'talent' && <Talent book={talent} onChange={setTalent} />}
    </main>
    {agentOpen && <Agent onClose={() => setAgentOpen(false)} onToast={setToast} />}
    {composerOpen && <Composer key={editingItem?.id ?? 'new'} identity={identity} initial={editingItem} onClose={closeComposer} onSave={saveContent} />}
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
function ContentStudio({ content, onStatus, onEdit, onDelete, onNew }: { content: ContentItem[]; onStatus: (id: string, state: ContentState) => void; onEdit: (item: ContentItem) => void; onDelete: (id: string) => void; onNew: () => void }) { return <section className="page-section"><div className="section-heading"><div><p className="eyebrow">PUBLISHING / PLANNING</p><h2>Content studio</h2></div><button className="primary-button" onClick={onNew}>＋ New draft</button></div><div className="notice"><span>◈</span><div><strong>Publishing is safely gated.</strong><p>Drafts and approvals are live. External publishing will only be enabled after provider permissions and confirmation controls are configured.</p></div></div><div className="content-list">{content.map((item) => <div className="content-card" key={item.id}><div className="content-card-top"><div className="content-thumb large">◎</div><div><p className="eyebrow">{item.channel} · {item.planned} · {item.identity}</p><h3>{item.title}</h3></div><span className={`tag ${item.state.toLowerCase().replace(/ /g, '-')}`}>{item.state}</span></div><p className="caption">{item.caption}</p>{item.mediaUrl && <p className="caption"><a href={item.mediaUrl} target="_blank" rel="noreferrer">Media link ↗</a></p>}<div className="card-actions"><button className="quiet-button" onClick={() => onEdit(item)}>Edit draft</button>{item.state === 'Draft' && <button className="text-button" onClick={() => onStatus(item.id, 'In review')}>Send for review ↗</button>}{item.state === 'In review' && <><button className="text-button" onClick={() => onStatus(item.id, 'Approved')}>Approve for handoff ↗</button><button className="quiet-button" onClick={() => onStatus(item.id, 'Changes requested')}>Request changes</button></>}{item.state === 'Changes requested' && <button className="text-button" onClick={() => onStatus(item.id, 'In review')}>Resubmit for review ↗</button>}{item.state === 'Approved' && <><span className="approval-note">Ready for handoff · no provider connected</span><button className="quiet-button" onClick={() => onStatus(item.id, 'Draft')}>Back to draft</button></>}<button className="quiet-button danger-button" onClick={() => onDelete(item.id)}>Delete</button></div></div>)}{!content.length && <p className="empty">No drafts yet. Create one with “New draft”.</p>}</div></section>; }
function Talent({ book, onChange }: { book: TalentBook; onChange: (next: TalentBook) => void }) {
  const [draft, setDraft] = useState({ name: '', instagram: '', note: '' });
  const [newCategory, setNewCategory] = useState('');
  const cats = Object.keys(book.categories);
  const active = book.categories[book.active] ? book.active : cats[0];
  const list = (active && book.categories[active]) || [];
  const setList = (next: TalentEntry[]) => onChange({ ...book, active, categories: { ...book.categories, [active]: next } });
  const addEntry = () => { if (!draft.name.trim() || !active) return; setList([...list, { id: crypto.randomUUID(), name: draft.name.trim(), instagram: draft.instagram.trim(), note: draft.note.trim() }]); setDraft({ name: '', instagram: '', note: '' }); };
  const addCategory = () => { const key = newCategory.trim().toLowerCase(); if (!key || book.categories[key]) return; onChange({ active: key, categories: { ...book.categories, [key]: [] } }); setNewCategory(''); };
  return <section className="page-section"><div className="section-heading"><div><p className="eyebrow">MANAGEMENT / TALENT</p><h2>Talent roster</h2></div></div><div className="talent-tabs">{cats.map((c) => <button key={c} className={c === active ? 'quiet-button selected-tab' : 'quiet-button'} onClick={() => onChange({ ...book, active: c })}>{c.charAt(0).toUpperCase() + c.slice(1)}</button>)}<span className="talent-new-cat"><input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} placeholder="New category…" /><button className="quiet-button" onClick={addCategory} aria-label="Add category">＋</button></span></div><div className="talent-grid">{list.map((t) => <div className="panel talent-card" key={t.id}><div className="social-profile"><span className="social-avatar" style={{ background: 'var(--identity)' }}>{t.name.charAt(0)}</span><div><strong>{t.name}</strong><small>{t.note || 'No notes yet'}</small></div>{t.instagram && <a className="quiet-button" href={t.instagram} target="_blank" rel="noreferrer">Instagram ↗</a>}<button className="icon-button" onClick={() => { if (window.confirm(`Remove ${t.name} from the roster?`)) setList(list.filter((x) => x.id !== t.id)); }} aria-label={`Remove ${t.name}`}>×</button></div></div>)}{!list.length && <p className="empty">No entries yet.</p>}</div><div className="panel talent-form"><div className="panel-heading"><strong>Add to {active ?? 'roster'}</strong></div><div className="event-form"><input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><input placeholder="Instagram URL" value={draft.instagram} onChange={(e) => setDraft({ ...draft, instagram: e.target.value })} /><input placeholder="Notes (e.g. Editorial | Runway)" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /><button className="primary-button" disabled={!draft.name.trim() || !active} onClick={addEntry}>＋ Add talent</button></div></div></section>;
}
function Agent({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) { const [question, setQuestion] = useState(''); const submit = () => { const prompt = question.trim(); if (!prompt) return; const answer = /block|risk|urgent/i.test(prompt) ? 'The current workspace has two blocked projects marked urgent: True Organics and Indigo Edit v2.' : /content|post|social/i.test(prompt) ? 'The content queue has two items. One is in review and one is a draft; publishing remains approval-gated.' : 'I can summarize projects, blocked work, or the content queue from the records loaded in this browser.'; onToast(answer); setQuestion(''); }; return <div className="agent-backdrop" onClick={onClose}><aside className="agent-drawer" onClick={(e) => e.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">HOUSING HUES AGENT</p><h2>What are we solving?</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="agent-status"><span className="live-dot" /> Context loaded · Housing Hues workspace</div><div className="agent-message"><div className="agent-avatar">✦</div><div><p>Good evening. I found <strong>2 blocked threads</strong> and one content review waiting for attention.</p><p>Would you like a concise briefing, a next-action plan, or help preparing a post?</p></div></div><div className="suggestions"><button onClick={() => onToast('Briefing prepared from current workspace records')}>Give me the briefing</button><button onClick={() => onToast('Next actions prepared for review')}>Find next actions</button><button onClick={() => onToast('Post preparation is available in Content studio')}>Prepare a post</button></div><div className="agent-input"><input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Ask about this workspace…" /><button onClick={submit} aria-label="Ask agent">↗</button></div><p className="agent-footnote">Local briefing mode is active. External actions require your confirmation.</p></aside></div>; }
function Composer({ identity, initial, onClose, onSave }: { identity: string; initial: ContentItem | null; onClose: () => void; onSave: (item: ContentItem) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [selectedIdentity, setSelectedIdentity] = useState(initial?.identity ?? identity);
  const [channel, setChannel] = useState(initial?.channel ?? 'Instagram');
  const [plannedAt, setPlannedAt] = useState(initial?.plannedAt ?? '');
  const [mediaUrl, setMediaUrl] = useState(initial?.mediaUrl ?? '');
  const formatPlanned = (value: string) => { if (!value) return 'Unscheduled'; const d = new Date(value); if (Number.isNaN(d.getTime())) return 'Unscheduled'; return `${new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short' }).format(d)} · ${new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)}`; };
  const submit = () => onSave({ id: initial?.id ?? crypto.randomUUID(), title: title.trim() || 'Untitled social draft', channel, state: initial?.state ?? 'Draft', caption, planned: plannedAt ? formatPlanned(plannedAt) : (initial && !initial.plannedAt ? initial.planned : 'Unscheduled'), plannedAt: plannedAt || undefined, mediaUrl: mediaUrl.trim() || undefined, identity: selectedIdentity });
  return <div className="modal-backdrop" onClick={onClose}><div className="composer" onClick={(e) => e.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">CONTENT STUDIO</p><h2>{initial ? 'Edit social draft' : 'New social draft'}</h2></div><button className="icon-button" onClick={onClose}>×</button></div><label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled social draft" /></label><label>Identity<select value={selectedIdentity} onChange={(e) => setSelectedIdentity(e.target.value)}>{identities.map((item) => <option key={item.name}>{item.name}</option>)}</select></label><label>Channel<select value={channel} onChange={(e) => setChannel(e.target.value)}><option>Instagram</option><option>Facebook</option><option>TikTok</option></select></label><label>Planned for<input type="datetime-local" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} /></label><label>Media URL<input type="url" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://…" /></label><label>Caption<textarea autoFocus value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption for review…" /></label><p className="agent-footnote">Saving keeps this as a draft. It will not publish externally.{initial ? '' : ''}</p><div className="composer-actions"><button className="quiet-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!caption.trim()} onClick={submit}>{initial ? 'Save changes' : 'Save draft'}</button></div></div></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
