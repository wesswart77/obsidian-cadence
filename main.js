/* ============================================================
   Cadence — Obsidian app
   Single unified view with internal tab nav (Today / Planner / ...).
   Source-of-truth = your daily-note markdown files.
   Plain JS (no build step). Loaded directly by Obsidian.
   ============================================================ */
'use strict';

const obsidian = require('obsidian');

const VIEW_TYPE_CADENCE_APP = 'cadence-app';

/* ─────────── Nav structure ─────────── */
/* Mirrors the Cadence web-app left nav exactly. Groups can be collapsed.
   Built surfaces have a render method; the rest fall through to the
   coming-soon placeholder, which describes what each surface will do. */
const NAV_GROUPS = [
  {
    id: 'home_group', label: '',
    items: [
      { id: 'home', label: 'Home', icon: 'home', desc: 'Command centre — today, projects, pipeline and upcoming, all on one screen.' },
    ],
  },
  {
    id: 'planner', label: 'Planner', module: 'planner',
    items: [
      { id: 'planner.inbox',    label: 'Inbox',    icon: 'inbox',         module: 'planner', desc: 'Universal capture + reminders. Anything you toss in here surfaces at the right time.' },
      { id: 'planner.today',    label: 'Today',    icon: 'sun',           module: 'planner', desc: 'Diary view of today\'s daily note.' },
      { id: 'planner.calendar', label: 'Calendar', icon: 'calendar-days', module: 'planner', desc: 'Week view across daily notes.' },
      { id: 'planner.projects', label: 'Projects', icon: 'folder-kanban', module: 'planner', desc: 'Active projects with milestones, owners, statuses — kanban over project notes.' },
    ],
  },
  {
    id: 'crm', label: 'CRM', module: 'crm',
    items: [
      { id: 'crm.dashboard',  label: 'Dashboard',  icon: 'layout-grid',     module: 'crm', desc: 'Overview cards — today\'s tasks, deal momentum, recent contacts, week stats.' },
      { id: 'crm.pipeline',   label: 'Pipeline',   icon: 'trending-up',     module: 'crm', desc: 'Sales pipeline. Deals as markdown notes with stage, value and contact frontmatter.' },
      { id: 'crm.contacts',   label: 'Contacts',   icon: 'users',           module: 'crm', desc: 'People as markdown notes — name, email, company, last-talked-to cadence, tags.' },
      { id: 'crm.companies',  label: 'Companies',  icon: 'building-2',      module: 'crm', desc: 'Companies as markdown notes — domain, size, industry, related contacts and deals.' },
      { id: 'crm.activities', label: 'Activities', icon: 'calendar',        module: 'crm', desc: 'Cross-cutting activity timeline — calls, meetings, notes against any contact or deal.' },
    ],
  },
  {
    id: 'prm', label: 'PRM', module: 'prm',
    items: [
      { id: 'prm.partners',       label: 'Partners',       icon: 'handshake',        module: 'prm', desc: 'Partner organisations — relationship status, named contacts, joint pipeline.' },
      { id: 'prm.registrations',  label: 'Registrations',  icon: 'clipboard-check',  module: 'prm', desc: 'Deal registrations submitted by partners — status, expiry, attached deals.' },
      { id: 'prm.commissions',    label: 'Commissions',    icon: 'wallet',           module: 'prm', desc: 'Commission ledger across partners — earned, pending, paid, by quarter.' },
      { id: 'prm.leads',          label: 'Leads',          icon: 'target',           module: 'prm', desc: 'Lead distribution — round-robin/queue assignment to partners or reps.' },
      { id: 'prm.certifications', label: 'Certifications', icon: 'award',            module: 'prm', desc: 'Partner certifications — track expiries, renewals, training completion.' },
      { id: 'prm.analytics',      label: 'Analytics',      icon: 'bar-chart-3',      module: 'prm', desc: 'PRM analytics — partner-sourced revenue, top performers, lifecycle funnel.' },
    ],
  },
  {
    id: 'workflow', label: 'Workflow',
    items: [
      { id: 'workflow.sequences', label: 'Sequences', icon: 'zap', desc: 'Multi-step outreach sequences — templates, cadence steps, who\'s in which step.' },
    ],
  },
  {
    id: 'reports', label: 'Reports',
    items: [
      { id: 'reports.pipeline',     label: 'Pipeline',     icon: 'trending-up', module: 'crm', desc: 'Pipeline coverage and weighted forecast — by stage, owner, source.' },
      { id: 'reports.sales',        label: 'Sales',        icon: 'bar-chart-3', module: 'crm', desc: 'Closed won / lost trends — quota attainment, win rate, average cycle.' },
      { id: 'reports.partners',     label: 'Partners',     icon: 'handshake',   module: 'prm', desc: 'Partner contribution — sourced vs influenced revenue, top tiers.' },
      { id: 'reports.activity',     label: 'Activity',     icon: 'pie-chart',   module: 'crm', desc: 'Activity mix — calls, meetings, emails by rep and account.' },
      { id: 'reports.productivity', label: 'Productivity', icon: 'sun',         desc: 'Personal productivity — completion rate, streaks, focus blocks, journal volume.' },
    ],
  },
  {
    id: 'misc', label: '',
    items: [
      { id: 'team',     label: 'Team',     icon: 'user-cog',   desc: 'Team members, roles, seats — admin view of your Cadence workspace.' },
      { id: 'settings', label: 'Settings', icon: 'settings-2', desc: 'Cadence app settings — folders, headings, week start, API connection.' },
    ],
  },
];

// Convenience flat lookup
const ALL_SURFACES = NAV_GROUPS.flatMap((g) => g.items);
const SURFACE_BY_ID = Object.fromEntries(ALL_SURFACES.map((s) => [s.id, s]));

/* ─────────── Entity registry ───────────
   Each entity = a folder of markdown notes with a known frontmatter shape.
   The generic renderEntityList renders any of them; specialised views
   (Pipeline kanban, Dashboard, Reports) compose on top of the same data. */
const ENTITIES = {
  contact: {
    folder: 'Cadence/Contacts',
    label: 'Contact', plural: 'Contacts',
    fields: [
      { key: 'name',        label: 'Name',         primary: true },
      { key: 'email',       label: 'Email',        type: 'email' },
      { key: 'company',     label: 'Company' },
      { key: 'role',        label: 'Role' },
      { key: 'lastContact', label: 'Last contact', type: 'date' },
      { key: 'tags',        label: 'Tags',         type: 'tags' },
    ],
    columns: ['name', 'company', 'email', 'role', 'lastContact'],
  },
  company: {
    folder: 'Cadence/Companies',
    label: 'Company', plural: 'Companies',
    fields: [
      { key: 'name',     label: 'Name',     primary: true },
      { key: 'domain',   label: 'Domain' },
      { key: 'industry', label: 'Industry' },
      { key: 'size',     label: 'Size' },
      { key: 'owner',    label: 'Owner' },
      { key: 'tags',     label: 'Tags',     type: 'tags' },
    ],
    columns: ['name', 'domain', 'industry', 'size', 'owner'],
  },
  partner: {
    folder: 'Cadence/Partners',
    label: 'Partner', plural: 'Partners',
    fields: [
      { key: 'name',   label: 'Name',   primary: true },
      { key: 'tier',   label: 'Tier',   type: 'enum', options: ['Gold', 'Silver', 'Bronze', 'Standard'] },
      { key: 'status', label: 'Status', type: 'enum', options: ['Active', 'Onboarding', 'Inactive', 'Churned'] },
      { key: 'owner',  label: 'Owner' },
      { key: 'region', label: 'Region' },
    ],
    columns: ['name', 'tier', 'status', 'region', 'owner'],
  },
  registration: {
    folder: 'Cadence/Registrations',
    label: 'Registration', plural: 'Registrations',
    fields: [
      { key: 'title',     label: 'Title',      primary: true },
      { key: 'partner',   label: 'Partner' },
      { key: 'status',    label: 'Status',     type: 'enum', options: ['Submitted', 'Approved', 'Rejected', 'Expired'] },
      { key: 'value',     label: 'Value',      type: 'currency' },
      { key: 'submitted', label: 'Submitted',  type: 'date' },
      { key: 'expires',   label: 'Expires',    type: 'date' },
    ],
    columns: ['title', 'partner', 'status', 'value', 'expires'],
  },
  commission: {
    folder: 'Cadence/Commissions',
    label: 'Commission', plural: 'Commissions',
    fields: [
      { key: 'reference', label: 'Ref',     primary: true },
      { key: 'partner',   label: 'Partner' },
      { key: 'amount',    label: 'Amount',  type: 'currency' },
      { key: 'status',    label: 'Status',  type: 'enum', options: ['Pending', 'Earned', 'Paid', 'Disputed'] },
      { key: 'period',    label: 'Period' },
      { key: 'paidOn',    label: 'Paid on', type: 'date' },
    ],
    columns: ['reference', 'partner', 'amount', 'status', 'period', 'paidOn'],
  },
  lead: {
    folder: 'Cadence/Leads',
    label: 'Lead', plural: 'Leads',
    fields: [
      { key: 'name',     label: 'Name',     primary: true },
      { key: 'company',  label: 'Company' },
      { key: 'source',   label: 'Source' },
      { key: 'status',   label: 'Status',   type: 'enum', options: ['New', 'Contacted', 'Qualified', 'Disqualified', 'Converted'] },
      { key: 'assigned', label: 'Assigned' },
    ],
    columns: ['name', 'company', 'source', 'status', 'assigned'],
  },
  certification: {
    folder: 'Cadence/Certifications',
    label: 'Certification', plural: 'Certifications',
    fields: [
      { key: 'name',    label: 'Name',    primary: true },
      { key: 'partner', label: 'Partner' },
      { key: 'level',   label: 'Level' },
      { key: 'issued',  label: 'Issued',  type: 'date' },
      { key: 'expires', label: 'Expires', type: 'date' },
    ],
    columns: ['name', 'partner', 'level', 'issued', 'expires'],
  },
  activity: {
    folder: 'Cadence/Activities',
    label: 'Activity', plural: 'Activities',
    fields: [
      { key: 'subject', label: 'Subject', primary: true },
      { key: 'type',    label: 'Type',    type: 'enum', options: ['Call', 'Email', 'Meeting', 'Note', 'Task'] },
      { key: 'when',    label: 'When',    type: 'date' },
      { key: 'with',    label: 'With' },
      { key: 'related', label: 'Related' },
    ],
    columns: ['when', 'type', 'subject', 'with', 'related'],
  },
  sequence: {
    folder: 'Cadence/Sequences',
    label: 'Sequence', plural: 'Sequences',
    fields: [
      { key: 'name',     label: 'Name',     primary: true },
      { key: 'audience', label: 'Audience' },
      { key: 'steps',    label: 'Steps',    type: 'number' },
      { key: 'active',   label: 'Active',   type: 'number' },
      { key: 'status',   label: 'Status',   type: 'enum', options: ['Draft', 'Active', 'Paused', 'Archived'] },
    ],
    columns: ['name', 'audience', 'steps', 'active', 'status'],
  },
  project: {
    folder: 'Cadence/Projects',
    label: 'Project', plural: 'Projects',
    fields: [
      { key: 'name',     label: 'Name',     primary: true },
      { key: 'status',   label: 'Status',   type: 'enum', options: ['active', 'on_hold', 'backlog', 'done', 'cancelled'] },
      { key: 'priority', label: 'Priority', type: 'enum', options: ['low', 'medium', 'high'] },
      { key: 'owner',    label: 'Owner' },
      { key: 'started',  label: 'Started',  type: 'date' },
      { key: 'due',      label: 'Due',      type: 'date' },
      { key: 'tags',     label: 'Tags',     type: 'tags' },
    ],
    columns: ['name', 'status', 'owner', 'due'],
  },
  deal: {
    folder: 'Cadence/Pipeline',
    label: 'Deal', plural: 'Deals',
    fields: [
      { key: 'title',   label: 'Title',   primary: true },
      { key: 'stage',   label: 'Stage',   type: 'enum', options: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] },
      { key: 'value',   label: 'Value',   type: 'currency' },
      { key: 'company', label: 'Company' },
      { key: 'contact', label: 'Contact' },
      { key: 'owner',   label: 'Owner' },
      { key: 'closeBy', label: 'Close by', type: 'date' },
    ],
    columns: ['title', 'stage', 'value', 'company', 'closeBy'],
  },
};

const DEAL_STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

/* Resolve which entity an arbitrary file belongs to, by frontmatter `type`
   first, then path-prefix fallback. Returns null if not a Cadence entity. */
function entityKeyFromFile(app, file) {
  if (!file) return null;
  const cache = app.metadataCache.getFileCache(file);
  const t = cache && cache.frontmatter && cache.frontmatter.type;
  if (t && ENTITIES[t]) return t;
  for (const [key, def] of Object.entries(ENTITIES)) {
    if (file.path.startsWith(def.folder + '/')) return key;
  }
  return null;
}

const BUILT_SURFACES = new Set([
  'home',
  'planner.inbox', 'planner.today', 'planner.calendar', 'planner.projects',
  'crm.dashboard', 'crm.pipeline', 'crm.contacts', 'crm.companies', 'crm.activities',
  'prm.partners', 'prm.registrations', 'prm.commissions', 'prm.leads', 'prm.certifications', 'prm.analytics',
  'workflow.sequences',
  'reports.pipeline', 'reports.sales', 'reports.partners', 'reports.activity', 'reports.productivity',
  'team', 'settings',
]);

/* ─────────── Settings ─────────── */
const DEFAULT_SETTINGS = {
  dailyNoteFolder: 'daily',
  dailyNoteFormat: 'YYYY-MM-DD',
  journalHeading: '## Journal',
  tasksHeading: '## Today',
  weekStartsOn: 1, // 0 = Sunday, 1 = Monday
  defaultTab: 'home',
  openOnStartup: false,
  collapsedGroups: {}, // { [groupId]: true }
  currency: 'USD',
  modules: { crm: true, prm: true, planner: true },
  desktopNotifications: false,
  reminders: [], // [{ id, text, when (ISO|null), repeat ('none'|'daily'|'weekly'), notified, done, createdAt }]
  cadenceApiUrl: '',
  cadenceApiToken: '',
};

/* Module-level — kept in sync by the plugin so the standalone fmtValue helper
   can format currency without each caller threading settings through. */
let CURRENT_CURRENCY = 'USD';

const CURRENCY_OPTIONS = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'ZAR', label: 'ZAR — South African Rand' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'INR', label: 'INR — Indian Rupee' },
  { code: 'BRL', label: 'BRL — Brazilian Real' },
  { code: 'AED', label: 'AED — UAE Dirham' },
];

/* ─────────── Helpers ─────────── */
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dailyNotePath(settings, date = new Date()) {
  const folder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  const name = ymd(date);
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function dateInfo(d = new Date()) {
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
    day: d.getDate(),
    month: d.toLocaleDateString(undefined, { month: 'long' }),
    year: d.getFullYear(),
  };
}
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d, weekStartsOn = 1) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStartsOn + 7) % 7;
  return addDays(x, -diff);
}
function weekDates(anchor, weekStartsOn = 1) {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

/* Map a 0-100 % to a colour band — drives progress bar tint. */
function pctBand(pct) {
  if (pct < 25) return 'rose';
  if (pct < 50) return 'warn';
  if (pct < 75) return 'mint';
  return 'emerald';
}

/* ─────────── Entity helpers ─────────── */
function ensureFolderSync(app, path) {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  const promises = [];
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) {
      promises.push(app.vault.createFolder(cur).catch(() => {}));
    }
  }
  return Promise.all(promises);
}

function listEntityFiles(app, entityKey) {
  const def = ENTITIES[entityKey];
  if (!def) return [];
  const folder = def.folder;
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + '/'));
}

function readEntity(app, file) {
  const cache = app.metadataCache.getFileCache(file) || {};
  const fm = cache.frontmatter || {};
  return { file, frontmatter: fm, basename: file.basename };
}

function listEntities(app, entityKey) {
  return listEntityFiles(app, entityKey).map((f) => readEntity(app, f));
}

function entityValue(entity, key, def) {
  const fm = entity.frontmatter || {};
  if (fm[key] != null && fm[key] !== '') return fm[key];
  // Fallback: 'name' / 'title' / 'subject' default to file basename
  if (def && def.fields[0] && def.fields[0].key === key) return entity.basename;
  return '';
}

function fmtValue(val, type) {
  if (val == null || val === '') return '';
  if (type === 'tags' && Array.isArray(val)) return val.map((t) => `#${t}`).join(' ');
  if (type === 'date') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return String(val);
  }
  if (type === 'currency') {
    const n = Number(val);
    if (!isNaN(n)) {
      try {
        return n.toLocaleString(undefined, { style: 'currency', currency: CURRENT_CURRENCY, maximumFractionDigits: 0 });
      } catch (_) {
        return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      }
    }
    return String(val);
  }
  if (type === 'number') return String(val);
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

function entityTemplate(entityKey, name) {
  if (entityKey === 'project') return projectTemplate(name);

  const def = ENTITIES[entityKey];
  const lines = ['---'];
  // Only write the meta `type: <entityKey>` tag if the entity doesn't already
  // define a `type` field of its own (e.g. Activity has type=Call/Email/...).
  // Otherwise we'd emit duplicate YAML keys and the file fails to parse.
  const hasTypeField = def.fields.some((f) => f.key === 'type');
  if (!hasTypeField) lines.push(`type: ${entityKey}`);

  def.fields.forEach((f) => {
    if (f.key === def.fields[0].key) lines.push(`${f.key}: ${name}`);
    else if (f.type === 'tags') lines.push(`${f.key}: []`);
    else if (f.type === 'number' || f.type === 'currency') lines.push(`${f.key}: 0`);
    else lines.push(`${f.key}:`);
  });
  // Pipeline default stage
  if (entityKey === 'deal') {
    const idx = lines.findIndex((l) => l.startsWith('stage:'));
    if (idx >= 0) lines[idx] = 'stage: Lead';
  }
  lines.push('---', '', `# ${name}`, '', '');
  return lines.join('\n');
}

function projectTemplate(name) {
  const today = ymd(new Date());
  return [
    '---',
    'type: project',
    `name: ${name}`,
    'status: active',
    'priority: medium',
    'owner:',
    `started: ${today}`,
    'due:',
    'tags: []',
    'related_deals: []',
    'related_partners: []',
    '---',
    '',
    `# ${name}`,
    '',
    '## Brief',
    '_The outcome we want, why now._',
    '',
    '',
    '## Scope',
    '**In scope:**',
    '- ',
    '',
    '**Out of scope:**',
    '- ',
    '',
    '## Milestones',
    `- [ ] ${today} — First milestone`,
    '',
    '## Tasks',
    '- [ ] ',
    '',
    '## Risks',
    '- ',
    '',
    '## Stakeholders',
    '- ',
    '',
    '## Notes',
    '',
    '',
  ].join('\n');
}

/* Parse the H2 sections of a markdown file into a map. */
function parseH2Sections(content) {
  const lines = content.split('\n');
  const sections = {};
  let cur = null, buf = [];
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (cur) sections[cur] = buf.join('\n');
      cur = line.replace(/^##\s+/, '').trim();
      buf = [];
    } else if (cur) {
      buf.push(line);
    }
  }
  if (cur) sections[cur] = buf.join('\n');
  return sections;
}

/* Parse milestone lines: `- [x] 2026-05-15 — Title`
   Indented (1-tab or 1-4 spaces) non-empty lines that follow a milestone are
   treated as that milestone's free-form notes.
   Returns array of { done, date (Date|null), title, notes }. */
function parseMilestones(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const items = [];
  let current = null;
  for (const line of lines) {
    if (/^\s*-\s\[(x|X| )\]\s/.test(line)) {
      if (current) items.push(current);
      const done = / \[(x|X)\] /.test(line);
      const rest = line.replace(/^\s*-\s\[(x|X| )\]\s/, '');
      const m = rest.match(/^(\d{4}-\d{2}-\d{2})\s*(?:[—–-]\s*)?(.+)?$/);
      const date = m && m[1] ? new Date(m[1]) : null;
      const title = m ? (m[2] || '').trim() : rest.trim();
      current = {
        done,
        date: (date && !isNaN(date.getTime())) ? date : null,
        title,
        notes: '',
      };
    } else if (current && line.trim() && /^[ \t]/.test(line)) {
      // Indented non-empty line → child note for the current milestone.
      // Strip up to 4 leading spaces or one tab; preserve any deeper indent.
      const stripped = line.replace(/^( {1,4}|\t)/, '');
      current.notes = current.notes ? current.notes + '\n' + stripped : stripped;
    }
    // Empty / non-indented non-milestone lines are ignored — they shouldn't
    // appear inside the Milestones section but we won't choke on them.
  }
  if (current) items.push(current);
  return items;
}

/* Format a milestone array back into markdown lines.
   Notes are emitted as 4-space-indented child lines under the milestone. */
function stringifyMilestones(items) {
  if (!items || !items.length) return '';
  return items.map((m) => {
    const box = m.done ? '- [x] ' : '- [ ] ';
    const date = m.date instanceof Date && !isNaN(m.date.getTime())
      ? `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}-${String(m.date.getDate()).padStart(2, '0')} `
      : '';
    const sep = (date && m.title) ? '— ' : '';
    let line = `${box}${date}${sep}${m.title || ''}`.trimEnd();
    if (m.notes && m.notes.trim()) {
      const noteLines = m.notes.split('\n').map((l) => '    ' + l).join('\n');
      line += '\n' + noteLines;
    }
    return line;
  }).join('\n');
}

/* Plain task lines (no date prefix) — for the Tasks H2 section. */
function parseTasksList(text) {
  if (!text) return [];
  return text.split('\n')
    .filter((l) => /^\s*-\s\[(x|X| )\]\s/.test(l))
    .map((l) => ({
      done: / \[(x|X)\] /.test(l),
      title: l.replace(/^\s*-\s\[(x|X| )\]\s/, ''),
    }));
}
function stringifyTasks(items) {
  if (!items || !items.length) return '';
  return items.map((t) => `${t.done ? '- [x] ' : '- [ ] '}${t.title || ''}`).join('\n');
}

async function readProjectMeta(app, file) {
  const content = await app.vault.read(file);
  const sections = parseH2Sections(content);
  const milestones = parseMilestones(sections['Milestones'] || '');
  const total = milestones.length;
  const done = milestones.filter((m) => m.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const today = startOfDay(new Date());
  const upcoming = milestones
    .filter((m) => !m.done && m.date)
    .sort((a, b) => a.date - b.date);
  const next = upcoming[0] || null;
  return { content, sections, milestones, total, done, percent, next, today };
}

async function createEntity(app, entityKey, rawName) {
  const def = ENTITIES[entityKey];
  await ensureFolderSync(app, def.folder);
  const safeName = (rawName || `Untitled ${def.label}`).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
  let path = `${def.folder}/${safeName}.md`;
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = `${def.folder}/${safeName} ${n}.md`;
    n++;
  }
  return await app.vault.create(path, entityTemplate(entityKey, safeName));
}

/* ─────────── Daily-note read/write ─────────── */
async function ensureDailyNote(app, settings, date = new Date()) {
  const path = dailyNotePath(settings, date);
  let file = app.vault.getAbstractFileByPath(path);
  if (file) return file;
  const folder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch (_) {}
  }
  const template = [
    `# ${ymd(date)}`, '',
    settings.tasksHeading, '- [ ] ', '',
    settings.journalHeading, '', '',
  ].join('\n');
  file = await app.vault.create(path, template);
  return file;
}

function parseSections(content, settings) {
  const lines = content.split('\n');
  const tasks = [];
  let journal = '';
  let mode = null;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      const stripped = line.trim();
      if (stripped === settings.tasksHeading) { mode = 'tasks'; continue; }
      if (stripped === settings.journalHeading) { mode = 'journal'; continue; }
      mode = null;
      continue;
    }
    if (mode === 'tasks') {
      if (/^\s*-\s\[(x|X| )\]\s/.test(line)) tasks.push(line);
    } else if (mode === 'journal') {
      journal += (journal ? '\n' : '') + line;
    }
  }
  return { tasks, journal: journal.replace(/\s+$/, ''), raw: content };
}

function replaceSection(content, heading, newBody) {
  const lines = content.split('\n');
  const headIdx = lines.findIndex((l) => l.trim() === heading);
  if (headIdx === -1) {
    return content.replace(/\s*$/, '') + `\n\n${heading}\n${newBody}\n`;
  }
  let endIdx = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { endIdx = i; break; }
  }
  const before = lines.slice(0, headIdx + 1);
  const after = lines.slice(endIdx);
  const bodyLines = newBody.split('\n');
  return [...before, ...bodyLines, '', ...after].join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ─────────── Reminders ─────────── */
function reminderId() { return 'rem_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

function nextRepeat(when, repeat) {
  if (!when) return null;
  const d = when instanceof Date ? when : new Date(when);
  if (repeat === 'daily')  return new Date(d.getTime() + 86400000);
  if (repeat === 'weekly') return new Date(d.getTime() + 7 * 86400000);
  return null;
}

function reminderBucket(when) {
  if (!when) return 'later';
  const now = Date.now();
  const w = new Date(when).getTime();
  if (w <= now + 60 * 60 * 1000) return 'now';            // due now or within next hour
  const today = startOfDay(new Date()).getTime();
  const tomorrow = today + 86400000;
  if (w < tomorrow) return 'today';
  const weekEnd = today + 7 * 86400000;
  if (w < weekEnd) return 'week';
  return 'later';
}

/* Resolve a project's display name from its file path. */
function projectNameFromPath(app, path) {
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return path.split('/').pop().replace(/\.md$/, '');
  const cache = app.metadataCache.getFileCache(file);
  const fmName = cache && cache.frontmatter && cache.frontmatter.name;
  return fmName || file.basename;
}

/* Find an existing reminder linked to a specific (project, task-text) pair. */
function findProjectTaskReminder(plugin, projectPath, taskText) {
  if (!projectPath || !taskText) return null;
  const all = plugin.settings.reminders || [];
  return all.find((r) => !r.done && r.project === projectPath && r.text === taskText) || null;
}

function reminderTimeStr(when) {
  if (!when) return '';
  const d = new Date(when);
  if (isNaN(d.getTime())) return '';
  const today = startOfDay(new Date()).getTime();
  const dDay = startOfDay(d).getTime();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (dDay === today) return time;
  if (dDay === today + 86400000) return `Tomorrow ${time}`;
  if (dDay - today < 7 * 86400000 && dDay > today) {
    return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + time;
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time;
}

/* ─────────── Quick-capture modal ─────────── */
class CadenceCaptureModal extends obsidian.Modal {
  constructor(app, opts) {
    super(app);
    this.onSubmit = opts.onSubmit;
    this.defaultText = opts.defaultText || '';
    this.defaultWhen = opts.defaultWhen || null; // ISO or null
    this.defaultRepeat = opts.defaultRepeat || 'none';
    this._submitted = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-capture-modal');
    contentEl.createEl('h3', { text: 'Quick capture' });

    const textRow = contentEl.createDiv({ cls: 'cad-form-row' });
    textRow.createDiv({ cls: 'cad-form-label', text: 'WHAT' });
    const textInput = textRow.createEl('input', { type: 'text', cls: 'cad-form-input' });
    textInput.placeholder = 'What needs doing?';
    textInput.value = this.defaultText;

    // Schedule toggle
    const schedToggleRow = contentEl.createDiv();
    schedToggleRow.style.marginTop = '14px';
    schedToggleRow.style.display = 'flex';
    schedToggleRow.style.alignItems = 'center';
    schedToggleRow.style.gap = '8px';
    const schedCb = schedToggleRow.createEl('input', { type: 'checkbox' });
    const schedLbl = schedToggleRow.createEl('label', { text: 'Remind me' });
    schedLbl.style.fontSize = '13px';
    schedLbl.style.cursor = 'pointer';
    schedLbl.addEventListener('click', () => { schedCb.checked = !schedCb.checked; schedCb.dispatchEvent(new Event('change')); });

    // Schedule fields (hidden until toggled)
    const schedFields = contentEl.createDiv({ cls: 'cad-capture-sched' });
    schedFields.style.display = 'none';
    schedFields.style.marginTop = '12px';
    schedFields.style.gap = '12px';
    schedFields.style.display = 'none';

    const dateRow = schedFields.createDiv({ cls: 'cad-form-row' });
    dateRow.createDiv({ cls: 'cad-form-label', text: 'WHEN' });
    const dateInput = dateRow.createEl('input', { type: 'datetime-local', cls: 'cad-form-input' });
    if (this.defaultWhen) {
      const d = new Date(this.defaultWhen);
      if (!isNaN(d.getTime())) dateInput.value = toLocalDatetimeValue(d);
    } else {
      // Default to now + 1 hour, rounded to next 15min
      const dft = new Date(Date.now() + 60 * 60 * 1000);
      dft.setMinutes(Math.ceil(dft.getMinutes() / 15) * 15, 0, 0);
      dateInput.value = toLocalDatetimeValue(dft);
    }

    // Quick-pick buttons
    const quick = schedFields.createDiv();
    quick.style.display = 'flex';
    quick.style.gap = '6px';
    quick.style.marginTop = '8px';
    quick.style.flexWrap = 'wrap';
    const setQuick = (deltaMs) => {
      const d = new Date(Date.now() + deltaMs);
      d.setSeconds(0, 0);
      dateInput.value = toLocalDatetimeValue(d);
    };
    const mkQ = (label, deltaMs) => {
      const b = quick.createEl('button', { cls: 'cad-btn cad-btn-sm', text: label });
      b.type = 'button';
      b.addEventListener('click', () => setQuick(deltaMs));
    };
    mkQ('+15m', 15 * 60 * 1000);
    mkQ('+1h',  60 * 60 * 1000);
    mkQ('+3h',  3 * 60 * 60 * 1000);
    mkQ('Tomorrow 9am', () => {});
    quick.lastChild.addEventListener('click', () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      dateInput.value = toLocalDatetimeValue(d);
    });

    const repeatRow = schedFields.createDiv({ cls: 'cad-form-row' });
    repeatRow.style.marginTop = '10px';
    repeatRow.createDiv({ cls: 'cad-form-label', text: 'REPEAT' });
    const repeatSelect = repeatRow.createEl('select', { cls: 'cad-form-input' });
    [['none', 'No repeat'], ['daily', 'Daily'], ['weekly', 'Weekly']].forEach(([v, l]) => {
      const o = repeatSelect.createEl('option', { value: v, text: l });
      if (v === this.defaultRepeat) o.selected = true;
    });

    schedCb.addEventListener('change', () => {
      schedFields.style.display = schedCb.checked ? 'block' : 'none';
    });
    if (this.defaultWhen) { schedCb.checked = true; schedFields.style.display = 'block'; }

    // Action row
    const row = contentEl.createDiv();
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '8px';
    row.style.marginTop = '18px';
    const cancel = row.createEl('button', { cls: 'cad-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { cls: 'cad-btn primary', text: 'Capture' });
    ok.type = 'button';

    const submit = () => {
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      const result = { text, when: null, repeat: 'none' };
      if (schedCb.checked && dateInput.value) {
        const d = fromLocalDatetimeValue(dateInput.value);
        if (d && !isNaN(d.getTime())) {
          result.when = d.toISOString();
          result.repeat = repeatSelect.value || 'none';
        }
      }
      this._submitted = true;
      this.close();
      this.onSubmit(result);
    };
    ok.addEventListener('click', submit);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });

    setTimeout(() => textInput.focus(), 0);
  }
  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* Helpers for <input type="datetime-local"> ↔ Date in local TZ */
function toLocalDatetimeValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalDatetimeValue(s) {
  if (!s) return null;
  // datetime-local has no timezone — interpret as local time
  return new Date(s);
}

/* ─────────── Reminder edit modal (text/when/repeat/notes/delete) ─────────── */
class CadenceReminderEditModal extends obsidian.Modal {
  constructor(app, plugin, reminder, opts) {
    super(app);
    this.plugin = plugin;
    this.reminder = reminder;
    this.isNew = (opts && opts.isNew) || false;
    this._submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-create-modal');
    contentEl.addClass('cad-reminder-edit-modal');
    contentEl.createEl('h3', { cls: 'cad-create-title', text: this.isNew ? 'New reminder' : 'Edit reminder' });

    /* Linked project chip (read-only, shown only if set) */
    if (this.reminder.project) {
      const link = contentEl.createDiv({ cls: 'cad-rem-project-chip-row' });
      const chip = link.createEl('a', { cls: 'cad-rem-project-chip', text: '📁 ' + (projectNameFromPath(this.app, this.reminder.project) || this.reminder.project) });
      chip.title = 'Open project';
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const file = this.app.vault.getAbstractFileByPath(this.reminder.project);
        if (file && file instanceof obsidian.TFile) {
          // Close modal then open detail
          this._submitted = true;
          this.close();
          const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP)[0];
          if (leaf && leaf.view && typeof leaf.view.openEntityDetail === 'function') {
            leaf.view.openEntityDetail('project', file);
          } else {
            this.app.workspace.openLinkText(this.reminder.project, '', false);
          }
        }
      });
    }

    const form = contentEl.createDiv({ cls: 'cad-create-form' });

    /* Text */
    const textRow = form.createDiv({ cls: 'cad-create-row' });
    textRow.createDiv({ cls: 'cad-create-label', text: 'WHAT *' });
    const textInput = textRow.createEl('input', { type: 'text', cls: 'cad-create-input' });
    textInput.value = this.reminder.text || '';
    textInput.placeholder = 'What needs doing?';

    /* When */
    const whenRow = form.createDiv({ cls: 'cad-create-row' });
    whenRow.createDiv({ cls: 'cad-create-label', text: 'WHEN' });
    const whenWrap = whenRow.createDiv();
    whenWrap.style.display = 'flex';
    whenWrap.style.gap = '8px';
    whenWrap.style.alignItems = 'center';
    const dateInput = whenWrap.createEl('input', { type: 'datetime-local', cls: 'cad-create-input' });
    dateInput.style.flex = '1';
    if (this.reminder.when) {
      const d = new Date(this.reminder.when);
      if (!isNaN(d.getTime())) dateInput.value = toLocalDatetimeValue(d);
    }
    const clearBtn = whenWrap.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Clear' });
    clearBtn.type = 'button';
    clearBtn.title = 'Move to unscheduled';
    clearBtn.addEventListener('click', () => { dateInput.value = ''; });

    /* Repeat */
    const repeatRow = form.createDiv({ cls: 'cad-create-row' });
    repeatRow.createDiv({ cls: 'cad-create-label', text: 'REPEAT' });
    const repeatSel = repeatRow.createEl('select', { cls: 'cad-create-input' });
    [['none', 'No repeat'], ['daily', 'Daily'], ['weekly', 'Weekly']].forEach(([v, l]) => {
      const o = repeatSel.createEl('option', { value: v, text: l });
      if (v === (this.reminder.repeat || 'none')) o.selected = true;
    });

    /* Notes */
    const notesRow = form.createDiv({ cls: 'cad-create-row' });
    notesRow.style.alignItems = 'flex-start';
    notesRow.createDiv({ cls: 'cad-create-label', text: 'NOTES' });
    const notesArea = notesRow.createEl('textarea', { cls: 'cad-create-input' });
    notesArea.rows = 6;
    notesArea.placeholder = 'Context, follow-ups, what happened, related links…';
    notesArea.value = this.reminder.notes || '';
    notesArea.style.resize = 'vertical';
    notesArea.style.fontFamily = 'inherit';

    /* Actions */
    const actions = contentEl.createDiv({ cls: 'cad-create-actions' });
    if (!this.isNew) {
      const del = actions.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete' });
      del.type = 'button';
      del.style.marginRight = 'auto';
      del.addEventListener('click', async () => {
        if (!confirm('Delete this reminder?')) return;
        await this.plugin.deleteReminder(this.reminder.id);
        this._submitted = true;
        this.close();
      });
    }
    const cancel = actions.createEl('button', { cls: 'cad-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'cad-btn primary', text: this.isNew ? 'Create reminder' : 'Save' });
    save.type = 'button';

    const submit = async () => {
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      const fields = {
        text,
        notes: notesArea.value,
        repeat: repeatSel.value || 'none',
      };
      if (dateInput.value) {
        const d = fromLocalDatetimeValue(dateInput.value);
        if (d && !isNaN(d.getTime())) {
          fields.when = d.toISOString();
          if (fields.when !== this.reminder.when) fields.notified = false;
        }
      } else {
        fields.when = null;
        fields.notified = false;
      }
      if (this.isNew) {
        await this.plugin.addReminder(Object.assign({}, fields, { project: this.reminder.project || null }));
        new obsidian.Notice(fields.when
          ? `Reminder set · ${reminderTimeStr(fields.when)}`
          : 'Captured to Inbox');
      } else {
        await this.plugin.updateReminder(this.reminder.id, fields);
      }
      this._submitted = true;
      this.close();
    };
    save.addEventListener('click', submit);

    // Submit on Cmd/Ctrl+Enter from notes area; Esc cancels
    notesArea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });

    setTimeout(() => textInput.focus(), 0);
  }

  onClose() { this.contentEl.empty(); }
}

/* ─────────── CSV parser (handles quoted fields, escaped quotes, newlines) ─────────── */
function parseCSV(text) {
  if (!text) return [];
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuote = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuote = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') {
      row.push(field); rows.push(row); row = []; field = '';
      i += (text[i + 1] === '\n') ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Drop trailing empty row(s)
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/* ─────────── CSV import modal ─────────── */
class CadenceImportModal extends obsidian.Modal {
  constructor(app, opts) {
    super(app);
    this.entityKey = (opts && opts.entityKey) || 'contact';
    this.onSubmit = (opts && opts.onSubmit) || (() => {});
    this.csvText = '';
    this.headers = [];
    this.rows = [];
    this.mapping = {}; // csv-header → entity-field-key | null
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-import-modal');
    contentEl.createEl('h3', { cls: 'cad-create-title', text: 'Import from CSV' });

    /* Entity selector */
    const entityRow = contentEl.createDiv({ cls: 'cad-create-row' });
    entityRow.createDiv({ cls: 'cad-create-label', text: 'IMPORT AS' });
    const entitySelect = entityRow.createEl('select', { cls: 'cad-create-input' });
    Object.entries(ENTITIES).forEach(([key, def]) => {
      const o = entitySelect.createEl('option', { value: key, text: def.plural });
      if (key === this.entityKey) o.selected = true;
    });
    entitySelect.addEventListener('change', () => {
      this.entityKey = entitySelect.value;
      this._autoDetectMapping();
      this._renderPreview();
    });

    /* CSV input */
    const csvRow = contentEl.createDiv({ cls: 'cad-create-row' });
    csvRow.style.alignItems = 'flex-start';
    csvRow.createDiv({ cls: 'cad-create-label', text: 'CSV DATA' });
    const csvWrap = csvRow.createDiv();
    csvWrap.style.display = 'flex';
    csvWrap.style.flexDirection = 'column';
    csvWrap.style.gap = '8px';

    const tabs = csvWrap.createDiv();
    tabs.style.display = 'flex';
    tabs.style.gap = '6px';
    const pasteBtn = tabs.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Paste' });
    pasteBtn.type = 'button';
    const fileBtn  = tabs.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Pick .csv from vault' });
    fileBtn.type = 'button';

    const ta = csvWrap.createEl('textarea', { cls: 'cad-create-input' });
    ta.rows = 8;
    ta.placeholder = 'Paste CSV here, including a header row…';
    ta.style.fontFamily = 'var(--font-monospace-theme, var(--font-monospace))';
    ta.style.fontSize = '12px';
    ta.style.resize = 'vertical';
    ta.addEventListener('input', () => {
      this.csvText = ta.value;
      this._parse();
      this._renderPreview();
    });

    pasteBtn.addEventListener('click', () => ta.focus());
    fileBtn.addEventListener('click', async () => {
      const csvFiles = this.app.vault.getFiles().filter((f) => f.path.toLowerCase().endsWith('.csv'));
      if (!csvFiles.length) {
        new obsidian.Notice('No .csv files found in vault. Drop one in the vault first.');
        return;
      }
      const picker = new (class extends obsidian.SuggestModal {
        constructor(app, files, onPick) { super(app); this.files = files; this.onPick = onPick; this.setPlaceholder('Search .csv files…'); }
        getSuggestions(q) { return this.files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase())); }
        renderSuggestion(file, el) { el.setText(file.path); }
        onChooseSuggestion(file) { this.onPick(file); }
      })(this.app, csvFiles, async (file) => {
        try {
          const text = await this.app.vault.read(file);
          ta.value = text;
          this.csvText = text;
          this._parse();
          this._renderPreview();
        } catch (e) {
          new obsidian.Notice(`Failed to read ${file.path}: ${e.message}`);
        }
      });
      picker.open();
    });

    /* Preview area */
    this.previewEl = contentEl.createDiv({ cls: 'cad-import-preview' });
    this._renderPreview();

    /* Action row */
    const actions = contentEl.createDiv({ cls: 'cad-create-actions' });
    const cancel = actions.createEl('button', { cls: 'cad-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    this.importBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Import' });
    this.importBtn.type = 'button';
    this.importBtn.disabled = true;
    this.importBtn.addEventListener('click', () => this._submitImport());
  }

  _parse() {
    if (!this.csvText.trim()) { this.headers = []; this.rows = []; return; }
    const all = parseCSV(this.csvText);
    if (!all.length) { this.headers = []; this.rows = []; return; }
    this.headers = all[0].map((h) => String(h).trim());
    this.rows = all.slice(1);
    this._autoDetectMapping();
  }

  _autoDetectMapping() {
    this.mapping = {};
    const def = ENTITIES[this.entityKey];
    if (!def || !this.headers.length) return;

    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const keyByNorm = {};
    def.fields.forEach((f) => {
      keyByNorm[norm(f.key)] = f.key;
      keyByNorm[norm(f.label)] = f.key;
    });
    // Common synonyms
    const synonyms = {
      'fullname': 'name', 'displayname': 'name', 'contact': 'name',
      'companyname': 'company', 'organisation': 'company', 'organization': 'company',
      'phone': 'name', // not great — leave unmapped
      'mail': 'email', 'emailaddress': 'email',
      'amount': 'value', 'price': 'value', 'mrr': 'value', 'arr': 'value',
      'closedate': 'closeBy', 'expectedclose': 'closeBy',
      'lastcontacted': 'lastContact', 'lastcontact': 'lastContact',
    };

    this.headers.forEach((h) => {
      const n = norm(h);
      if (!n) { this.mapping[h] = null; return; }
      if (keyByNorm[n]) { this.mapping[h] = keyByNorm[n]; return; }
      // Synonyms — only take if the target key is a real field
      if (synonyms[n] && def.fields.some((f) => f.key === synonyms[n])) {
        this.mapping[h] = synonyms[n]; return;
      }
      // Fuzzy contains
      const fuzzy = def.fields.find((f) => n.includes(norm(f.key)) || norm(f.key).includes(n));
      this.mapping[h] = fuzzy ? fuzzy.key : null;
    });
  }

  _renderPreview() {
    this.previewEl.empty();
    if (!this.headers.length) {
      this.previewEl.createDiv({ cls: 'cad-empty', text: 'Paste or pick a CSV to preview…' });
      if (this.importBtn) this.importBtn.disabled = true;
      return;
    }

    const def = ENTITIES[this.entityKey];

    /* Mapping table */
    const head = this.previewEl.createDiv({ cls: 'cad-create-label' });
    head.style.marginTop = '14px';
    head.setText('COLUMN MAPPING');

    const tableWrap = this.previewEl.createDiv({ cls: 'cad-import-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'cad-import-table' });
    const thr = table.createEl('thead').createEl('tr');
    thr.createEl('th', { text: 'CSV column' });
    thr.createEl('th', { text: 'Maps to' });
    thr.createEl('th', { text: 'Sample' });
    const tbody = table.createEl('tbody');

    this.headers.forEach((h, i) => {
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: h });
      const mc = tr.createEl('td');
      const sel = mc.createEl('select', { cls: 'cad-create-input cad-import-select' });
      sel.createEl('option', { value: '', text: '— skip —' });
      def.fields.forEach((f) => {
        const o = sel.createEl('option', { value: f.key, text: f.label });
        if (this.mapping[h] === f.key) o.selected = true;
      });
      sel.addEventListener('change', () => {
        this.mapping[h] = sel.value || null;
        this._renderPreview(); // re-render to update warning state
      });
      const sample = tr.createEl('td');
      const samples = this.rows.slice(0, 2).map((r) => String(r[i] || '').trim()).filter(Boolean);
      sample.setText(samples.join(' · ').slice(0, 60));
      sample.title = samples.join('\n');
    });

    /* Summary */
    const summary = this.previewEl.createDiv({ cls: 'cad-import-summary' });
    const primaryKey = def.fields[0].key;
    const primaryMapped = Object.values(this.mapping).includes(primaryKey);
    if (!primaryMapped) {
      summary.addClass('cad-import-summary-warn');
      summary.setText(`No CSV column maps to "${def.fields[0].label}" — required to name the file. Pick a column above.`);
      if (this.importBtn) this.importBtn.disabled = true;
    } else {
      const mappedCount = Object.values(this.mapping).filter(Boolean).length;
      summary.setText(`Will create ${this.rows.length} ${this.rows.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} in ${def.folder}/  ·  ${mappedCount} column${mappedCount === 1 ? '' : 's'} mapped`);
      if (this.importBtn) this.importBtn.disabled = false;
    }
  }

  async _submitImport() {
    const def = ENTITIES[this.entityKey];
    const primaryKey = def.fields[0].key;
    const primaryHeader = Object.entries(this.mapping).find(([_, v]) => v === primaryKey);
    if (!primaryHeader) return;
    const primaryColIdx = this.headers.indexOf(primaryHeader[0]);

    this.importBtn.disabled = true;
    this.importBtn.setText('Importing…');
    const start = Date.now();
    let created = 0;
    let failed = 0;

    for (const row of this.rows) {
      const primaryValue = String(row[primaryColIdx] || '').trim();
      if (!primaryValue) { failed++; continue; }
      try {
        const file = await createEntity(this.app, this.entityKey, primaryValue);
        const extras = {};
        Object.entries(this.mapping).forEach(([header, key]) => {
          if (!key || key === primaryKey) return;
          const idx = this.headers.indexOf(header);
          let val = String(row[idx] || '').trim();
          if (!val) return;
          const fdef = def.fields.find((f) => f.key === key);
          if (fdef) {
            if (fdef.type === 'number' || fdef.type === 'currency') {
              const cleaned = val.replace(/[^\d.\-]/g, '');
              const n = Number(cleaned);
              if (isNaN(n)) return;
              val = n;
            } else if (fdef.type === 'tags') {
              val = val.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
              if (!val.length) return;
            } else if (fdef.type === 'date') {
              // Try to normalise to YYYY-MM-DD
              const d = new Date(val);
              if (!isNaN(d.getTime())) val = d.toISOString().slice(0, 10);
            }
          }
          extras[key] = val;
        });
        if (Object.keys(extras).length) {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            Object.entries(extras).forEach(([k, v]) => {
              if (v == null || v === '') return;
              if (Array.isArray(v) && v.length === 0) return;
              fm[k] = v;
            });
          });
        }
        created++;
      } catch (e) {
        failed++;
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    new obsidian.Notice(`Imported ${created} ${def.plural.toLowerCase()} in ${elapsed}s${failed ? ` · ${failed} skipped` : ''}`, 5000);
    this.close();
    this.onSubmit({ created, failed, entityKey: this.entityKey });
  }

  onClose() { this.contentEl.empty(); }
}

/* ─────────── Entity create modal (rich, all fields up-front) ─────────── */
class CadenceEntityCreateModal extends obsidian.Modal {
  constructor(app, entityKey, opts) {
    super(app);
    this.entityKey = entityKey;
    this.def = ENTITIES[entityKey];
    this.onSubmit = opts.onSubmit;
    this._submitted = false;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-create-modal');
    if (modalEl) modalEl.addClass('cad-create-modal-shell');

    contentEl.createEl('h3', { cls: 'cad-create-title', text: `New ${this.def.label}` });

    const form = contentEl.createDiv({ cls: 'cad-create-form' });
    const inputs = [];

    this.def.fields.forEach((f, idx) => {
      const isPrimary = idx === 0;
      const row = form.createDiv({ cls: 'cad-create-row' });
      const label = row.createDiv({ cls: 'cad-create-label' });
      label.setText(f.label.toUpperCase() + (isPrimary ? ' *' : ''));

      let input;
      const fieldType = f.type || 'text';

      if (fieldType === 'enum') {
        input = row.createEl('select', { cls: 'cad-create-input' });
        input.createEl('option', { value: '', text: '— —' });
        (f.options || []).forEach((opt) => input.createEl('option', { value: opt, text: opt }));
        // Smart defaults — first option for stage/status fields
        if (['stage', 'status', 'priority', 'tier', 'type'].includes(f.key) && f.options && f.options.length) {
          const sensible = f.key === 'stage' ? 'Lead'
            : f.key === 'status' ? (f.options.find((o) => /active|new|draft|submitted|pending/i.test(o)) || f.options[0])
            : f.key === 'priority' ? (f.options.find((o) => /medium/i.test(o)) || f.options[0])
            : f.options[0];
          if (f.options.includes(sensible)) input.value = sensible;
        }
      } else if (fieldType === 'date') {
        input = row.createEl('input', { type: 'date', cls: 'cad-create-input' });
      } else if (fieldType === 'number' || fieldType === 'currency') {
        input = row.createEl('input', { type: 'number', cls: 'cad-create-input' });
        input.placeholder = '0';
      } else if (fieldType === 'email') {
        input = row.createEl('input', { type: 'email', cls: 'cad-create-input' });
        input.placeholder = 'name@example.com';
      } else if (fieldType === 'tags') {
        input = row.createEl('input', { type: 'text', cls: 'cad-create-input' });
        input.placeholder = 'tag1, tag2';
      } else {
        input = row.createEl('input', { type: 'text', cls: 'cad-create-input' });
        input.placeholder = this._placeholderFor(f, isPrimary);
      }
      input.dataset.fieldKey = f.key;
      input.dataset.fieldType = fieldType;
      if (isPrimary) input.required = true;
      inputs.push(input);
    });

    /* Action row */
    const actions = contentEl.createDiv({ cls: 'cad-create-actions' });
    const cancel = actions.createEl('button', { cls: 'cad-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());

    const submitBtn = actions.createEl('button', { cls: 'cad-btn primary', text: `Create ${this.def.label}` });
    submitBtn.type = 'button';

    const submit = () => {
      const values = {};
      let primaryValue = null;
      inputs.forEach((el, idx) => {
        const key = el.dataset.fieldKey;
        const type = el.dataset.fieldType;
        let raw = el.value;
        if (idx === 0) primaryValue = (raw || '').trim();
        if (raw === '' || raw == null) return;
        if (type === 'tags') raw = raw.split(',').map((t) => t.trim()).filter(Boolean);
        else if (type === 'number' || type === 'currency') {
          const n = Number(raw);
          raw = isNaN(n) ? null : n;
        }
        if (raw == null) return;
        if (Array.isArray(raw) && raw.length === 0) return;
        values[key] = raw;
      });
      if (!primaryValue) {
        if (inputs[0]) inputs[0].focus();
        return;
      }
      this._submitted = true;
      this.close();
      this.onSubmit({ name: primaryValue, values });
    };
    submitBtn.addEventListener('click', submit);

    // Submit on Enter from any text input
    inputs.forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') this.close();
      });
    });

    setTimeout(() => { if (inputs[0]) { inputs[0].focus(); } }, 0);
  }

  _placeholderFor(field, isPrimary) {
    if (!isPrimary) return '';
    const ek = this.entityKey;
    const examples = {
      contact:      'e.g. Jane Smith',
      company:      'e.g. Acme Corp',
      partner:      'e.g. Acme Distribution',
      deal:         'e.g. Acme — FTTH expansion',
      registration: 'e.g. Vodacom 12-site FTTB',
      commission:   'e.g. C-2026-Q2-0042',
      lead:         'e.g. Sarah from Vodacom',
      certification:'e.g. Cisco CCNP — May 2026',
      activity:     'e.g. Discovery call with Jane',
      sequence:     'e.g. Outbound — SMB',
      project:      'e.g. Q3 Cadence launch',
    };
    return examples[ek] || '';
  }

  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* ─────────── Prompt modal (replaces blocked window.prompt) ─────────── */
class CadencePromptModal extends obsidian.Modal {
  constructor(app, opts) {
    super(app);
    this.title = opts.title || 'Enter a name';
    this.placeholder = opts.placeholder || '';
    this.defaultValue = opts.defaultValue || '';
    this.cta = opts.cta || 'Create';
    this.onSubmit = opts.onSubmit;
    this._submitted = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-prompt-modal');
    contentEl.createEl('h3', { text: this.title });

    const input = contentEl.createEl('input', { type: 'text' });
    input.placeholder = this.placeholder;
    input.value = this.defaultValue;
    input.style.width = '100%';
    input.style.padding = '8px 10px';
    input.style.fontSize = '14px';
    input.style.marginTop = '4px';

    const submit = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      this._submitted = true;
      this.close();
      this.onSubmit(v);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });

    const row = contentEl.createDiv();
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '8px';
    row.style.marginTop = '14px';
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { text: this.cta, cls: 'mod-cta' });
    ok.addEventListener('click', submit);

    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* ─────────── The unified Cadence app view ─────────── */
class CadenceAppView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    // Migrate legacy mode IDs from older versions
    const raw = plugin.settings.defaultTab || 'planner.today';
    this.mode = this._migrateModeId(raw);
    // Today state
    this.todayFile = null;
    this.todayParsed = null;
    this._journalSaveTimer = null;
    // Planner state
    this.plannerAnchor = startOfDay(new Date());
    // Detail-view state — when set, renders the entity form instead of the surface
    this.detailFile = null;
    this.detailEntityKey = null;
  }

  async openEntityDetail(entityKey, file) {
    if (!file || !entityKey) return;
    this.detailEntityKey = entityKey;
    this.detailFile = file;
    await this.render();
  }

  async openEntityDetailFromFile(file) {
    const key = entityKeyFromFile(this.app, file);
    if (!key) {
      // Not a Cadence entity — fall back to opening the markdown
      this.app.workspace.openLinkText(file.path, '', false);
      return;
    }
    return this.openEntityDetail(key, file);
  }

  async closeEntityDetail() {
    this.detailFile = null;
    this.detailEntityKey = null;
    await this.render();
  }

  _migrateModeId(id) {
    if (id === 'today')   return 'planner.today';
    if (id === 'planner') return 'planner.calendar';
    return SURFACE_BY_ID[id] ? id : 'home';
  }

  _visibleNavGroups() {
    const mods = this.plugin.settings.modules || { crm: true, prm: true, planner: true };
    return NAV_GROUPS
      .map((g) => {
        if (g.module && mods[g.module] === false) return null;
        const items = g.items.filter((it) => !it.module || mods[it.module] !== false);
        if (!items.length) return null;
        return Object.assign({}, g, { items });
      })
      .filter(Boolean);
  }

  _inboxOverdueCount() {
    const reminders = (this.plugin.settings.reminders || []).filter((r) => !r.done);
    const now = Date.now();
    return reminders.filter((r) => r.when && new Date(r.when).getTime() <= now).length;
  }

  getViewType()    { return VIEW_TYPE_CADENCE_APP; }
  getDisplayText() { return 'Cadence'; }
  getIcon()        { return 'sparkles'; }

  async setMode(m) {
    this.mode = this._migrateModeId(m);
    // Switching surfaces clears any open detail form
    this.detailFile = null;
    this.detailEntityKey = null;
    await this.render();
  }

  async toggleGroup(groupId) {
    const collapsed = this.plugin.settings.collapsedGroups || {};
    collapsed[groupId] = !collapsed[groupId];
    this.plugin.settings.collapsedGroups = collapsed;
    await this.plugin.saveSettings();
    await this.render();
  }

  async onOpen() {
    this.containerEl.children[1].empty();
    await this.render();

    this.registerEvent(this.app.vault.on('modify', (file) => {
      // Skip refresh while the user is editing this exact file in detail view —
      // re-rendering would steal focus from inputs they're still typing in.
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this.mode === 'planner.today' && this.todayFile && file.path === this.todayFile.path) {
        return this.render();
      }
      if (this.mode === 'planner.calendar') {
        const days = weekDates(this.plannerAnchor, this.plugin.settings.weekStartsOn);
        const paths = days.map((d) => dailyNotePath(this.plugin.settings, d));
        if (paths.includes(file.path)) return this.render();
      }
      if (this._modeUsesEntityFolder(file.path)) return this.render();
    }));

    const entityRefresh = (file) => {
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this._modeUsesEntityFolder(file && file.path)) this.render();
    };
    this.registerEvent(this.app.vault.on('create', entityRefresh));
    this.registerEvent(this.app.vault.on('delete', entityRefresh));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this._modeUsesEntityFolder(file && file.path) || this._modeUsesEntityFolder(oldPath)) this.render();
    }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this._modeUsesEntityFolder(file && file.path)) this.render();
    }));
  }

  _modeUsesEntityFolder(path) {
    if (!path) return false;
    // Most surfaces read entity folders; refresh whenever a touched file
    // sits under any Cadence/* folder. Cheap enough.
    return path.startsWith('Cadence/');
  }

  async render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass('cadence-app');

    const active = SURFACE_BY_ID[this.mode] || SURFACE_BY_ID['planner.today'];

    /* ── Top brand bar ──────────────────────── */
    const topbar = root.createDiv({ cls: 'cad-app-topbar' });
    const brand = topbar.createDiv({ cls: 'cad-app-brand' });
    brand.createSpan({ cls: 'cad-app-brand-mark', text: '◐' });
    brand.createSpan({ cls: 'cad-app-brand-text', text: 'Cadence' });
    const eyebrow = topbar.createDiv({ cls: 'cad-app-topbar-meta' });
    eyebrow.setText(active.label.toUpperCase());

    /* ── Body: left grouped nav + main content ──────── */
    const body = root.createDiv({ cls: 'cad-app-body' });
    const nav = body.createDiv({ cls: 'cad-app-nav' });
    const collapsed = this.plugin.settings.collapsedGroups || {};

    const visibleGroups = this._visibleNavGroups();
    visibleGroups.forEach((group) => {
      const groupEl = nav.createDiv({ cls: 'cad-nav-group' });
      const isCollapsed = !!collapsed[group.id];

      if (group.label) {
        const head = groupEl.createDiv({ cls: 'cad-nav-group-head' });
        const chev = head.createSpan({ cls: 'cad-nav-group-chev' });
        try { obsidian.setIcon(chev, isCollapsed ? 'chevron-right' : 'chevron-down'); } catch (_) {}
        head.createSpan({ cls: 'cad-nav-group-label', text: group.label.toUpperCase() });
        head.addEventListener('click', () => this.toggleGroup(group.id));
      }

      if (!isCollapsed || !group.label) {
        const list = groupEl.createDiv({ cls: 'cad-nav-group-items' });
        group.items.forEach((s) => {
          const item = list.createDiv({
            cls: 'cad-app-nav-item' + (this.mode === s.id ? ' active' : ''),
          });
          const ic = item.createSpan({ cls: 'cad-app-nav-icon' });
          try { obsidian.setIcon(ic, s.icon); } catch (_) {}
          item.createSpan({ cls: 'cad-app-nav-label', text: s.label });
          if (!BUILT_SURFACES.has(s.id)) {
            item.createSpan({ cls: 'cad-app-nav-badge', text: 'soon' });
          }
          // Inbox: badge with overdue count
          if (s.id === 'planner.inbox') {
            const overdue = this._inboxOverdueCount();
            if (overdue > 0) item.createSpan({ cls: 'cad-app-nav-badge cad-nav-badge-alert', text: String(overdue) });
          }
          item.addEventListener('click', () => this.setMode(s.id));
        });
      }
    });

    const content = body.createDiv({ cls: 'cad-app-content' });

    // Detail view trumps the normal surface routing
    if (this.detailFile && this.detailEntityKey) {
      await this.renderEntityDetail(content, this.detailEntityKey, this.detailFile);
      return;
    }

    const route = {
      'home':                () => this.renderHome(content),
      'planner.inbox':       () => this.renderInbox(content),
      'planner.today':       () => this.renderTodayPane(content),
      'planner.calendar':    () => this.renderPlannerPane(content),
      'planner.projects':    () => this.renderProjectsView(content),
      'crm.dashboard':       () => this.renderDashboard(content),
      'crm.pipeline':        () => this.renderEntityKanban(content, 'deal', 'stage', DEAL_STAGES),
      'crm.contacts':        () => this.renderEntityList(content, 'contact'),
      'crm.companies':       () => this.renderEntityList(content, 'company'),
      'crm.activities':      () => this.renderEntityList(content, 'activity'),
      'prm.partners':        () => this.renderEntityList(content, 'partner'),
      'prm.registrations':   () => this.renderEntityList(content, 'registration'),
      'prm.commissions':     () => this.renderEntityList(content, 'commission'),
      'prm.leads':           () => this.renderEntityList(content, 'lead'),
      'prm.certifications':  () => this.renderEntityList(content, 'certification'),
      'prm.analytics':       () => this.renderPRMAnalytics(content),
      'workflow.sequences':  () => this.renderEntityList(content, 'sequence'),
      'reports.pipeline':    () => this.renderReportPipeline(content),
      'reports.sales':       () => this.renderReportSales(content),
      'reports.partners':    () => this.renderReportPartners(content),
      'reports.activity':    () => this.renderReportActivity(content),
      'reports.productivity':() => this.renderProductivity(content),
      'team':                () => this.renderTeam(content),
      'settings':            () => this.openSettingsTab(content),
    };
    if (route[this.mode]) {
      await route[this.mode]();
    } else {
      this.renderComingSoon(content, active);
    }
  }

  renderComingSoon(root, surface) {
    root.addClass('cadence-soon');
    const wrap = root.createDiv({ cls: 'cad-soon-wrap' });
    wrap.createDiv({ cls: 'cad-eyebrow', text: 'COMING SOON' });
    wrap.createDiv({ cls: 'cad-soon-title', text: surface.label });
    wrap.createDiv({ cls: 'cad-soon-desc', text: surface.desc });

    const ic = wrap.createDiv({ cls: 'cad-soon-icon' });
    try { obsidian.setIcon(ic, surface.icon); } catch (_) {}

    const meta = wrap.createDiv({ cls: 'cad-soon-meta' });
    meta.setText('This surface is scaffolded but not yet built. Tell the team to flesh it out next.');
  }

  /* ── Generic page header ────────────────── */
  _renderPageHeader(root, title, subtitle, actions) {
    const head = root.createDiv({ cls: 'cad-page-header' });
    const left = head.createDiv({ cls: 'cad-page-header-left' });
    left.createDiv({ cls: 'cad-eyebrow', text: 'CADENCE' });
    left.createDiv({ cls: 'cad-page-title', text: title });
    if (subtitle) left.createDiv({ cls: 'cad-page-subtitle', text: subtitle });
    const right = head.createDiv({ cls: 'cad-page-header-right' });
    if (typeof actions === 'function') actions(right);
    return head;
  }

  /* ── Generic entity LIST view ───────────── */
  async renderEntityList(root, entityKey, opts = {}) {
    root.addClass('cadence-list');
    const def = ENTITIES[entityKey];
    if (!def) { this.renderComingSoon(root, SURFACE_BY_ID[this.mode]); return; }

    const entities = listEntities(this.app, entityKey);
    const filtered = opts.filter ? entities.filter(opts.filter) : entities;

    this._renderPageHeader(root, opts.title || def.plural, `${filtered.length} ${filtered.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} in ${def.folder}`, (right) => {
      const importBtn = right.createEl('button', { cls: 'cad-btn', text: 'Import CSV' });
      importBtn.addEventListener('click', () => new CadenceImportModal(this.app, { entityKey }).open());
      const btn = right.createEl('button', { cls: 'cad-btn primary', text: `+ New ${def.label}` });
      btn.addEventListener('click', () => this._createEntityFromPrompt(entityKey));
    });

    if (!filtered.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: `No ${def.plural.toLowerCase()} yet` });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: `Drop a markdown note in ${def.folder}/ with frontmatter, or hit "+ New" above.` });
      return;
    }

    const cols = (opts.columns || def.columns).map((k) => def.fields.find((f) => f.key === k)).filter(Boolean);
    const tableWrap = root.createDiv({ cls: 'cad-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'cad-table' });

    const thead = table.createEl('thead');
    const trh = thead.createEl('tr');
    cols.forEach((f) => trh.createEl('th', { text: f.label }));

    const tbody = table.createEl('tbody');
    filtered.forEach((e) => {
      const tr = tbody.createEl('tr', { cls: 'cad-row' });
      cols.forEach((f, i) => {
        const td = tr.createEl('td');
        const val = entityValue(e, f.key, def);
        const formatted = fmtValue(val, f.type);
        if (i === 0) {
          const a = td.createEl('a', { cls: 'cad-row-primary', text: formatted || e.basename });
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            this.openEntityDetail(entityKey, e.file);
          });
        } else {
          td.setText(formatted);
        }
      });
    });
  }

  /* ── Entity DETAIL view (in-app form, autosaves to frontmatter) ── */
  async renderEntityDetail(root, entityKey, file) {
    // Projects get a richer PM-style detail view
    if (entityKey === 'project') return this.renderProjectDetail(root, file);

    root.addClass('cadence-detail');
    const def = ENTITIES[entityKey];
    if (!def || !file) { this.closeEntityDetail(); return; }

    // Read current entity
    const cache = this.app.metadataCache.getFileCache(file) || {};
    const fm = Object.assign({}, cache.frontmatter || {});
    const primaryKey = def.fields[0].key;
    const titleVal = (fm[primaryKey] != null && fm[primaryKey] !== '') ? fm[primaryKey] : file.basename;

    // Header: back / breadcrumb / title / actions
    const head = root.createDiv({ cls: 'cad-detail-header' });
    const headLeft = head.createDiv({ cls: 'cad-detail-header-left' });

    const back = headLeft.createEl('button', { cls: 'cad-btn cad-detail-back', text: '← ' + def.plural });
    back.addEventListener('click', () => this.closeEntityDetail());

    const breadcrumb = headLeft.createDiv({ cls: 'cad-detail-breadcrumb' });
    breadcrumb.createSpan({ cls: 'cad-eyebrow', text: def.plural.toUpperCase() });
    breadcrumb.createSpan({ cls: 'cad-detail-title', text: String(titleVal) });
    breadcrumb.createDiv({ cls: 'cad-detail-path', text: file.path });

    const headRight = head.createDiv({ cls: 'cad-detail-header-right' });
    const savedBadge = headRight.createSpan({ cls: 'cad-detail-saved', text: '' });
    const openNote = headRight.createEl('button', { cls: 'cad-btn', text: 'Open as note' });
    openNote.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
    const deleteBtn = headRight.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete' });
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete this ${def.label.toLowerCase()}? This moves the file to trash.`)) return;
      try {
        await this.app.vault.trash(file, true);
        new obsidian.Notice(`Deleted ${def.label}: ${file.basename}`);
        this.closeEntityDetail();
      } catch (e) {
        new obsidian.Notice(`Delete failed: ${e.message}`);
      }
    });

    // Form
    const form = root.createDiv({ cls: 'cad-detail-form' });
    let saveTimer = null;
    const flashSaved = () => {
      savedBadge.setText('Saved');
      savedBadge.addClass('show');
      clearTimeout(savedBadge._t);
      savedBadge._t = setTimeout(() => savedBadge.removeClass('show'), 1400);
    };
    const writeField = async (key, raw) => {
      try {
        let value = raw;
        // Coerce based on field type
        const fdef = def.fields.find((f) => f.key === key);
        if (fdef) {
          if (fdef.type === 'tags') {
            value = (raw || '').split(',').map((t) => t.trim()).filter(Boolean);
          } else if (fdef.type === 'number' || fdef.type === 'currency') {
            const n = Number(raw);
            value = isNaN(n) ? null : n;
          } else if (raw === '') {
            value = null;
          }
        }
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (value == null || (Array.isArray(value) && value.length === 0)) {
            delete frontmatter[key];
          } else {
            frontmatter[key] = value;
          }
        });
        flashSaved();
      } catch (e) {
        new obsidian.Notice(`Save failed: ${e.message}`);
      }
    };
    const debouncedWrite = (key, val) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => writeField(key, val), 350);
    };

    // Render each field as a labelled row
    def.fields.forEach((f) => {
      const row = form.createDiv({ cls: 'cad-form-row' });
      row.createDiv({ cls: 'cad-form-label', text: f.label.toUpperCase() });

      const current = fm[f.key];
      const fieldType = f.type || 'text';

      if (fieldType === 'enum') {
        const sel = row.createEl('select', { cls: 'cad-form-input' });
        // Allow empty
        sel.createEl('option', { value: '', text: '—' });
        (f.options || []).forEach((opt) => {
          const o = sel.createEl('option', { value: opt, text: opt });
          if (String(current || '') === opt) o.selected = true;
        });
        sel.addEventListener('change', () => writeField(f.key, sel.value));
      } else if (fieldType === 'date') {
        const inp = row.createEl('input', { type: 'date', cls: 'cad-form-input' });
        if (current) {
          const d = new Date(current);
          if (!isNaN(d.getTime())) inp.value = d.toISOString().slice(0, 10);
        }
        inp.addEventListener('change', () => writeField(f.key, inp.value));
      } else if (fieldType === 'number' || fieldType === 'currency') {
        const inp = row.createEl('input', { type: 'number', cls: 'cad-form-input' });
        if (current != null) inp.value = String(current);
        if (fieldType === 'currency') inp.placeholder = `${this.plugin.settings.currency || 'USD'} amount`;
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else if (fieldType === 'email') {
        const inp = row.createEl('input', { type: 'email', cls: 'cad-form-input' });
        if (current) inp.value = String(current);
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else if (fieldType === 'tags') {
        const inp = row.createEl('input', { type: 'text', cls: 'cad-form-input', placeholder: 'tag1, tag2, tag3' });
        if (Array.isArray(current)) inp.value = current.join(', ');
        else if (current) inp.value = String(current);
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else {
        const inp = row.createEl('input', { type: 'text', cls: 'cad-form-input' });
        if (current) inp.value = String(current);
        if (f.key === primaryKey) inp.placeholder = `${def.label} name`;
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      }
    });

    // Body section — link out for full editing
    const bodyHint = root.createDiv({ cls: 'cad-detail-body-hint' });
    bodyHint.createDiv({ cls: 'cad-eyebrow', text: 'NOTE BODY' });
    bodyHint.createDiv({ cls: 'cad-detail-body-desc', text: 'Brief, milestones, notes and any other markdown lives in the note body.' });
    const openBody = bodyHint.createEl('button', { cls: 'cad-btn primary', text: 'Open as note for full editing' });
    openBody.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
  }

  /* ── Project DETAIL view (real PM surface) ─────── */
  async renderProjectDetail(root, file) {
    root.addClass('cadence-project-detail');
    const def = ENTITIES.project;
    const cache = this.app.metadataCache.getFileCache(file) || {};
    const fm = Object.assign({}, cache.frontmatter || {});
    const meta = await readProjectMeta(this.app, file);
    const titleVal = fm.name || file.basename;

    const status = String(fm.status || 'active');
    const priority = String(fm.priority || '');
    const owner = fm.owner || '';
    const due = fm.due || '';
    const started = fm.started || '';

    /* Header */
    const head = root.createDiv({ cls: 'cad-detail-header' });
    const headLeft = head.createDiv({ cls: 'cad-detail-header-left' });
    const back = headLeft.createEl('button', { cls: 'cad-btn cad-detail-back', text: '← Projects' });
    back.addEventListener('click', () => this.closeEntityDetail());
    const breadcrumb = headLeft.createDiv({ cls: 'cad-detail-breadcrumb' });
    breadcrumb.createSpan({ cls: 'cad-eyebrow', text: 'PROJECT' });
    breadcrumb.createSpan({ cls: 'cad-detail-title', text: String(titleVal) });
    breadcrumb.createDiv({ cls: 'cad-detail-path', text: file.path });

    const headRight = head.createDiv({ cls: 'cad-detail-header-right' });
    const savedBadge = headRight.createSpan({ cls: 'cad-detail-saved', text: '' });
    const flashSaved = () => {
      savedBadge.setText('Saved');
      savedBadge.addClass('show');
      clearTimeout(savedBadge._t);
      savedBadge._t = setTimeout(() => savedBadge.removeClass('show'), 1400);
    };
    const openNote = headRight.createEl('button', { cls: 'cad-btn', text: 'Open as note' });
    openNote.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
    const deleteBtn = headRight.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete' });
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete this project? This moves the file to trash.`)) return;
      try {
        await this.app.vault.trash(file, true);
        new obsidian.Notice(`Deleted project: ${file.basename}`);
        this.closeEntityDetail();
      } catch (e) {
        new obsidian.Notice(`Delete failed: ${e.message}`);
      }
    });

    /* Hero — name (already in breadcrumb), pills, meta, progress */
    const hero = root.createDiv({ cls: 'cad-pd-hero' });
    const pillRow = hero.createDiv({ cls: 'cad-pd-pills' });
    const mkSelect = (cls, options, current, onChange) => {
      const wrap = pillRow.createDiv({ cls: `cad-pd-select-wrap ${cls}` });
      const sel = wrap.createEl('select', { cls: 'cad-pd-select' });
      options.forEach((opt) => {
        const o = sel.createEl('option', { value: opt, text: opt });
        if (String(current) === opt) o.selected = true;
      });
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    };
    mkSelect('cad-pill cad-pill-' + status.toLowerCase().replace(/\s+/g, '-'),
      ['active', 'on_hold', 'backlog', 'done', 'cancelled'], status,
      (v) => this._writeProjectFrontmatter(file, { status: v }, flashSaved));
    mkSelect('cad-pill cad-pill-prio-' + (priority || 'medium').toLowerCase(),
      ['low', 'medium', 'high'], priority || 'medium',
      (v) => this._writeProjectFrontmatter(file, { priority: v }, flashSaved));

    const metaRow = hero.createDiv({ cls: 'cad-pd-meta' });
    const mkMeta = (label, key, type) => {
      const cell = metaRow.createDiv({ cls: 'cad-pd-meta-cell' });
      cell.createDiv({ cls: 'cad-pd-meta-label', text: label });
      const inp = cell.createEl('input', { type: type || 'text', cls: 'cad-pd-meta-input' });
      const cur = fm[key];
      if (type === 'date' && cur) {
        const d = new Date(cur);
        if (!isNaN(d.getTime())) inp.value = d.toISOString().slice(0, 10);
      } else if (cur != null) {
        inp.value = String(cur);
      }
      let t;
      const commit = () => this._writeProjectFrontmatter(file, { [key]: inp.value || null }, flashSaved);
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(commit, 350); });
      inp.addEventListener('blur', commit);
    };
    mkMeta('OWNER',   'owner');
    mkMeta('STARTED', 'started', 'date');
    mkMeta('DUE',     'due',     'date');

    const progWrap = hero.createDiv({ cls: 'cad-proj-progress-wrap cad-pd-progress' });
    progWrap.dataset.pctBand = pctBand(meta.percent);
    const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
    progLabel.createSpan({ text: `${meta.done}/${meta.total} milestones complete` });
    progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${meta.percent}%` });
    const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
    fill.style.width = `${meta.percent}%`;

    /* Two-column body */
    const cols = root.createDiv({ cls: 'cad-pd-cols' });
    const left = cols.createDiv({ cls: 'cad-pd-col' });
    const right = cols.createDiv({ cls: 'cad-pd-col' });

    /* ── Milestones ── */
    this._renderMilestoneSection(left, file, meta.milestones, flashSaved);

    /* ── Tasks ── */
    const taskList = parseTasksList(meta.sections['Tasks'] || '');
    this._renderTaskSection(left, file, taskList, flashSaved);

    /* ── Body sections (right column) ── */
    const bodySections = [
      { key: 'Brief',        label: 'BRIEF',        rows: 4, placeholder: 'The outcome we want, why now.' },
      { key: 'Scope',        label: 'SCOPE',        rows: 5, placeholder: 'In scope / out of scope.' },
      { key: 'Risks',        label: 'RISKS',        rows: 4, placeholder: 'What could go wrong.' },
      { key: 'Stakeholders', label: 'STAKEHOLDERS', rows: 3, placeholder: 'Who cares about this project.' },
      { key: 'Notes',        label: 'NOTES',        rows: 5, placeholder: 'Anything else.' },
    ];
    bodySections.forEach((s) => this._renderProjectTextSection(right, file, meta.sections, s, flashSaved));
  }

  _renderMilestoneSection(parent, file, milestones, flashSaved) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    const head = card.createDiv({ cls: 'cad-pd-card-head' });
    head.createDiv({ cls: 'cad-pd-card-title', text: `MILESTONES · ${milestones.filter((m) => m.done).length}/${milestones.length}` });
    const addBtn = head.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add' });

    const list = card.createDiv({ cls: 'cad-pd-checklist' });
    const renderRows = (items) => {
      list.empty();
      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: 'No milestones yet — add the first one.' });
        return;
      }
      items.forEach((m, idx) => {
        const wrapper = list.createDiv({ cls: 'cad-mile-wrapper' });
        const row = wrapper.createDiv({ cls: 'cad-pd-mile-row' + (m.done ? ' done' : '') });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = !!m.done;
        cb.addEventListener('change', async () => {
          items[idx].done = cb.checked;
          await this._commitMilestones(file, items, flashSaved);
        });
        const dateInp = row.createEl('input', { type: 'date', cls: 'cad-pd-mile-date' });
        if (m.date instanceof Date && !isNaN(m.date.getTime())) {
          dateInp.value = m.date.toISOString().slice(0, 10);
        }
        let dt;
        dateInp.addEventListener('input', () => {
          clearTimeout(dt);
          dt = setTimeout(async () => {
            items[idx].date = dateInp.value ? new Date(dateInp.value) : null;
            await this._commitMilestones(file, items, flashSaved, true);
          }, 350);
        });
        const titleInp = row.createEl('input', { type: 'text', cls: 'cad-pd-mile-title' });
        titleInp.value = m.title || '';
        titleInp.placeholder = 'Milestone title';
        let tt;
        titleInp.addEventListener('input', () => {
          clearTimeout(tt);
          tt = setTimeout(async () => {
            items[idx].title = titleInp.value;
            await this._commitMilestones(file, items, flashSaved, true);
          }, 400);
        });
        const del = row.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.title = 'Delete milestone';
        del.addEventListener('click', async () => {
          items.splice(idx, 1);
          await this._commitMilestones(file, items, flashSaved);
        });

        // Notes section — preview ⇄ textarea, indented under the milestone in markdown
        const notesEl = wrapper.createDiv({ cls: 'cad-mile-notes-section' });
        const renderNotesIdle = () => {
          notesEl.empty();
          const hasNotes = (items[idx].notes || '').trim().length > 0;
          if (hasNotes) {
            const preview = notesEl.createDiv({ cls: 'cad-mile-notes-preview' });
            preview.setText(items[idx].notes);
            preview.title = 'Click to edit notes';
            preview.addEventListener('click', openNotesEditor);
          } else {
            const addBtn = notesEl.createEl('a', { cls: 'cad-mile-notes-add', text: '+ Add notes' });
            addBtn.addEventListener('click', (e) => { e.preventDefault(); openNotesEditor(); });
          }
        };
        const openNotesEditor = () => {
          notesEl.empty();
          const ta = notesEl.createEl('textarea', { cls: 'cad-mile-notes-textarea' });
          ta.value = items[idx].notes || '';
          ta.placeholder = 'Notes — context, follow-ups, what happened…';
          const autosize = () => {
            ta.style.height = 'auto';
            ta.style.height = Math.max(60, ta.scrollHeight + 2) + 'px';
          };
          let nt;
          ta.addEventListener('input', () => {
            autosize();
            clearTimeout(nt);
            nt = setTimeout(async () => {
              items[idx].notes = ta.value;
              await this._commitMilestones(file, items, flashSaved, true);
            }, 400);
          });
          ta.addEventListener('blur', async () => {
            items[idx].notes = ta.value;
            await this._commitMilestones(file, items, flashSaved, true);
            renderNotesIdle();
          });
          setTimeout(() => { ta.focus(); autosize(); }, 0);
        };
        renderNotesIdle();
      });
    };

    renderRows(milestones);

    addBtn.addEventListener('click', async () => {
      const today = new Date();
      milestones.push({ done: false, date: today, title: '' });
      await this._commitMilestones(file, milestones, flashSaved);
    });
  }

  async _commitMilestones(file, items, flashSaved, skipRender = false) {
    const body = stringifyMilestones(items);
    const content = await this.app.vault.read(file);
    const next = replaceSection(content, '## Milestones', body || '');
    await this.app.vault.modify(file, next);
    if (typeof flashSaved === 'function') flashSaved();
    // Re-render only when needed (checkbox toggle, add, delete) — text/date
    // edits skip render so the user's input keeps focus.
    if (!skipRender) this.render();
  }

  _renderTaskSection(parent, file, tasks, flashSaved) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    const head = card.createDiv({ cls: 'cad-pd-card-head' });
    const open = tasks.filter((t) => !t.done).length;
    head.createDiv({ cls: 'cad-pd-card-title', text: `TASKS · ${open} open · ${tasks.length - open} done` });
    const addBtn = head.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add' });

    const list = card.createDiv({ cls: 'cad-pd-checklist' });
    const renderRows = (items) => {
      list.empty();
      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: 'No tasks yet.' });
        return;
      }
      items.forEach((t, idx) => {
        const row = list.createDiv({ cls: 'cad-pd-task-row' + (t.done ? ' done' : '') });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = !!t.done;
        cb.addEventListener('change', async () => {
          items[idx].done = cb.checked;
          await this._commitTasks(file, items, flashSaved);
          const txt = (items[idx].title || '').trim();
          if (txt) await this._propagateTaskComplete(txt, cb.checked, { kind: 'project', file });
        });
        const titleInp = row.createEl('input', { type: 'text', cls: 'cad-pd-task-title' });
        titleInp.value = t.title || '';
        titleInp.placeholder = 'Task description';
        let tt;
        titleInp.addEventListener('input', () => {
          clearTimeout(tt);
          tt = setTimeout(async () => {
            items[idx].title = titleInp.value;
            await this._commitTasks(file, items, flashSaved, true);
          }, 400);
        });

        /* Bell — set or edit a reminder linked to this task. */
        const linked = findProjectTaskReminder(this.plugin, file.path, t.title || '');
        const bell = row.createEl('button', {
          cls: 'cad-btn cad-btn-sm cad-pd-task-bell' + (linked ? ' linked' : ''),
          text: linked ? '🔔' : '🔕',
        });
        bell.title = linked
          ? `Edit reminder${linked.when ? ' · ' + reminderTimeStr(linked.when) : ''}`
          : 'Set a reminder for this task';
        bell.addEventListener('click', async () => {
          // Always commit any pending title edit first so the link key is fresh
          items[idx].title = titleInp.value;
          await this._commitTasks(file, items, flashSaved, true);

          const taskText = titleInp.value.trim();
          if (!taskText) {
            new obsidian.Notice('Add a task title first.');
            titleInp.focus();
            return;
          }
          const existing = findProjectTaskReminder(this.plugin, file.path, taskText);
          if (existing) {
            new CadenceReminderEditModal(this.app, this.plugin, existing).open();
          } else {
            new CadenceReminderEditModal(this.app, this.plugin, {
              text: taskText,
              when: null,
              repeat: 'none',
              notes: '',
              project: file.path,
            }, { isNew: true }).open();
          }
        });

        const del = row.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.addEventListener('click', async () => {
          items.splice(idx, 1);
          await this._commitTasks(file, items, flashSaved);
        });
      });
    };

    renderRows(tasks);

    addBtn.addEventListener('click', async () => {
      tasks.push({ done: false, title: '' });
      await this._commitTasks(file, tasks, flashSaved);
    });
  }

  async _commitTasks(file, items, flashSaved, skipRender = false) {
    const body = stringifyTasks(items);
    const content = await this.app.vault.read(file);
    const next = replaceSection(content, '## Tasks', body || '');
    await this.app.vault.modify(file, next);
    if (typeof flashSaved === 'function') flashSaved();
    if (!skipRender) this.render();
  }

  _renderProjectTextSection(parent, file, sections, def, flashSaved) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    card.createDiv({ cls: 'cad-pd-card-head' }).createDiv({ cls: 'cad-pd-card-title', text: def.label });
    const ta = card.createEl('textarea', { cls: 'cad-pd-textarea' });
    ta.placeholder = def.placeholder || '';
    ta.rows = def.rows || 4;
    const initial = (sections[def.key] || '').replace(/^\s+|\s+$/g, '');
    ta.value = initial;
    let tmr;
    ta.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(async () => {
        const content = await this.app.vault.read(file);
        const next = replaceSection(content, `## ${def.key}`, ta.value || '');
        await this.app.vault.modify(file, next);
        flashSaved();
      }, 500);
    });
  }

  async _writeProjectFrontmatter(file, patch, flashSaved) {
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        Object.entries(patch).forEach(([k, v]) => {
          if (v == null || v === '') delete fm[k];
          else fm[k] = v;
        });
      });
      if (typeof flashSaved === 'function') flashSaved();
    } catch (e) {
      new obsidian.Notice(`Save failed: ${e.message}`);
    }
  }

  /* ── Projects: rich card grid with milestone progress ─ */
  async renderProjectsView(root) {
    root.addClass('cadence-projects');
    const def = ENTITIES.project;
    const files = listEntityFiles(this.app, 'project');

    this._renderPageHeader(root, 'Projects', `${files.length} ${files.length === 1 ? 'project' : 'projects'} in ${def.folder}`, (right) => {
      const importBtn = right.createEl('button', { cls: 'cad-btn', text: 'Import CSV' });
      importBtn.addEventListener('click', () => new CadenceImportModal(this.app, { entityKey: 'project' }).open());
      const btn = right.createEl('button', { cls: 'cad-btn primary', text: '+ New Project' });
      btn.addEventListener('click', () => this._createEntityFromPrompt('project'));
    });

    if (!files.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: 'No projects yet' });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: 'Hit "+ New Project" — you\'ll get a templated note with Brief, Scope, Milestones, Tasks, Risks and Stakeholders sections ready to fill in.' });
      return;
    }

    const projects = await Promise.all(files.map(async (f) => {
      const e = readEntity(this.app, f);
      const meta = await readProjectMeta(this.app, f);
      return { entity: e, meta };
    }));

    // Group by status
    const groups = { active: [], on_hold: [], backlog: [], done: [], cancelled: [] };
    projects.forEach((p) => {
      const status = String(entityValue(p.entity, 'status', def) || 'active').toLowerCase().replace(/\s+/g, '_');
      const key = groups[status] ? status : 'active';
      groups[key].push(p);
    });

    const grid = root.createDiv({ cls: 'cad-proj-grid' });
    const renderCard = (p) => {
      const card = grid.createDiv({ cls: 'cad-proj-card' });
      const head = card.createDiv({ cls: 'cad-proj-card-head' });
      const title = head.createEl('a', { cls: 'cad-proj-title', text: entityValue(p.entity, 'name', def) || p.entity.basename });
      title.addEventListener('click', (ev) => { ev.preventDefault(); this.openEntityDetail('project', p.entity.file); });
      const status = String(entityValue(p.entity, 'status', def) || 'active');
      const priority = String(entityValue(p.entity, 'priority', def) || '');
      const pillRow = head.createDiv({ cls: 'cad-proj-pills' });
      pillRow.createSpan({ cls: `cad-pill cad-pill-${status.toLowerCase().replace(/\s+/g, '-')}`, text: status });
      if (priority) pillRow.createSpan({ cls: `cad-pill cad-pill-prio-${priority.toLowerCase()}`, text: priority });

      const metaRow = card.createDiv({ cls: 'cad-proj-meta' });
      const owner = entityValue(p.entity, 'owner', def);
      const due = entityValue(p.entity, 'due', def);
      if (owner) metaRow.createSpan({ text: `Owner: ${owner}` });
      if (due) metaRow.createSpan({ text: `Due: ${fmtValue(due, 'date')}` });

      // Progress
      const progWrap = card.createDiv({ cls: 'cad-proj-progress-wrap' });
      progWrap.dataset.pctBand = pctBand(p.meta.percent);
      const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
      progLabel.createSpan({ text: `${p.meta.done}/${p.meta.total} milestones` });
      progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${p.meta.percent}%` });
      const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
      const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
      fill.style.width = `${p.meta.percent}%`;

      // Next milestone
      if (p.meta.next) {
        const nextRow = card.createDiv({ cls: 'cad-proj-next' });
        nextRow.createSpan({ cls: 'cad-proj-next-label', text: 'NEXT · ' });
        nextRow.createSpan({ cls: 'cad-proj-next-date', text: fmtValue(p.meta.next.date, 'date') });
        if (p.meta.next.title) nextRow.createSpan({ text: ` — ${p.meta.next.title}` });
      }
    };

    const renderSection = (label, list) => {
      if (!list.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: label });
      list.forEach(renderCard);
    };

    // We render section labels by intercepting renderCard placement
    // Reset grid: render in groups
    grid.remove();
    const order = ['active', 'on_hold', 'backlog', 'done', 'cancelled'];
    const sectionLabels = { active: 'ACTIVE', on_hold: 'ON HOLD', backlog: 'BACKLOG', done: 'DONE', cancelled: 'CANCELLED' };
    order.forEach((key) => {
      const list = groups[key];
      if (!list.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: sectionLabels[key] });
      const section = root.createDiv({ cls: 'cad-proj-grid' });
      list.forEach((p) => {
        const card = section.createDiv({ cls: 'cad-proj-card' });
        const head = card.createDiv({ cls: 'cad-proj-card-head' });
        const title = head.createEl('a', { cls: 'cad-proj-title', text: entityValue(p.entity, 'name', def) || p.entity.basename });
        title.addEventListener('click', (ev) => { ev.preventDefault(); this.openEntityDetail('project', p.entity.file); });
        const status = String(entityValue(p.entity, 'status', def) || 'active');
        const priority = String(entityValue(p.entity, 'priority', def) || '');
        const pillRow = head.createDiv({ cls: 'cad-proj-pills' });
        pillRow.createSpan({ cls: `cad-pill cad-pill-${status.toLowerCase().replace(/\s+/g, '-')}`, text: status });
        if (priority) pillRow.createSpan({ cls: `cad-pill cad-pill-prio-${priority.toLowerCase()}`, text: priority });

        const metaRow = card.createDiv({ cls: 'cad-proj-meta' });
        const owner = entityValue(p.entity, 'owner', def);
        const due = entityValue(p.entity, 'due', def);
        if (owner) metaRow.createSpan({ text: `Owner: ${owner}` });
        if (due) metaRow.createSpan({ text: `Due: ${fmtValue(due, 'date')}` });

        const progWrap = card.createDiv({ cls: 'cad-proj-progress-wrap' });
        const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
        progLabel.createSpan({ text: `${p.meta.done}/${p.meta.total} milestones` });
        progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${p.meta.percent}%` });
        const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
        const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
        fill.style.width = `${p.meta.percent}%`;

        if (p.meta.next) {
          const nextRow = card.createDiv({ cls: 'cad-proj-next' });
          nextRow.createSpan({ cls: 'cad-proj-next-label', text: 'NEXT · ' });
          nextRow.createSpan({ cls: 'cad-proj-next-date', text: fmtValue(p.meta.next.date, 'date') });
          if (p.meta.next.title) nextRow.createSpan({ text: ` — ${p.meta.next.title}` });
        }
      });
    });
  }

  /* ── Home / Command Centre ───────────────── */
  async renderHome(root) {
    root.addClass('cadence-home');
    const settings = this.plugin.settings;

    /* Header */
    const today = new Date();
    const dateStr = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    this._renderPageHeader(root, `${greeting()}.`, dateStr, (right) => {
      const mk = (label, fn) => {
        const b = right.createEl('button', { cls: 'cad-btn', text: label });
        b.addEventListener('click', fn);
        return b;
      };
      mk('+ Task', () => this._quickAddTodayTask());
      mk('+ Deal', () => this._createEntityFromPrompt('deal'));
      mk('+ Contact', () => this._createEntityFromPrompt('contact'));
      mk('+ Project', () => this._createEntityFromPrompt('project'));
      const newInbox = mk('+ Inbox', () => this.plugin.openQuickCapture());
      newInbox.classList.add('primary');
    });

    /* Two-column grid */
    const cols = root.createDiv({ cls: 'cad-home-cols' });
    const left = cols.createDiv({ cls: 'cad-home-col' });
    const right = cols.createDiv({ cls: 'cad-home-col' });

    /* ─── LEFT: Inbox + Today + Week + Upcoming + Partners ─── */
    await this._homeInboxCard(left);
    await this._homeTodayCard(left);
    await this._homeWeekCard(left);
    await this._homeUpcomingCard(left);
    await this._homePartnersCard(left);

    /* ─── RIGHT: Projects + Pipeline + Activities ─── */
    await this._homeProjectsCard(right);
    await this._homePipelineCard(right);
    await this._homeActivitiesCard(right);
  }

  _homeCard(parent, title, action, tone) {
    const card = parent.createDiv({ cls: 'cad-home-card' });
    if (tone) card.dataset.tone = tone;
    const head = card.createDiv({ cls: 'cad-home-card-head' });
    head.createDiv({ cls: 'cad-home-card-title', text: title });
    if (typeof action === 'function') action(head);
    return card.createDiv({ cls: 'cad-home-card-body' });
  }

  async _homeInboxCard(parent) {
    const reminders = (this.plugin.settings.reminders || []).filter((r) => !r.done);
    const overdueCount = reminders.filter((r) => r.when && new Date(r.when).getTime() <= Date.now()).length;
    const tone = overdueCount > 0 ? 'rose' : 'sky';

    const headTitle = `INBOX — ${reminders.length} item${reminders.length === 1 ? '' : 's'}${overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}`;
    const body = this._homeCard(parent, headTitle, (head) => {
      const cap = head.createEl('a', { cls: 'cad-home-card-link', text: '+ Capture' });
      cap.style.marginRight = '12px';
      cap.addEventListener('click', (e) => { e.preventDefault(); this.plugin.openQuickCapture(); });
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Inbox →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('planner.inbox'); });
    }, tone);

    if (!reminders.length) {
      body.createDiv({ cls: 'cad-empty', text: 'Inbox zero — capture anything with + Inbox above (or Cmd+Shift+I).' });
      return;
    }

    // Sort: scheduled by when ascending, unscheduled fall to the end
    const sorted = [...reminders].sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      return wa - wb;
    });

    sorted.slice(0, 5).forEach((r) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      const isOverdue = r.when && new Date(r.when).getTime() <= Date.now();
      if (isOverdue) row.classList.add('overdue');
      row.createDiv({ cls: 'cad-home-row-date', text: r.when ? reminderTimeStr(r.when) : 'unscheduled' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: r.text });
      const metaBits = [];
      if (r.project) metaBits.push(`📁 ${projectNameFromPath(this.app, r.project) || 'project'}`);
      if (r.repeat && r.repeat !== 'none') metaBits.push(r.repeat === 'daily' ? '↻ daily' : '↻ weekly');
      if (r.notes) {
        const firstLine = String(r.notes).split('\n').find((l) => l.trim()) || '';
        if (firstLine) metaBits.push(`📝 ${firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine}`);
      }
      if (metaBits.length) main.createDiv({ cls: 'cad-home-row-meta', text: metaBits.join('  ·  ') });
      row.addEventListener('click', () => new CadenceReminderEditModal(this.app, this.plugin, r).open());
    });
  }

  async _homeTodayCard(parent) {
    const file = await ensureDailyNote(this.app, this.plugin.settings);
    const content = await this.app.vault.read(file);
    const parsed = parseSections(content, this.plugin.settings);
    const open = parsed.tasks.filter((l) => / \[ \] /.test(l));
    const done = parsed.tasks.filter((l) => / \[(x|X)\] /.test(l));

    const body = this._homeCard(parent, `TODAY — ${open.length} open · ${done.length} done`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Today →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('planner.today'); });
    }, 'emerald');

    if (!parsed.tasks.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No tasks yet — add one with + Task above.' });
      return;
    }
    parsed.tasks.forEach((rawLine, idx) => {
      const checked = / \[(x|X)\] /.test(rawLine);
      const text = rawLine.replace(/^\s*-\s\[(x|X| )\]\s/, '');
      const row = body.createDiv({ cls: 'cad-home-task' + (checked ? ' done' : '') });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = checked;
      cb.addEventListener('change', async () => {
        const cur = await this.app.vault.read(file);
        const cp = parseSections(cur, this.plugin.settings);
        const taskLine = cp.tasks[idx] || '';
        const taskText = taskLine.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
        const newTasks = cp.tasks.map((line, i) => {
          if (i !== idx) return line;
          return cb.checked
            ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
            : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
        });
        const next = replaceSection(cur, this.plugin.settings.tasksHeading, newTasks.join('\n'));
        await this.app.vault.modify(file, next);
        if (taskText) {
          await this._propagateTaskComplete(taskText, cb.checked, { kind: 'daily', file, date: new Date() });
        }
      });
      row.createSpan({ text });
    });
  }

  async _homeWeekCard(parent) {
    const settings = this.plugin.settings;
    const weekStart = startOfWeek(new Date(), settings.weekStartsOn);
    let open = 0, done = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const f = this.app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
      if (f && f instanceof obsidian.TFile) {
        const c = await this.app.vault.read(f);
        const p = parseSections(c, settings);
        p.tasks.forEach((l) => { if (/ \[(x|X)\] /.test(l)) done++; else if (/ \[ \] /.test(l)) open++; });
      }
    }
    const total = open + done;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    const body = this._homeCard(parent, `THIS WEEK — ${done}/${total} done`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Calendar →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('planner.calendar'); });
    }, 'mint');

    const wrap = body.createDiv({ cls: 'cad-proj-progress-wrap' });
    wrap.dataset.pctBand = pctBand(pct);
    const lbl = wrap.createDiv({ cls: 'cad-proj-progress-label' });
    lbl.createSpan({ text: total ? `${done} of ${total} tasks completed` : 'No tasks logged this week yet' });
    lbl.createSpan({ cls: 'cad-proj-progress-pct', text: `${pct}%` });
    const bar = wrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
    fill.style.width = `${pct}%`;
  }

  async _homeUpcomingCard(parent) {
    const today = startOfDay(new Date());
    const horizon = addDays(today, 7);
    const items = [];

    // Project deadlines
    const projects = listEntities(this.app, 'project');
    projects.forEach((e) => {
      const due = entityValue(e, 'due', ENTITIES.project);
      if (!due) return;
      const d = new Date(due);
      if (isNaN(d.getTime())) return;
      if (d >= today && d <= horizon) {
        items.push({ date: d, title: entityValue(e, 'name', ENTITIES.project) || e.basename, type: 'Project due', file: e.file });
      }
    });
    // Project milestones (next upcoming per project)
    for (const e of projects) {
      try {
        const meta = await readProjectMeta(this.app, e.file);
        if (meta.next && meta.next.date && meta.next.date >= today && meta.next.date <= horizon) {
          items.push({ date: meta.next.date, title: `${entityValue(e, 'name', ENTITIES.project) || e.basename} — ${meta.next.title || 'milestone'}`, type: 'Milestone', file: e.file });
        }
      } catch (_) {}
    }
    // Registration expiries
    listEntities(this.app, 'registration').forEach((e) => {
      const exp = entityValue(e, 'expires', ENTITIES.registration);
      if (!exp) return;
      const d = new Date(exp);
      if (isNaN(d.getTime())) return;
      if (d >= today && d <= horizon) {
        items.push({ date: d, title: entityValue(e, 'title', ENTITIES.registration) || e.basename, type: 'Registration expires', file: e.file });
      }
    });
    // Cert expiries
    listEntities(this.app, 'certification').forEach((e) => {
      const exp = entityValue(e, 'expires', ENTITIES.certification);
      if (!exp) return;
      const d = new Date(exp);
      if (isNaN(d.getTime())) return;
      if (d >= today && d <= horizon) {
        items.push({ date: d, title: entityValue(e, 'name', ENTITIES.certification) || e.basename, type: 'Cert expires', file: e.file });
      }
    });

    items.sort((a, b) => a.date - b.date);
    const body = this._homeCard(parent, `UPCOMING · NEXT 7 DAYS — ${items.length}`, undefined, 'warn');
    if (!items.length) {
      body.createDiv({ cls: 'cad-empty', text: 'Nothing on the radar.' });
      return;
    }
    items.slice(0, 6).forEach((it) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      row.createDiv({ cls: 'cad-home-row-date', text: fmtValue(it.date, 'date') });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: it.title });
      main.createDiv({ cls: 'cad-home-row-meta', text: it.type });
      row.addEventListener('click', () => this.openEntityDetailFromFile(it.file));
    });
  }

  async _homePartnersCard(parent) {
    const partners = listEntities(this.app, 'partner');
    const body = this._homeCard(parent, `PARTNERS — ${partners.length}`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Partners →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('prm.partners'); });
    }, 'sky');
    if (!partners.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No partners on the books yet.' });
      return;
    }
    partners.slice(0, 5).forEach((e) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: entityValue(e, 'name', ENTITIES.partner) || e.basename });
      const tier = entityValue(e, 'tier', ENTITIES.partner) || '';
      const status = entityValue(e, 'status', ENTITIES.partner) || '';
      main.createDiv({ cls: 'cad-home-row-meta', text: [tier, status].filter(Boolean).join(' · ') });
      row.addEventListener('click', () => this.openEntityDetailFromFile(e.file));
    });
  }

  async _homeProjectsCard(parent) {
    const def = ENTITIES.project;
    const files = listEntityFiles(this.app, 'project');
    const body = this._homeCard(parent, `ACTIVE PROJECTS — ${files.length}`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Projects →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('planner.projects'); });
    }, 'emerald');
    if (!files.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No projects yet — hit + Project above.' });
      return;
    }
    const projects = await Promise.all(files.map(async (f) => {
      const e = readEntity(this.app, f);
      const status = String(entityValue(e, 'status', def) || 'active').toLowerCase();
      if (!['active', 'on_hold', 'in_progress'].includes(status.replace(/\s+/g, '_'))) return null;
      const meta = await readProjectMeta(this.app, f);
      return { entity: e, meta };
    }));
    const active = projects.filter(Boolean).slice(0, 3);
    if (!active.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No active projects right now.' });
      return;
    }
    active.forEach((p) => {
      const row = body.createDiv({ cls: 'cad-home-proj' });
      row.dataset.pctBand = pctBand(p.meta.percent);
      const head = row.createDiv({ cls: 'cad-home-proj-head' });
      head.createSpan({ cls: 'cad-home-proj-title', text: entityValue(p.entity, 'name', def) || p.entity.basename });
      head.createSpan({ cls: 'cad-home-proj-pct', text: `${p.meta.percent}%` });
      const bar = row.createDiv({ cls: 'cad-proj-progress-bar' });
      const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
      fill.style.width = `${p.meta.percent}%`;
      if (p.meta.next) {
        row.createDiv({ cls: 'cad-home-row-meta', text: `NEXT · ${fmtValue(p.meta.next.date, 'date')}${p.meta.next.title ? ' — ' + p.meta.next.title : ''}` });
      }
      row.addEventListener('click', () => this.openEntityDetail('project', p.entity.file));
    });
  }

  async _homePipelineCard(parent) {
    const def = ENTITIES.deal;
    const deals = listEntities(this.app, 'deal');
    const open = deals.filter((e) => !['Won', 'Lost'].includes(String(entityValue(e, 'stage', def))));
    const value = open.reduce((s, e) => s + (Number(entityValue(e, 'value', def)) || 0), 0);

    const body = this._homeCard(parent, `PIPELINE — ${open.length} open · ${fmtValue(value, 'currency')}`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Pipeline →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('crm.pipeline'); });
    }, 'sky');
    if (!open.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No open deals — hit + Deal above.' });
      return;
    }
    const top = [...open].sort((a, b) => (Number(entityValue(b, 'value', def)) || 0) - (Number(entityValue(a, 'value', def)) || 0)).slice(0, 4);
    top.forEach((e) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: entityValue(e, 'title', def) || e.basename });
      const stage = entityValue(e, 'stage', def);
      main.createDiv({ cls: 'cad-home-row-meta', text: `${stage || '—'} · ${fmtValue(entityValue(e, 'value', def), 'currency')}` });
      row.addEventListener('click', () => this.openEntityDetailFromFile(e.file));
    });
  }

  async _homeActivitiesCard(parent) {
    const def = ENTITIES.activity;
    const acts = listEntities(this.app, 'activity');
    const body = this._homeCard(parent, `RECENT ACTIVITY — ${acts.length}`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Activities →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('crm.activities'); });
    }, 'rose');
    if (!acts.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No activities logged yet.' });
      return;
    }
    const sorted = [...acts].sort((a, b) => {
      const da = new Date(entityValue(a, 'when', def) || 0).getTime();
      const db = new Date(entityValue(b, 'when', def) || 0).getTime();
      return db - da;
    }).slice(0, 5);
    sorted.forEach((e) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: entityValue(e, 'subject', def) || e.basename });
      main.createDiv({ cls: 'cad-home-row-meta', text: `${entityValue(e, 'type', def) || '—'} · ${fmtValue(entityValue(e, 'when', def), 'date')}` });
      row.addEventListener('click', () => this.openEntityDetailFromFile(e.file));
    });
  }

  /* ── Inbox (Planner reminders + captures) ── */
  async renderInbox(root) {
    root.addClass('cadence-inbox');
    const all = (this.plugin.settings.reminders || []).filter((r) => !r.done);

    // Sort: scheduled by when, captures by createdAt
    all.sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      if (wa !== wb) return wa - wb;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return cb - ca;
    });

    // Bucket
    const buckets = { now: [], today: [], week: [], later: [] };
    all.forEach((r) => buckets[reminderBucket(r.when)].push(r));

    this._renderPageHeader(root, 'Inbox', `${all.length} ${all.length === 1 ? 'item' : 'items'} · capture once, surface at the right time`, (right) => {
      const captureBtn = right.createEl('button', { cls: 'cad-btn primary', text: '+ Quick capture' });
      captureBtn.addEventListener('click', () => this.plugin.openQuickCapture());
    });

    if (!all.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: 'Inbox zero' });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: 'Capture anything with + Quick capture above (or Cmd+Shift+I). Add a time and Cadence will remind you.' });
      return;
    }

    const sectionLabels = { now: 'NOW · OVERDUE OR DUE WITHIN 1 HOUR', today: 'TODAY', week: 'THIS WEEK', later: 'LATER · UNSCHEDULED' };
    ['now', 'today', 'week', 'later'].forEach((key) => {
      const items = buckets[key];
      if (!items.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: `${sectionLabels[key]} · ${items.length}` });
      const list = root.createDiv({ cls: 'cad-inbox-list' });
      items.forEach((r) => this._renderInboxRow(list, r, key));
    });

    /* ── PROJECT TASKS — every open `- [ ]` from every project's ## Tasks ── */
    await this._renderProjectTasksSection(root);
  }

  async _renderProjectTasksSection(root) {
    const projectFiles = listEntityFiles(this.app, 'project');
    if (!projectFiles.length) return;

    /* Read each project's Tasks section + collect open tasks */
    const groups = [];
    let totalOpen = 0;
    for (const file of projectFiles) {
      let content;
      try { content = await this.app.vault.read(file); }
      catch (_) { continue; }
      const sections = parseH2Sections(content);
      const tasksText = sections['Tasks'] || '';
      if (!tasksText.trim()) continue;
      const tasks = parseTasksList(tasksText);
      const open = tasks.filter((t) => !t.done && t.title);
      if (!open.length) continue;
      totalOpen += open.length;
      groups.push({
        file,
        name: projectNameFromPath(this.app, file.path),
        tasks: open,
      });
    }

    if (!totalOpen) return;

    root.createDiv({ cls: 'cad-section-label-lg', text: `PROJECT TASKS · ${totalOpen} open across ${groups.length} ${groups.length === 1 ? 'project' : 'projects'}` });
    const wrap = root.createDiv({ cls: 'cad-pt-wrap' });

    groups.forEach((g) => {
      const card = wrap.createDiv({ cls: 'cad-pt-group' });
      const head = card.createDiv({ cls: 'cad-pt-group-head' });
      const link = head.createEl('a', { cls: 'cad-pt-group-link', text: '📁 ' + g.name });
      link.addEventListener('click', (e) => { e.preventDefault(); this.openEntityDetail('project', g.file); });
      head.createSpan({ cls: 'cad-pt-group-meta', text: `${g.tasks.length} open` });

      const list = card.createDiv({ cls: 'cad-pt-list' });
      g.tasks.forEach((t) => {
        const linked = findProjectTaskReminder(this.plugin, g.file.path, t.title);
        const row = list.createDiv({ cls: 'cad-pt-row' });
        row.createSpan({ cls: 'cad-pt-bullet', text: '•' });
        const txt = row.createSpan({ cls: 'cad-pt-text', text: t.title });
        void txt;
        if (linked && linked.when) {
          row.createSpan({ cls: 'cad-pt-when', text: reminderTimeStr(linked.when) });
        }
        const bell = row.createEl('button', {
          cls: 'cad-btn cad-btn-sm cad-pt-bell' + (linked ? ' linked' : ''),
          text: linked ? '🔔' : '🔕',
        });
        bell.title = linked ? 'Edit reminder' : 'Set a reminder';
        bell.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const existing = findProjectTaskReminder(this.plugin, g.file.path, t.title);
          if (existing) {
            new CadenceReminderEditModal(this.app, this.plugin, existing).open();
          } else {
            new CadenceReminderEditModal(this.app, this.plugin, {
              text: t.title,
              when: null,
              repeat: 'none',
              notes: '',
              project: g.file.path,
            }, { isNew: true }).open();
          }
        });
        row.addEventListener('click', () => this.openEntityDetail('project', g.file));
      });
    });
  }

  _renderInboxRow(parent, r, bucket) {
    const row = parent.createDiv({ cls: 'cad-inbox-row' + (bucket === 'now' ? ' overdue' : '') });

    const left = row.createDiv({ cls: 'cad-inbox-row-left' });
    const tWrap = left.createDiv({ cls: 'cad-inbox-time' });
    if (r.when) {
      tWrap.createSpan({ cls: 'cad-inbox-time-text', text: reminderTimeStr(r.when) });
      if (r.repeat && r.repeat !== 'none') {
        tWrap.createSpan({ cls: 'cad-inbox-repeat', text: r.repeat === 'daily' ? '↻ daily' : '↻ weekly' });
      }
    } else {
      tWrap.createSpan({ cls: 'cad-inbox-time-text muted', text: 'unscheduled' });
    }

    const main = row.createDiv({ cls: 'cad-inbox-row-main' });
    main.createDiv({ cls: 'cad-inbox-row-text', text: r.text });

    if (r.project) {
      const chipRow = main.createDiv({ cls: 'cad-inbox-row-meta-row' });
      const chip = chipRow.createEl('a', { cls: 'cad-rem-project-chip', text: '📁 ' + (projectNameFromPath(this.app, r.project) || 'Project') });
      chip.title = 'Open project';
      chip.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const file = this.app.vault.getAbstractFileByPath(r.project);
        if (file && file instanceof obsidian.TFile) this.openEntityDetail('project', file);
      });
    }

    if (r.notes) {
      const previewLine = String(r.notes).split('\n').find((l) => l.trim()) || '';
      if (previewLine) {
        const note = main.createDiv({ cls: 'cad-inbox-row-notes' });
        note.createSpan({ cls: 'cad-inbox-row-notes-icon', text: '📝 ' });
        note.appendText(previewLine.length > 120 ? previewLine.slice(0, 117) + '…' : previewLine);
      }
    }

    // Row body click → open edit modal
    const openEdit = () => new CadenceReminderEditModal(this.app, this.plugin, r).open();
    left.addEventListener('click', openEdit);
    main.addEventListener('click', openEdit);
    left.style.cursor = 'pointer';
    main.style.cursor = 'pointer';

    const actions = row.createDiv({ cls: 'cad-inbox-actions' });
    const mk = (label, title, fn) => {
      const b = actions.createEl('button', { cls: 'cad-btn cad-btn-sm', text: label });
      b.title = title;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      return b;
    };
    if (r.when) {
      mk('+15m',  'Snooze 15 minutes', () => this.plugin.snoozeReminder(r.id, 15 * 60 * 1000));
      mk('+1h',   'Snooze 1 hour',     () => this.plugin.snoozeReminder(r.id, 60 * 60 * 1000));
      mk('Tom.',  'Snooze to tomorrow 9am', () => {
        const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
        this.plugin.updateReminder(r.id, { when: d.toISOString(), notified: false });
      });
    } else {
      mk('Schedule', 'Add a time', () => openEdit());
    }
    mk('Edit', 'Edit details + notes', () => openEdit());
    const doneBtn = mk('Done', 'Mark done', async () => {
      await this.plugin.completeReminder(r.id);
      if (r.text) await this._propagateTaskComplete(r.text, true, { kind: 'reminder', id: r.id });
    });
    doneBtn.classList.add('primary');
    const delBtn = mk('×', 'Delete', () => {
      if (confirm('Delete this reminder?')) this.plugin.deleteReminder(r.id);
    });
    delBtn.classList.add('cad-btn-danger');
  }

  async _quickAddTodayTask() {
    const text = await this._prompt({
      title: 'Quick add — today',
      placeholder: 'What needs doing?',
      cta: 'Add task',
    });
    if (!text) return;
    const file = await ensureDailyNote(this.app, this.plugin.settings);
    const content = await this.app.vault.read(file);
    const parsed = parseSections(content, this.plugin.settings);
    const newTasks = [...parsed.tasks, `- [ ] ${text}`];
    const next = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(file, next);
    new obsidian.Notice('Added to today');
  }

  /* ── Pipeline kanban (deals grouped by stage) ───── */
  async renderEntityKanban(root, entityKey, groupBy, groups) {
    root.addClass('cadence-kanban');
    const def = ENTITIES[entityKey];
    const entities = listEntities(this.app, entityKey);
    const totalValue = entities.reduce((sum, e) => sum + (Number(entityValue(e, 'value', def)) || 0), 0);

    this._renderPageHeader(root, def.plural, `${entities.length} ${entities.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} · ${fmtValue(totalValue, 'currency')} total`, (right) => {
      const importBtn = right.createEl('button', { cls: 'cad-btn', text: 'Import CSV' });
      importBtn.addEventListener('click', () => new CadenceImportModal(this.app, { entityKey }).open());
      const btn = right.createEl('button', { cls: 'cad-btn primary', text: `+ New ${def.label}` });
      btn.addEventListener('click', () => this._createEntityFromPrompt(entityKey));
    });

    const board = root.createDiv({ cls: 'cad-kanban-board' });
    groups.forEach((stage) => {
      const items = entities.filter((e) => String(entityValue(e, groupBy, def) || '') === stage);
      const stageValue = items.reduce((s, e) => s + (Number(entityValue(e, 'value', def)) || 0), 0);

      const col = board.createDiv({ cls: 'cad-kanban-col' });
      col.dataset.stage = stage;
      const head = col.createDiv({ cls: 'cad-kanban-col-head' });
      head.createDiv({ cls: 'cad-kanban-col-title', text: stage });
      head.createDiv({ cls: 'cad-kanban-col-meta', text: `${items.length} · ${fmtValue(stageValue, 'currency')}` });

      const list = col.createDiv({ cls: 'cad-kanban-col-list' });

      // Drop target: drop a card here to update its `groupBy` field to this stage.
      list.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
        col.addClass('drag-over');
      });
      list.addEventListener('dragleave', (ev) => {
        // Only clear when leaving the column entirely
        if (!col.contains(ev.relatedTarget)) col.removeClass('drag-over');
      });
      list.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        col.removeClass('drag-over');
        const path = ev.dataTransfer.getData('text/cadence-entity');
        const fromStage = ev.dataTransfer.getData('text/cadence-stage');
        if (!path || fromStage === stage) return;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file || !(file instanceof obsidian.TFile)) return;
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => { fm[groupBy] = stage; });
          new obsidian.Notice(`Moved to ${stage}`);
          // The metadataCache.changed listener re-renders for us.
        } catch (e) {
          new obsidian.Notice(`Failed to move: ${e.message}`);
        }
      });

      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: '—' });
      } else {
        items.forEach((e) => {
          const card = list.createDiv({ cls: 'cad-kanban-card' });
          card.draggable = true;
          card.dataset.path = e.file.path;
          card.createDiv({ cls: 'cad-kanban-card-title', text: entityValue(e, 'title', def) || e.basename });
          const meta = card.createDiv({ cls: 'cad-kanban-card-meta' });
          const v = entityValue(e, 'value', def);
          if (v) meta.createSpan({ cls: 'cad-kanban-card-value', text: fmtValue(v, 'currency') });
          const co = entityValue(e, 'company', def);
          if (co) meta.createSpan({ cls: 'cad-kanban-card-company', text: ' · ' + co });

          card.addEventListener('dragstart', (ev) => {
            card.addClass('dragging');
            try {
              ev.dataTransfer.effectAllowed = 'move';
              ev.dataTransfer.setData('text/cadence-entity', e.file.path);
              ev.dataTransfer.setData('text/cadence-stage', stage);
              // Plain text payload too, so dropping into editors yields a link
              ev.dataTransfer.setData('text/plain', `[[${e.file.basename}]]`);
            } catch (_) {}
          });
          card.addEventListener('dragend', () => card.removeClass('dragging'));
          card.addEventListener('click', () => this.openEntityDetail(entityKey, e.file));
        });
      }
    });
  }

  /* ── CRM Dashboard ──────────────────────── */
  async renderDashboard(root) {
    root.addClass('cadence-dashboard');

    // ─── Read all the relevant data ────────────────────
    const dealDef = ENTITIES.deal;
    const allDeals = listEntities(this.app, 'deal');
    const open = allDeals.filter((e) => !['Won', 'Lost'].includes(String(entityValue(e, 'stage', dealDef))));
    const won  = allDeals.filter((e) => String(entityValue(e, 'stage', dealDef)) === 'Won');
    const lost = allDeals.filter((e) => String(entityValue(e, 'stage', dealDef)) === 'Lost');
    const dealValue = (e) => Number(entityValue(e, 'value', dealDef)) || 0;
    const sumVal = (arr) => arr.reduce((s, e) => s + dealValue(e), 0);
    const winRate = won.length + lost.length === 0 ? 0 : Math.round((won.length / (won.length + lost.length)) * 100);
    const avgDeal = won.length === 0 ? 0 : sumVal(won) / won.length;

    const contacts  = listEntityFiles(this.app, 'contact');
    const companies = listEntityFiles(this.app, 'company');
    const partners  = listEntityFiles(this.app, 'partner');
    const activities = listEntities(this.app, 'activity');

    // ─── Header ────────────────────────────────────────
    this._renderPageHeader(root, 'CRM Dashboard', 'Pipeline · momentum · recent activity', (right) => {
      const newDeal = right.createEl('button', { cls: 'cad-btn primary', text: '+ New Deal' });
      newDeal.addEventListener('click', () => this._createEntityFromPrompt('deal'));
    });

    // ─── Top stats (5 cards) ───────────────────────────
    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('OPEN PIPELINE', open.length, fmtValue(sumVal(open), 'currency'), 'sky');
    stat('WON',           won.length,  fmtValue(sumVal(won),  'currency'), 'emerald');
    stat('LOST',          lost.length, fmtValue(sumVal(lost), 'currency'), 'rose');
    stat('WIN RATE',      `${winRate}%`, `${won.length}/${won.length + lost.length} closed`, 'mint');
    stat('AVG DEAL',      fmtValue(avgDeal, 'currency'), `${won.length} won deals`, 'warn');

    // ─── Pipeline by stage ─────────────────────────────
    root.createDiv({ cls: 'cad-section-label-lg', text: 'PIPELINE BY STAGE' });
    const stageData = DEAL_STAGES.map((stage) => {
      const items = allDeals.filter((e) => String(entityValue(e, 'stage', dealDef)) === stage);
      return { stage, items, value: sumVal(items) };
    });
    const maxStageVal = Math.max(1, ...stageData.map((s) => s.value));
    const stageWrap = root.createDiv({ cls: 'cad-stage-bars' });
    stageData.forEach(({ stage, items, value }) => {
      const row = stageWrap.createDiv({ cls: 'cad-stage-bar-row' });
      row.dataset.stage = stage;
      row.createDiv({ cls: 'cad-stage-bar-name', text: stage });
      row.createDiv({ cls: 'cad-stage-bar-count', text: `${items.length}` });
      const barWrap = row.createDiv({ cls: 'cad-stage-bar' });
      const fill = barWrap.createDiv({ cls: 'cad-stage-bar-fill' });
      fill.style.width = `${(value / maxStageVal) * 100}%`;
      row.createDiv({ cls: 'cad-stage-bar-value', text: fmtValue(value, 'currency') });
      row.addEventListener('click', () => this.setMode('crm.pipeline'));
    });

    // ─── Two-column body ───────────────────────────────
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Hot deals — top by value, open only
    const topHot = [...open]
      .sort((a, b) => dealValue(b) - dealValue(a))
      .slice(0, 5)
      .map((e) => ({
        title: entityValue(e, 'title', dealDef) || e.basename,
        meta: `${entityValue(e, 'stage', dealDef) || '—'} · ${fmtValue(dealValue(e), 'currency')}`,
        file: e.file,
      }));
    this._dashCardSection(left, 'HOT DEALS · top 5 by value', topHot, 'No open deals yet — hit + New Deal above.');

    // Stale deals — open, not touched in 14+ days (file mtime)
    const staleCutoff = Date.now() - 14 * 86400000;
    const stale = open
      .filter((e) => e.file && e.file.stat && e.file.stat.mtime < staleCutoff)
      .sort((a, b) => (a.file.stat.mtime || 0) - (b.file.stat.mtime || 0))
      .slice(0, 5)
      .map((e) => {
        const days = Math.round((Date.now() - e.file.stat.mtime) / 86400000);
        return {
          title: entityValue(e, 'title', dealDef) || e.basename,
          meta: `${entityValue(e, 'stage', dealDef) || '—'} · ${days}d quiet · ${fmtValue(dealValue(e), 'currency')}`,
          file: e.file,
        };
      });
    this._dashCardSection(left, 'STALE DEALS · 14+ days no edits', stale, 'No stale deals — momentum is good.');

    // Recent activity
    const recentAct = [...activities]
      .sort((a, b) => {
        const da = new Date(entityValue(a, 'when', ENTITIES.activity) || 0).getTime();
        const db = new Date(entityValue(b, 'when', ENTITIES.activity) || 0).getTime();
        return db - da;
      })
      .slice(0, 6)
      .map((e) => ({
        title: entityValue(e, 'subject', ENTITIES.activity) || e.basename,
        meta: `${entityValue(e, 'type', ENTITIES.activity) || '—'} · ${entityValue(e, 'with', ENTITIES.activity) || '—'} · ${fmtValue(entityValue(e, 'when', ENTITIES.activity), 'date')}`,
        file: e.file,
      }));
    this._dashCardSection(right, `RECENT ACTIVITY · ${activities.length} total`, recentAct, 'No activity logged yet. Capture a call or meeting under CRM > Activities.');

    // Customer base — mini stat row inside a card
    const baseCard = right.createDiv({ cls: 'cad-dash-card' });
    baseCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: `CUSTOMER BASE · ${contacts.length + companies.length + partners.length} records` });
    const baseBody = baseCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    const mkMini = (label, val, accent, mode) => {
      const c = baseBody.createDiv({ cls: 'cad-mini-stat' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-mini-stat-value', text: String(val) });
      c.createDiv({ cls: 'cad-mini-stat-label', text: label });
      if (mode) {
        c.style.cursor = 'pointer';
        c.addEventListener('click', () => this.setMode(mode));
      }
    };
    mkMini('CONTACTS',  contacts.length,  'warn', 'crm.contacts');
    mkMini('COMPANIES', companies.length, 'sky',  'crm.companies');
    mkMini('PARTNERS',  partners.length,  'rose', 'prm.partners');
  }

  /* Reusable list card on the dashboard. */
  _dashCardSection(parent, title, rows, emptyMsg) {
    const card = parent.createDiv({ cls: 'cad-dash-card' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: title });
    const body = card.createDiv({ cls: 'cad-dash-card-body' });
    if (!rows || !rows.length) {
      body.createDiv({ cls: 'cad-empty', text: emptyMsg || 'Nothing here yet.' });
      return;
    }
    rows.forEach((r) => {
      const row = body.createDiv({ cls: 'cad-dash-row' });
      row.createDiv({ cls: 'cad-dash-row-title', text: r.title });
      row.createDiv({ cls: 'cad-dash-row-meta', text: r.meta });
      if (r.file) row.addEventListener('click', () => this.openEntityDetailFromFile(r.file));
    });
  }

  /* ── Reports: Productivity (over daily notes) ── */
  async renderProductivity(root) {
    root.addClass('cadence-report');
    const settings = this.plugin.settings;

    // Walk last 30 days
    const today = startOfDay(new Date());
    const days = Array.from({ length: 30 }, (_, i) => addDays(today, -i));
    let totalOpen = 0, totalDone = 0, totalJournalChars = 0;
    let activeDays = 0;
    let streak = 0, streakBroken = false;
    const perDay = [];
    for (const d of days) {
      const f = this.app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
      let open = 0, done = 0, jChars = 0, hasNote = false;
      if (f && f instanceof obsidian.TFile) {
        hasNote = true;
        const c = await this.app.vault.read(f);
        const p = parseSections(c, settings);
        open = p.tasks.filter((l) => / \[ \] /.test(l)).length;
        done = p.tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
        jChars = (p.journal || '').length;
      }
      perDay.push({ date: d, open, done, jChars, hasNote });
      totalOpen += open; totalDone += done; totalJournalChars += jChars;
      if (hasNote) activeDays++;
      if (!streakBroken) {
        if (hasNote && (done > 0 || jChars > 0)) streak++;
        else streakBroken = true;
      }
    }

    const completion = totalOpen + totalDone === 0 ? 0 : Math.round((totalDone / (totalOpen + totalDone)) * 100);

    this._renderPageHeader(root, 'Productivity', 'Last 30 days · across your daily notes');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('COMPLETION', `${completion}%`,                       `${totalDone}/${totalOpen + totalDone} tasks`, 'emerald');
    stat('STREAK',     `${streak}d`,                            'consecutive active days',                     'mint');
    stat('ACTIVE',     `${activeDays}/30`,                      'days with a note',                            'sky');
    stat('JOURNAL',    totalJournalChars.toLocaleString(),      'characters written',                          'warn');

    // Bar chart of completed tasks per day (last 14 days, oldest left)
    root.createDiv({ cls: 'cad-section-label-lg', text: 'TASKS DONE — LAST 14 DAYS' });
    const last14 = perDay.slice(0, 14).reverse();
    const max = Math.max(1, ...last14.map((p) => p.done));
    const chart = root.createDiv({ cls: 'cad-bar-chart' });
    last14.forEach((p) => {
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(p.done / max) * 100}%`;
      const ratio = p.done / max;
      bar.dataset.band = p.done === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      const lbl = col.createDiv({ cls: 'cad-bar-label', text: String(p.date.getDate()) });
      bar.title = `${p.date.toLocaleDateString()} — ${p.done} done, ${p.open} open`;
      void lbl;
    });

    /* 12-week completion trend */
    const weekStart = startOfWeek(today, this.plugin.settings.weekStartsOn);
    const weeks = [];
    for (let w = 11; w >= 0; w--) {
      const ws = addDays(weekStart, -w * 7);
      const we = addDays(ws, 7);
      let wd = 0, wo = 0, anyNote = false;
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i);
        if (d.getTime() > today.getTime()) break;
        const f = this.app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
        if (f && f instanceof obsidian.TFile) {
          anyNote = true;
          const c = await this.app.vault.read(f);
          const p = parseSections(c, settings);
          p.tasks.forEach((l) => { if (/ \[(x|X)\] /.test(l)) wd++; else if (/ \[ \] /.test(l)) wo++; });
        }
      }
      weeks.push({ start: ws, done: wd, open: wo, any: anyNote, label: ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    }
    const maxWeek = Math.max(1, ...weeks.map((w) => w.done));
    root.createDiv({ cls: 'cad-section-label-lg', text: 'COMPLETION TREND — LAST 12 WEEKS' });
    const wkChart = root.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    weeks.forEach((w) => {
      const col = wkChart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(w.done / maxWeek) * 100}%`;
      const ratio = w.done / maxWeek;
      bar.dataset.band = w.done === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `Week of ${w.label} — ${w.done} done, ${w.open} open`;
      col.createDiv({ cls: 'cad-bar-label', text: w.label });
    });

    /* Completion by weekday (Mon-Sun aggregated over the 30 days) */
    const wsOn = settings.weekStartsOn;
    const dayBuckets = Array.from({ length: 7 }, () => ({ done: 0, open: 0 }));
    perDay.forEach((p) => {
      // p.date.getDay() returns 0 (Sun) .. 6 (Sat). Re-index based on weekStartsOn.
      const idx = (p.date.getDay() - wsOn + 7) % 7;
      dayBuckets[idx].done += p.done;
      dayBuckets[idx].open += p.open;
    });
    const dayLabels = wsOn === 1
      ? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
      : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    root.createDiv({ cls: 'cad-section-label-lg', text: 'COMPLETION BY WEEKDAY · LAST 30 DAYS' });
    const dayCard = root.createDiv({ cls: 'cad-dash-card' });
    dayCard.style.margin = '0 36px 24px 36px';
    const dayBody = dayCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    const dayAccents = ['emerald', 'mint', 'sky', 'warn', 'rose', 'mint', 'sky'];
    dayBuckets.forEach((b, i) => {
      const total = b.done + b.open;
      const pct = total === 0 ? 0 : Math.round((b.done / total) * 100);
      const mini = dayBody.createDiv({ cls: 'cad-mini-stat' });
      mini.dataset.accent = dayAccents[i];
      mini.createDiv({ cls: 'cad-mini-stat-value', text: total === 0 ? '—' : `${pct}%` });
      mini.createDiv({ cls: 'cad-mini-stat-label', text: dayLabels[i] });
      const sub = mini.createDiv({ cls: 'cad-stat-sub' });
      sub.style.marginTop = '4px';
      sub.setText(total === 0 ? 'no data' : `${b.done}/${total}`);
    });
  }

  /* ── Reports: Pipeline (deals breakdown) ──────── */
  async renderReportPipeline(root) {
    root.addClass('cadence-report');
    const def = ENTITIES.deal;
    const deals = listEntities(this.app, 'deal');
    const open = deals.filter((e) => !['Won', 'Lost'].includes(String(entityValue(e, 'stage', def))));
    const won  = deals.filter((e) => String(entityValue(e, 'stage', def)) === 'Won');
    const lost = deals.filter((e) => String(entityValue(e, 'stage', def)) === 'Lost');
    const dealValue = (e) => Number(entityValue(e, 'value', def)) || 0;
    const sumVal = (arr) => arr.reduce((s, e) => s + dealValue(e), 0);
    const winRate = won.length + lost.length === 0 ? 0 : Math.round((won.length / (won.length + lost.length)) * 100);

    // Weighted forecast — confidence per stage applied to open deal value.
    const stageConfidence = { 'Lead': 0.10, 'Qualified': 0.25, 'Proposal': 0.50, 'Negotiation': 0.75 };
    const weighted = open.reduce((s, e) => s + dealValue(e) * (stageConfidence[String(entityValue(e, 'stage', def))] || 0), 0);

    this._renderPageHeader(root, 'Pipeline report', 'Coverage, forecast and aging across all deals');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('OPEN',       open.length,                     fmtValue(sumVal(open), 'currency'),  'sky');
    stat('WEIGHTED',   fmtValue(weighted, 'currency'),  'forecast on open',                  'mint');
    stat('WON',        won.length,                      fmtValue(sumVal(won),  'currency'),  'emerald');
    stat('LOST',       lost.length,                     fmtValue(sumVal(lost), 'currency'),  'rose');
    stat('WIN RATE',   `${winRate}%`,                   `${won.length}/${won.length + lost.length} closed`, 'warn');

    /* By stage table (existing, kept) */
    root.createDiv({ cls: 'cad-section-label-lg', text: 'BY STAGE' });
    const tableWrap = root.createDiv({ cls: 'cad-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'cad-table' });
    const trh = table.createEl('thead').createEl('tr');
    ['Stage', 'Count', 'Value'].forEach((h) => trh.createEl('th', { text: h }));
    const tbody = table.createEl('tbody');
    DEAL_STAGES.forEach((stage) => {
      const items = deals.filter((e) => String(entityValue(e, 'stage', def)) === stage);
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: stage });
      tr.createEl('td', { text: String(items.length) });
      tr.createEl('td', { text: fmtValue(sumVal(items), 'currency') });
    });

    /* Two-col body: by owner + aging cohorts */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Pipeline by owner
    const byOwner = new Map();
    open.forEach((e) => {
      const owner = String(entityValue(e, 'owner', def) || '(unassigned)');
      if (!byOwner.has(owner)) byOwner.set(owner, { count: 0, value: 0 });
      const o = byOwner.get(owner);
      o.count++; o.value += dealValue(e);
    });
    const ownerRows = [...byOwner.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 8)
      .map(([owner, data]) => ({
        title: owner,
        meta: `${data.count} deal${data.count === 1 ? '' : 's'} · ${fmtValue(data.value, 'currency')}`,
      }));
    this._dashCardSection(left, `OPEN PIPELINE BY OWNER · top ${Math.min(8, byOwner.size)}`, ownerRows, 'No open deals to attribute.');

    // Aging cohorts (file mtime)
    const now = Date.now();
    const cohorts = [
      { label: '0–7 DAYS',  cutoff: 7,        count: 0, value: 0, accent: 'emerald' },
      { label: '8–30 DAYS', cutoff: 30,       count: 0, value: 0, accent: 'mint' },
      { label: '31–90 DAYS', cutoff: 90,      count: 0, value: 0, accent: 'warn' },
      { label: '90+ DAYS',  cutoff: Infinity, count: 0, value: 0, accent: 'rose' },
    ];
    open.forEach((e) => {
      const mtime = e.file && e.file.stat ? e.file.stat.mtime : now;
      const days = (now - mtime) / 86400000;
      for (const c of cohorts) {
        if (days <= c.cutoff) { c.count++; c.value += dealValue(e); break; }
      }
    });
    const agingCard = right.createDiv({ cls: 'cad-dash-card' });
    agingCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'AGING · OPEN DEALS BY LAST EDIT' });
    const agingBody = agingCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    cohorts.forEach((c) => {
      const mini = agingBody.createDiv({ cls: 'cad-mini-stat' });
      mini.dataset.accent = c.accent;
      mini.createDiv({ cls: 'cad-mini-stat-value', text: String(c.count) });
      mini.createDiv({ cls: 'cad-mini-stat-label', text: c.label });
      const sub = mini.createDiv({ cls: 'cad-stat-sub' });
      sub.style.marginTop = '4px';
      sub.setText(fmtValue(c.value, 'currency'));
    });

    // Stale top-5 list under aging
    const staleCutoff = now - 30 * 86400000;
    const stale = open
      .filter((e) => e.file && e.file.stat && e.file.stat.mtime < staleCutoff)
      .sort((a, b) => (a.file.stat.mtime || 0) - (b.file.stat.mtime || 0))
      .slice(0, 5)
      .map((e) => ({
        title: entityValue(e, 'title', def) || e.basename,
        meta: `${entityValue(e, 'stage', def) || '—'} · ${Math.round((now - e.file.stat.mtime) / 86400000)}d quiet · ${fmtValue(dealValue(e), 'currency')}`,
        file: e.file,
      }));
    this._dashCardSection(right, 'STALE · 30+ DAYS NO EDITS', stale, 'No deals over 30 days quiet — nice.');
  }

  /* ── Reports: Sales (closed deals) ─────────────── */
  async renderReportSales(root) {
    root.addClass('cadence-report');
    const def = ENTITIES.deal;
    const deals = listEntities(this.app, 'deal');
    const won  = deals.filter((e) => String(entityValue(e, 'stage', def)) === 'Won');
    const lost = deals.filter((e) => String(entityValue(e, 'stage', def)) === 'Lost');
    const dealValue = (e) => Number(entityValue(e, 'value', def)) || 0;
    const sumVal = (arr) => arr.reduce((s, e) => s + dealValue(e), 0);

    this._renderPageHeader(root, 'Sales report', 'Closed-won and lost · performance over time');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('REVENUE',     fmtValue(sumVal(won), 'currency'),  `${won.length} deals`,             'emerald');
    stat('LOST',        fmtValue(sumVal(lost), 'currency'), `${lost.length} deals`,            'rose');
    const total = sumVal(won) + sumVal(lost);
    const captureRate = total === 0 ? 0 : Math.round((sumVal(won) / total) * 100);
    stat('CAPTURE',     `${captureRate}%`,                  'of closed value',                  'mint');
    const avg = won.length === 0 ? 0 : sumVal(won) / won.length;
    stat('AVG DEAL',    fmtValue(avg, 'currency'),          'won deals',                        'sky');

    /* Revenue by month (last 6 months, by file mtime as close proxy) */
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        date: d,
        label: d.toLocaleDateString(undefined, { month: 'short' }),
        revenue: 0,
        count: 0,
      });
    }
    won.forEach((e) => {
      const t = e.file && e.file.stat ? e.file.stat.mtime : null;
      if (!t) return;
      const d = new Date(t);
      const idx = months.findIndex((m) => m.date.getFullYear() === d.getFullYear() && m.date.getMonth() === d.getMonth());
      if (idx >= 0) { months[idx].revenue += dealValue(e); months[idx].count++; }
    });
    const maxRev = Math.max(1, ...months.map((m) => m.revenue));
    root.createDiv({ cls: 'cad-section-label-lg', text: 'REVENUE — LAST 6 MONTHS' });
    const chart = root.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    months.forEach((m) => {
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(m.revenue / maxRev) * 100}%`;
      const ratio = m.revenue / maxRev;
      bar.dataset.band = m.revenue === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `${m.label} — ${fmtValue(m.revenue, 'currency')} · ${m.count} deals`;
      col.createDiv({ cls: 'cad-bar-label', text: m.label });
    });

    /* Two-col: top wins + top owners */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    const topWins = [...won]
      .sort((a, b) => dealValue(b) - dealValue(a))
      .slice(0, 6)
      .map((e) => ({
        title: entityValue(e, 'title', def) || e.basename,
        meta: `${entityValue(e, 'company', def) || '—'} · ${fmtValue(dealValue(e), 'currency')}`,
        file: e.file,
      }));
    this._dashCardSection(left, 'TOP WINS · top 6', topWins, 'No wins logged yet — close one and tag it Won.');

    // Top owners by revenue
    const byOwner = new Map();
    won.forEach((e) => {
      const owner = String(entityValue(e, 'owner', def) || '(unassigned)');
      if (!byOwner.has(owner)) byOwner.set(owner, { count: 0, revenue: 0 });
      const o = byOwner.get(owner);
      o.count++; o.revenue += dealValue(e);
    });
    const ownerRows = [...byOwner.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 6)
      .map(([owner, data]) => ({
        title: owner,
        meta: `${data.count} won · ${fmtValue(data.revenue, 'currency')}`,
      }));
    this._dashCardSection(right, 'OWNER LEADERBOARD · top 6 by revenue', ownerRows, 'No revenue attributed to owners yet.');
  }

  /* ── Reports: Partners (deals attributed to partners) ─ */
  async renderReportPartners(root) {
    root.addClass('cadence-report');
    const dealDef = ENTITIES.deal;
    const partnerDef = ENTITIES.partner;
    const certDef = ENTITIES.certification;
    const deals = listEntities(this.app, 'deal');
    const partners = listEntities(this.app, 'partner');
    const certs = listEntities(this.app, 'certification');
    const dealValue = (e) => Number(entityValue(e, 'value', dealDef)) || 0;

    this._renderPageHeader(root, 'Partners report', 'Partner-sourced revenue, tier mix, certification health');

    // Group deals by 'partner' frontmatter
    const byPartner = new Map();
    deals.forEach((e) => {
      const p = entityValue(e, 'partner', dealDef) || '(direct)';
      if (!byPartner.has(p)) byPartner.set(p, []);
      byPartner.get(p).push(e);
    });
    const partnerSourced = deals.filter((e) => entityValue(e, 'partner', dealDef));
    const partnerWon = partnerSourced.filter((e) => String(entityValue(e, 'stage', dealDef)) === 'Won');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('PARTNERS',       partners.length,                                                  'on the books',                       'sky');
    stat('PARTNER DEALS',  partnerSourced.length,                                            fmtValue(partnerSourced.reduce((s, e) => s + dealValue(e), 0), 'currency'), 'mint');
    stat('PARTNER REV',    fmtValue(partnerWon.reduce((s, e) => s + dealValue(e), 0), 'currency'), `${partnerWon.length} won`,        'emerald');
    stat('UNIQUE SOURCES', byPartner.size,                                                   'including direct',                   'warn');

    /* Tier breakdown */
    const tierMap = new Map();
    partners.forEach((p) => {
      const t = String(entityValue(p, 'tier', partnerDef) || 'Untiered');
      if (!tierMap.has(t)) tierMap.set(t, 0);
      tierMap.set(t, tierMap.get(t) + 1);
    });
    if (tierMap.size) {
      root.createDiv({ cls: 'cad-section-label-lg', text: 'PARTNERS BY TIER' });
      const tierCard = root.createDiv({ cls: 'cad-dash-card' });
      tierCard.style.margin = '0 36px 18px 36px';
      const tierBody = tierCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
      const tierAccent = { 'Gold': 'warn', 'Silver': 'sky', 'Bronze': 'rose', 'Standard': 'mint' };
      [...tierMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([tier, count]) => {
        const mini = tierBody.createDiv({ cls: 'cad-mini-stat' });
        mini.dataset.accent = tierAccent[tier] || 'sky';
        mini.createDiv({ cls: 'cad-mini-stat-value', text: String(count) });
        mini.createDiv({ cls: 'cad-mini-stat-label', text: tier.toUpperCase() });
      });
    }

    /* Two-col: deals-by-partner table + cert expiries */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Deals by partner — keep table style
    const dealsByPartnerCard = left.createDiv({ cls: 'cad-dash-card' });
    dealsByPartnerCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'DEALS BY PARTNER' });
    const dbpBody = dealsByPartnerCard.createDiv({ cls: 'cad-dash-card-body' });
    if (!byPartner.size) {
      dbpBody.createDiv({ cls: 'cad-empty', text: 'No deals attributed to partners yet.' });
    } else {
      [...byPartner.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 10)
        .forEach(([p, items]) => {
          const v = items.reduce((s, e) => s + dealValue(e), 0);
          const row = dbpBody.createDiv({ cls: 'cad-dash-row' });
          row.createDiv({ cls: 'cad-dash-row-title', text: p });
          row.createDiv({ cls: 'cad-dash-row-meta', text: `${items.length} deal${items.length === 1 ? '' : 's'} · ${fmtValue(v, 'currency')}` });
        });
    }

    // Cert expiries upcoming (next 90 days)
    const now = Date.now();
    const horizon = now + 90 * 86400000;
    const upcomingCerts = certs
      .map((e) => {
        const exp = entityValue(e, 'expires', certDef);
        if (!exp) return null;
        const d = new Date(exp);
        if (isNaN(d.getTime())) return null;
        return { entity: e, date: d };
      })
      .filter((x) => x && x.date.getTime() >= now && x.date.getTime() <= horizon)
      .sort((a, b) => a.date - b.date)
      .slice(0, 8)
      .map((x) => ({
        title: entityValue(x.entity, 'name', certDef) || x.entity.basename,
        meta: `${entityValue(x.entity, 'partner', certDef) || '—'} · expires ${fmtValue(x.date, 'date')}`,
        file: x.entity.file,
      }));
    this._dashCardSection(right, 'CERTS EXPIRING · NEXT 90 DAYS', upcomingCerts, 'No certifications expiring in the next 90 days.');
  }

  /* ── Reports: Activity (mix of activity types) ─ */
  async renderReportActivity(root) {
    root.addClass('cadence-report');
    const def = ENTITIES.activity;
    const acts = listEntities(this.app, 'activity');

    this._renderPageHeader(root, 'Activity report', 'Calls, meetings, emails and notes — mix and momentum');

    const counts = new Map();
    acts.forEach((e) => {
      const t = String(entityValue(e, 'type', def) || 'unspecified');
      counts.set(t, (counts.get(t) || 0) + 1);
    });

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('TOTAL', acts.length, 'all activities', 'emerald');
    const accents = ['sky', 'mint', 'warn', 'rose'];
    let i = 0;
    counts.forEach((v, k) => stat(k.toUpperCase(), v, '', accents[i++ % accents.length]));

    /* Activity by week (last 8 weeks) */
    const now = new Date();
    const weekStart = startOfWeek(now, this.plugin.settings.weekStartsOn);
    const weeks = [];
    for (let w = 7; w >= 0; w--) {
      const ws = addDays(weekStart, -w * 7);
      const we = addDays(ws, 7);
      weeks.push({ start: ws, end: we, count: 0, label: ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    }
    acts.forEach((e) => {
      const when = entityValue(e, 'when', def);
      if (!when) return;
      const t = new Date(when).getTime();
      if (isNaN(t)) return;
      const idx = weeks.findIndex((w) => t >= w.start.getTime() && t < w.end.getTime());
      if (idx >= 0) weeks[idx].count++;
    });
    const maxWeek = Math.max(1, ...weeks.map((w) => w.count));
    root.createDiv({ cls: 'cad-section-label-lg', text: 'ACTIVITY — LAST 8 WEEKS' });
    const chart = root.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    weeks.forEach((w) => {
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(w.count / maxWeek) * 100}%`;
      const ratio = w.count / maxWeek;
      bar.dataset.band = w.count === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `Week of ${w.label} — ${w.count} activities`;
      col.createDiv({ cls: 'cad-bar-label', text: w.label });
    });

    /* Two-col: top contacts + recent activity */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Top contacts by activity count
    const contactCounts = new Map();
    acts.forEach((e) => {
      const w = String(entityValue(e, 'with', def) || '').trim();
      if (!w) return;
      contactCounts.set(w, (contactCounts.get(w) || 0) + 1);
    });
    const topContactRows = [...contactCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([who, count]) => ({
        title: who,
        meta: `${count} activit${count === 1 ? 'y' : 'ies'}`,
      }));
    this._dashCardSection(left, 'TOP CONTACTS · by activity count', topContactRows, 'No activities tagged with a contact yet.');

    // Recent activity (last 10)
    const recent = [...acts]
      .sort((a, b) => {
        const da = new Date(entityValue(a, 'when', def) || 0).getTime();
        const db = new Date(entityValue(b, 'when', def) || 0).getTime();
        return db - da;
      })
      .slice(0, 10)
      .map((e) => ({
        title: entityValue(e, 'subject', def) || e.basename,
        meta: `${entityValue(e, 'type', def) || '—'} · ${entityValue(e, 'with', def) || '—'} · ${fmtValue(entityValue(e, 'when', def), 'date')}`,
        file: e.file,
      }));
    this._dashCardSection(right, 'RECENT ACTIVITY · last 10', recent, 'No activities yet — log one under CRM > Activities.');
  }

  /* ── PRM Analytics ──────────────────────── */
  async renderPRMAnalytics(root) {
    root.addClass('cadence-report');
    const partnerDef = ENTITIES.partner;
    const dealDef = ENTITIES.deal;
    const partners = listEntities(this.app, 'partner');
    const deals = listEntities(this.app, 'deal');
    const dealValue = (e) => Number(entityValue(e, 'value', dealDef)) || 0;
    const sumVal = (arr) => arr.reduce((s, e) => s + dealValue(e), 0);
    const partnerSourced = deals.filter((e) => entityValue(e, 'partner', dealDef));
    const partnerWon = partnerSourced.filter((e) => String(entityValue(e, 'stage', dealDef)) === 'Won');

    this._renderPageHeader(root, 'PRM analytics', 'Partner programme health, tier mix and revenue contribution');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('PARTNERS',         partners.length,                            'on the books',                              'sky');
    stat('SOURCED DEALS',    partnerSourced.length,                      fmtValue(sumVal(partnerSourced), 'currency'),'mint');
    stat('PARTNER REVENUE',  fmtValue(sumVal(partnerWon), 'currency'),   `${partnerWon.length} won`,                  'emerald');
    const totalSourcedValue = sumVal(partnerSourced);
    const totalDealValue = sumVal(deals);
    const sharePct = totalDealValue === 0 ? 0 : Math.round((totalSourcedValue / totalDealValue) * 100);
    stat('PARTNER SHARE',    `${sharePct}%`,                             'of total pipeline value',                   'warn');

    /* Tier breakdown */
    const tierMap = new Map();
    const tierValueMap = new Map();
    partners.forEach((p) => {
      const t = String(entityValue(p, 'tier', partnerDef) || 'Untiered');
      tierMap.set(t, (tierMap.get(t) || 0) + 1);
      tierValueMap.set(t, tierValueMap.get(t) || 0);
    });
    // Add tier-attributed revenue: deals where partner matches partner-name and partner.tier is known
    const partnerByName = new Map();
    partners.forEach((p) => partnerByName.set(String(entityValue(p, 'name', partnerDef) || p.basename), p));
    partnerWon.forEach((d) => {
      const pname = String(entityValue(d, 'partner', dealDef) || '');
      const partner = partnerByName.get(pname);
      if (!partner) return;
      const tier = String(entityValue(partner, 'tier', partnerDef) || 'Untiered');
      tierValueMap.set(tier, (tierValueMap.get(tier) || 0) + dealValue(d));
    });

    if (tierMap.size) {
      root.createDiv({ cls: 'cad-section-label-lg', text: 'PARTNERS BY TIER' });
      const tierCard = root.createDiv({ cls: 'cad-dash-card' });
      tierCard.style.margin = '0 36px 18px 36px';
      const tierBody = tierCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
      const tierAccent = { 'Gold': 'warn', 'Silver': 'sky', 'Bronze': 'rose', 'Standard': 'mint', 'Untiered': 'mint' };
      [...tierMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([tier, count]) => {
        const value = tierValueMap.get(tier) || 0;
        const mini = tierBody.createDiv({ cls: 'cad-mini-stat' });
        mini.dataset.accent = tierAccent[tier] || 'sky';
        mini.createDiv({ cls: 'cad-mini-stat-value', text: String(count) });
        mini.createDiv({ cls: 'cad-mini-stat-label', text: tier.toUpperCase() });
        const sub = mini.createDiv({ cls: 'cad-stat-sub' });
        sub.style.marginTop = '4px';
        sub.setText(value > 0 ? fmtValue(value, 'currency') : '—');
      });
    }

    /* Two-col: top partners by revenue + funnel */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Top partners by won revenue
    const partnerRevenue = new Map();
    partnerWon.forEach((d) => {
      const p = String(entityValue(d, 'partner', dealDef) || '(direct)');
      partnerRevenue.set(p, (partnerRevenue.get(p) || 0) + dealValue(d));
    });
    const topPartnerRows = [...partnerRevenue.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p, v]) => {
        const partner = partnerByName.get(p);
        const file = partner ? partner.file : null;
        return {
          title: p,
          meta: fmtValue(v, 'currency'),
          file,
        };
      });
    this._dashCardSection(left, 'TOP PARTNERS · by won revenue', topPartnerRows, 'No partner-attributed wins yet.');

    // Funnel: Sourced → Open → Won
    const sourcedOpen = partnerSourced.filter((e) => !['Won', 'Lost'].includes(String(entityValue(e, 'stage', dealDef))));
    const sourcedLost = partnerSourced.filter((e) => String(entityValue(e, 'stage', dealDef)) === 'Lost');
    const conv = partnerSourced.length === 0 ? 0 : Math.round((partnerWon.length / partnerSourced.length) * 100);
    const funnelCard = right.createDiv({ cls: 'cad-dash-card' });
    funnelCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'PARTNER FUNNEL' });
    const funnelBody = funnelCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    const mkF = (label, val, sub, accent) => {
      const m = funnelBody.createDiv({ cls: 'cad-mini-stat' });
      m.dataset.accent = accent;
      m.createDiv({ cls: 'cad-mini-stat-value', text: String(val) });
      m.createDiv({ cls: 'cad-mini-stat-label', text: label });
      const s = m.createDiv({ cls: 'cad-stat-sub' });
      s.style.marginTop = '4px';
      s.setText(sub);
    };
    mkF('SOURCED', partnerSourced.length, fmtValue(sumVal(partnerSourced), 'currency'), 'sky');
    mkF('OPEN',    sourcedOpen.length,    fmtValue(sumVal(sourcedOpen),    'currency'), 'mint');
    mkF('WON',     partnerWon.length,     fmtValue(sumVal(partnerWon),     'currency'), 'emerald');
    mkF('LOST',    sourcedLost.length,    fmtValue(sumVal(sourcedLost),    'currency'), 'rose');

    const convCard = right.createDiv({ cls: 'cad-dash-card' });
    convCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: `CONVERSION · sourced → won` });
    const convBody = convCard.createDiv({ cls: 'cad-dash-card-body' });
    convBody.style.padding = '20px 16px';
    const convWrap = convBody.createDiv({ cls: 'cad-proj-progress-wrap' });
    convWrap.dataset.pctBand = pctBand(conv);
    const convLabel = convWrap.createDiv({ cls: 'cad-proj-progress-label' });
    convLabel.createSpan({ text: `${partnerWon.length}/${partnerSourced.length} sourced deals won` });
    convLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${conv}%` });
    const convBar = convWrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const convFill = convBar.createDiv({ cls: 'cad-proj-progress-fill' });
    convFill.style.width = `${conv}%`;
  }

  /* ── Team (contacts where role contains "team") ─ */
  async renderTeam(root) {
    return this.renderEntityList(root, 'contact', {
      title: 'Team',
      filter: (e) => {
        const role = String(entityValue(e, 'role', ENTITIES.contact) || '').toLowerCase();
        return role.includes('team') || role.includes('admin') || role.includes('member');
      },
      columns: ['name', 'role', 'email', 'company'],
    });
  }

  /* ── Settings (opens Obsidian settings → Cadence) ─ */
  async openSettingsTab(root) {
    root.addClass('cadence-soon');
    const wrap = root.createDiv({ cls: 'cad-soon-wrap' });
    const ic = wrap.createDiv({ cls: 'cad-soon-icon' });
    try { obsidian.setIcon(ic, 'settings-2'); } catch (_) {}
    wrap.createDiv({ cls: 'cad-eyebrow', text: 'CADENCE' });
    wrap.createDiv({ cls: 'cad-soon-title', text: 'Settings' });
    wrap.createDiv({ cls: 'cad-soon-desc', text: 'Configure folders, headings, week start, default tab, and the (future) Cadence API connection.' });
    const btn = wrap.createEl('button', { cls: 'cad-btn primary', text: 'Open Cadence settings' });
    btn.style.marginTop = '12px';
    btn.addEventListener('click', () => {
      this.app.setting.open();
      this.app.setting.openTabById(this.plugin.manifest.id);
    });
  }

  /* ── Task completion propagation ──
     When a task is ticked or unticked anywhere, mirror the state to:
       - matching reminders by text (and via reminder.project to the linked project)
       - matching task lines in today's daily note + the linked reminder's date note
     Match is by exact (trimmed) task text. Renaming a task breaks the link. */
  async _propagateTaskComplete(text, done, source) {
    const t = String(text || '').trim();
    if (!t) return;
    source = source || {};

    const reminders = (this.plugin.settings.reminders || []).slice();
    const matches = reminders.filter((r) => r.text && r.text.trim() === t);

    /* 1. Sync matching reminders (skip the source reminder) */
    for (const r of matches) {
      if (source.kind === 'reminder' && r.id === source.id) continue;
      if (!!r.done === !!done) continue;
      await this.plugin.updateReminder(r.id, { done: !!done });
    }

    /* 2. For any matching reminder linked to a project, tick that project's task line */
    const projectsTouched = new Set();
    for (const r of matches) {
      if (!r.project) continue;
      if (source.kind === 'project' && source.file && source.file.path === r.project) continue;
      if (projectsTouched.has(r.project)) continue;
      projectsTouched.add(r.project);
      const file = this.app.vault.getAbstractFileByPath(r.project);
      if (!file || !(file instanceof obsidian.TFile)) continue;
      await this._tickProjectTaskByText(file, t, !!done);
    }

    /* 3. Tick matching task line in relevant daily notes (today + each match's date note + source date) */
    const datesToCheck = new Set([ymd(new Date())]);
    matches.forEach((r) => {
      if (r.when) {
        const d = new Date(r.when);
        if (!isNaN(d.getTime())) datesToCheck.add(ymd(d));
      }
      if (r.createdAt) {
        const d = new Date(r.createdAt);
        if (!isNaN(d.getTime())) datesToCheck.add(ymd(d));
      }
    });
    if (source.kind === 'daily' && source.date) datesToCheck.add(ymd(source.date));
    const settings = this.plugin.settings;
    for (const dateStr of datesToCheck) {
      const path = settings.dailyNoteFolder
        ? `${settings.dailyNoteFolder.replace(/\/$/, '')}/${dateStr}.md`
        : `${dateStr}.md`;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof obsidian.TFile)) continue;
      if (source.kind === 'daily' && source.file && source.file.path === file.path) continue;
      await this._tickDailyNoteTaskByText(file, t, !!done);
    }
  }

  async _tickProjectTaskByText(file, text, done) {
    let content;
    try { content = await this.app.vault.read(file); } catch (_) { return; }
    const sections = parseH2Sections(content);
    const tasks = parseTasksList(sections['Tasks'] || '');
    let changed = false;
    const updated = tasks.map((tk) => {
      if (tk.title.trim() === text && !!tk.done !== !!done) {
        changed = true;
        return Object.assign({}, tk, { done: !!done });
      }
      return tk;
    });
    if (!changed) return;
    const newSection = stringifyTasks(updated);
    const next = replaceSection(content, '## Tasks', newSection);
    await this.app.vault.modify(file, next);
  }

  async _tickDailyNoteTaskByText(file, text, done) {
    let content;
    try { content = await this.app.vault.read(file); } catch (_) { return; }
    const parsed = parseSections(content, this.plugin.settings);
    let changed = false;
    const updatedTasks = parsed.tasks.map((line) => {
      const lineText = line.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
      if (lineText !== text) return line;
      const isDone = / \[(x|X)\] /.test(line);
      if (isDone === !!done) return line;
      changed = true;
      return done
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    if (!changed) return;
    const newSection = updatedTasks.join('\n');
    const next = replaceSection(content, this.plugin.settings.tasksHeading, newSection);
    await this.app.vault.modify(file, next);
  }

  /* ── Cadence-styled prompt modal ─ */
  _prompt(opts) {
    return new Promise((resolve) => {
      new CadencePromptModal(this.app, {
        title: opts.title || 'Enter a name',
        placeholder: opts.placeholder || '',
        defaultValue: opts.defaultValue || '',
        cta: opts.cta || 'Create',
        onSubmit: resolve,
      }).open();
    });
  }

  async _createEntityFromPrompt(entityKey) {
    const def = ENTITIES[entityKey];
    new CadenceEntityCreateModal(this.app, entityKey, {
      onSubmit: async (result) => {
        if (!result) return;
        try {
          const file = await createEntity(this.app, entityKey, result.name);
          // Patch frontmatter with whatever else the user filled in (skip primary key — already set by template).
          const primaryKey = def.fields[0].key;
          const extras = Object.assign({}, result.values);
          delete extras[primaryKey];
          if (Object.keys(extras).length) {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
              Object.entries(extras).forEach(([k, v]) => {
                if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return;
                fm[k] = v;
              });
            });
          }
          new obsidian.Notice(`Created ${def.label}: ${file.basename}\nSaved to ${file.path}`, 4000);
          await this.openEntityDetail(entityKey, file);
        } catch (e) {
          new obsidian.Notice(`Cadence: failed to create ${def.label} — ${e.message}`);
        }
      },
    }).open();
  }

  /* ── Today pane ─────────────────────────── */
  async renderTodayPane(root) {
    root.addClass('cadence-today');
    this.todayFile = await ensureDailyNote(this.app, this.plugin.settings);
    const fileContent = await this.app.vault.read(this.todayFile);
    this.todayParsed = parseSections(fileContent, this.plugin.settings);

    const info = dateInfo();
    root.createDiv({ cls: 'cad-eyebrow', text: info.weekday.toUpperCase() });
    const hero = root.createDiv({ cls: 'cad-date-hero' });
    hero.createSpan({ cls: 'cad-day', text: String(info.day) });
    const monthCol = hero.createDiv();
    monthCol.createDiv({ cls: 'cad-month', text: info.month });
    monthCol.createDiv({ cls: 'cad-year',  text: String(info.year) });

    const taskCount = this.todayParsed.tasks.filter((l) => / \[ \] /.test(l)).length;
    root.createDiv({
      cls: 'cad-greet',
      text: taskCount === 0
        ? `${greeting()}. Nothing on the books — your day is clear.`
        : `${greeting()}. You have ${taskCount} ${taskCount === 1 ? 'thing' : 'things'} to handle.`,
    });

    /* Tasks */
    const taskSection = root.createDiv({ cls: 'cad-section' });
    const taskLabel = taskSection.createDiv({ cls: 'cad-section-label' });
    taskLabel.createSpan({ text: 'TODAY' });
    const total = this.todayParsed.tasks.length;
    const open = this.todayParsed.tasks.filter((l) => / \[ \] /.test(l)).length;
    taskLabel.createSpan({ cls: 'cad-count', text: `${open} open · ${total - open} done` });

    if (!this.todayParsed.tasks.length) {
      taskSection.createDiv({ cls: 'cad-empty', text: 'No tasks in today\'s note yet.' });
    } else {
      this.todayParsed.tasks.forEach((rawLine, idx) => {
        const checked = / \[(x|X)\] /.test(rawLine);
        const text = rawLine.replace(/^\s*-\s\[(x|X| )\]\s/, '');
        const row = taskSection.createDiv({ cls: 'cad-task-row' + (checked ? ' done' : '') });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = checked;
        cb.addEventListener('change', () => this.toggleTodayTask(idx, cb.checked));
        row.createSpan({ text });
      });
    }

    const quickWrap = taskSection.createDiv();
    quickWrap.style.marginTop = '8px';
    const quick = quickWrap.createEl('input', {
      type: 'text',
      placeholder: 'Quick add a task — Enter to save',
    });
    quick.style.width = '100%';
    quick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && quick.value.trim()) {
        const v = quick.value.trim();
        quick.value = '';
        this.appendTodayTask(v);
      }
    });

    /* Journal */
    const journalSection = root.createDiv({ cls: 'cad-section' });
    journalSection.createDiv({ cls: 'cad-section-label' }).setText('TODAY’S ENTRY');
    const ta = journalSection.createEl('textarea', { cls: 'cad-journal' });
    ta.value = this.todayParsed.journal;
    ta.placeholder = 'Write what’s on your mind…';
    ta.rows = Math.max(8, ta.value.split('\n').length + 2);
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
      if (this._journalSaveTimer) clearTimeout(this._journalSaveTimer);
      this._journalSaveTimer = setTimeout(() => this.saveTodayJournal(ta.value), 800);
    });
    setTimeout(() => { ta.style.height = ta.scrollHeight + 'px'; }, 0);

    /* Footer */
    const footer = root.createDiv();
    footer.style.marginTop = '24px';
    footer.style.fontSize = '12px';
    footer.style.color = 'var(--cad-ink-4)';
    const link = footer.createEl('a', { text: 'Open today\'s daily note →' });
    link.style.color = 'var(--cad-emerald-deep)';
    link.style.cursor = 'pointer';
    link.addEventListener('click', () => {
      this.app.workspace.openLinkText(this.todayFile.path, '', false);
    });
  }

  async toggleTodayTask(idx, checked) {
    const content = await this.app.vault.read(this.todayFile);
    const parsed = parseSections(content, this.plugin.settings);
    const taskLine = parsed.tasks[idx] || '';
    const taskText = taskLine.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
    const newTasks = parsed.tasks.map((line, i) => {
      if (i !== idx) return line;
      return checked
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(this.todayFile, newContent);
    if (taskText) {
      await this._propagateTaskComplete(taskText, checked, { kind: 'daily', file: this.todayFile, date: new Date() });
    }
    this.render();
  }

  async appendTodayTask(text) {
    const content = await this.app.vault.read(this.todayFile);
    const parsed = parseSections(content, this.plugin.settings);
    const newTasks = [...parsed.tasks, `- [ ] ${text}`];
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(this.todayFile, newContent);
    this.render();
  }

  async saveTodayJournal(body) {
    const content = await this.app.vault.read(this.todayFile);
    const newContent = replaceSection(content, this.plugin.settings.journalHeading, body || '');
    await this.app.vault.modify(this.todayFile, newContent);
  }

  /* ── Planner pane ───────────────────────── */
  async renderPlannerPane(root) {
    root.addClass('cadence-planner');
    const settings = this.plugin.settings;
    const days = weekDates(this.plannerAnchor, settings.weekStartsOn);
    const today = startOfDay(new Date());

    const header = root.createDiv({ cls: 'cad-pl-header' });
    const titleWrap = header.createDiv({ cls: 'cad-pl-title-wrap' });
    titleWrap.createDiv({ cls: 'cad-eyebrow', text: 'WEEK OF' });
    const startStr = days[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    const endStr   = days[6].toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    titleWrap.createDiv({ cls: 'cad-pl-title', text: `${startStr} – ${endStr}` });

    const nav = header.createDiv({ cls: 'cad-pl-nav' });
    const mkBtn = (label, fn, cls = '') => {
      const b = nav.createEl('button', { text: label, cls: 'cad-pl-btn ' + cls });
      b.addEventListener('click', fn);
    };
    mkBtn('◀',     () => { this.plannerAnchor = addDays(this.plannerAnchor, -7); this.render(); });
    mkBtn('Today', () => { this.plannerAnchor = startOfDay(new Date());           this.render(); }, 'primary');
    mkBtn('▶',     () => { this.plannerAnchor = addDays(this.plannerAnchor,  7); this.render(); });

    let totalOpen = 0, totalDone = 0;
    const dayData = await Promise.all(days.map(async (d) => {
      const path = dailyNotePath(settings, d);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof obsidian.TFile)) {
        return { date: d, path, exists: false, tasks: [] };
      }
      const content = await this.app.vault.read(file);
      const parsed = parseSections(content, settings);
      return { date: d, path, exists: true, file, tasks: parsed.tasks };
    }));
    dayData.forEach((d) => {
      d.tasks.forEach((l) => {
        if (/ \[(x|X)\] /.test(l)) totalDone++;
        else if (/ \[ \] /.test(l)) totalOpen++;
      });
    });

    const stats = root.createDiv({ cls: 'cad-pl-stats' });
    const mkStat = (label, value) => {
      const c = stats.createDiv({ cls: 'cad-pl-stat' });
      c.createDiv({ cls: 'cad-pl-stat-label', text: label });
      c.createDiv({ cls: 'cad-pl-stat-value', text: String(value) });
    };
    mkStat('OPEN', totalOpen);
    mkStat('DONE', totalDone);
    mkStat('TOTAL', totalOpen + totalDone);

    const grid = root.createDiv({ cls: 'cad-pl-grid' });
    dayData.forEach((d) => {
      const isToday = sameDay(d.date, today);
      const col = grid.createDiv({ cls: 'cad-pl-day' + (isToday ? ' today' : '') });

      const colHead = col.createDiv({ cls: 'cad-pl-day-head' });
      colHead.createDiv({
        cls: 'cad-pl-weekday',
        text: d.date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
      });
      colHead.createDiv({ cls: 'cad-pl-daynum', text: String(d.date.getDate()) });
      const open = d.tasks.filter((l) => / \[ \] /.test(l)).length;
      const done = d.tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
      colHead.createDiv({
        cls: 'cad-pl-meta',
        text: d.exists ? `${open} open · ${done} done` : 'no note',
      });
      colHead.addEventListener('click', async () => {
        if (!d.exists) {
          await ensureDailyNote(this.app, settings, d.date);
        }
        this.app.workspace.openLinkText(d.path, '', false);
      });

      const list = col.createDiv({ cls: 'cad-pl-tasks' });
      if (!d.tasks.length) {
        list.createDiv({ cls: 'cad-empty', text: d.exists ? '—' : '' });
      } else {
        d.tasks.forEach((rawLine, idx) => {
          const checked = / \[(x|X)\] /.test(rawLine);
          const text = rawLine.replace(/^\s*-\s\[(x|X| )\]\s/, '');
          const row = list.createDiv({ cls: 'cad-pl-task' + (checked ? ' done' : '') });
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = checked;
          cb.addEventListener('change', () => this.togglePlannerTask(d, idx, cb.checked));
          row.createSpan({ text });
        });
      }
    });
  }

  async togglePlannerTask(day, idx, checked) {
    if (!day.file) return;
    const content = await this.app.vault.read(day.file);
    const parsed = parseSections(content, this.plugin.settings);
    const taskLine = parsed.tasks[idx] || '';
    const taskText = taskLine.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
    const newTasks = parsed.tasks.map((line, i) => {
      if (i !== idx) return line;
      return checked
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(day.file, newContent);
    if (taskText) {
      await this._propagateTaskComplete(taskText, checked, { kind: 'daily', file: day.file, date: day.date });
    }
    this.render();
  }

  async onClose() { /* nothing */ }
}

/* ─────────── Settings tab ─────────── */
class CadenceSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Cadence' });

    /* ─── Modules ─── */
    containerEl.createEl('h3', { text: 'Modules' });
    containerEl.createEl('p', {
      text: 'Toggle entire sections of the app. Disabled modules disappear from the left nav and from Reports that depend on them.',
      cls: 'setting-item-description',
    });
    const ensureMods = () => {
      if (!this.plugin.settings.modules) {
        this.plugin.settings.modules = { crm: true, prm: true, planner: true };
      }
      return this.plugin.settings.modules;
    };
    [
      { key: 'planner', label: 'Planner', desc: 'Inbox, Today, Calendar, Projects.' },
      { key: 'crm',     label: 'CRM',     desc: 'Dashboard, Pipeline, Contacts, Companies, Activities + CRM-driven Reports.' },
      { key: 'prm',     label: 'PRM',     desc: 'Partners, Registrations, Commissions, Leads, Certifications, Analytics + Partner reports.' },
    ].forEach((m) => {
      new obsidian.Setting(containerEl)
        .setName(m.label)
        .setDesc(m.desc)
        .addToggle((t) => t
          .setValue(ensureMods()[m.key] !== false)
          .onChange(async (v) => {
            ensureMods()[m.key] = v;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          }));
    });

    /* ─── Reminders ─── */
    containerEl.createEl('h3', { text: 'Reminders' });
    new obsidian.Setting(containerEl)
      .setName('Desktop notifications')
      .setDesc('In addition to the in-app banner, fire a system notification when a reminder is due. Requires browser permission.')
      .addToggle((t) => t
        .setValue(!!this.plugin.settings.desktopNotifications)
        .onChange(async (v) => {
          this.plugin.settings.desktopNotifications = v;
          await this.plugin.saveSettings();
          if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (_) {}
          }
        }));

    new obsidian.Setting(containerEl)
      .setName('Notification permission')
      .setDesc(typeof Notification === 'undefined'
        ? 'Notifications API not available in this environment.'
        : `Current status: ${Notification.permission}`)
      .addButton((b) => b.setButtonText('Request permission').onClick(async () => {
        if (typeof Notification === 'undefined') return;
        try { await Notification.requestPermission(); this.display(); } catch (_) {}
      }));

    new obsidian.Setting(containerEl)
      .setName('Clear completed reminders')
      .setDesc(`${(this.plugin.settings.reminders || []).filter((r) => r.done).length} completed reminders stored.`)
      .addButton((b) => b.setButtonText('Clear').onClick(async () => {
        this.plugin.settings.reminders = (this.plugin.settings.reminders || []).filter((r) => !r.done);
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
        this.display();
      }));

    /* ─── App ─── */
    containerEl.createEl('h3', { text: 'App' });

    new obsidian.Setting(containerEl)
      .setName('Daily note folder')
      .setDesc('Folder under which daily notes live, e.g. "daily" or "Journal/Daily".')
      .addText((t) => t
        .setPlaceholder('daily')
        .setValue(this.plugin.settings.dailyNoteFolder)
        .onChange(async (v) => { this.plugin.settings.dailyNoteFolder = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(containerEl)
      .setName('Tasks heading')
      .setDesc('The H2 inside each daily note where tasks live. Default "## Today".')
      .addText((t) => t
        .setValue(this.plugin.settings.tasksHeading)
        .onChange(async (v) => { this.plugin.settings.tasksHeading = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(containerEl)
      .setName('Journal heading')
      .setDesc('The H2 where today\'s journal entry lives. Default "## Journal".')
      .addText((t) => t
        .setValue(this.plugin.settings.journalHeading)
        .onChange(async (v) => { this.plugin.settings.journalHeading = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(containerEl)
      .setName('Currency')
      .setDesc('Used to format money values across Pipeline, Reports and Commissions.')
      .addDropdown((d) => {
        CURRENCY_OPTIONS.forEach((c) => d.addOption(c.code, c.label));
        d.setValue(this.plugin.settings.currency || 'USD');
        d.onChange(async (v) => {
          this.plugin.settings.currency = v;
          await this.plugin.saveSettings();
          // Re-render any open Cadence tabs so values reformat immediately
          this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP).forEach((leaf) => {
            if (leaf.view && typeof leaf.view.render === 'function') leaf.view.render();
          });
        });
      });

    new obsidian.Setting(containerEl)
      .setName('Week starts on')
      .setDesc('First day of the week shown in the Planner tab.')
      .addDropdown((d) => d
        .addOption('1', 'Monday')
        .addOption('0', 'Sunday')
        .setValue(String(this.plugin.settings.weekStartsOn))
        .onChange(async (v) => {
          this.plugin.settings.weekStartsOn = Number(v) === 0 ? 0 : 1;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('Open Cadence on Obsidian startup')
      .setDesc('Auto-open the Cadence Home command centre when Obsidian launches.')
      .addToggle((t) => t
        .setValue(!!this.plugin.settings.openOnStartup)
        .onChange(async (v) => { this.plugin.settings.openOnStartup = v; await this.plugin.saveSettings(); }));

    const defaultDrop = new obsidian.Setting(containerEl)
      .setName('Default tab')
      .setDesc('Which surface opens first when you launch the Cadence app.');
    defaultDrop.addDropdown((d) => {
      NAV_GROUPS.forEach((g) => {
        g.items.forEach((s) => {
          const prefix = g.label ? `${g.label} · ` : '';
          d.addOption(s.id, prefix + s.label);
        });
      });
      d.setValue(this.plugin.settings.defaultTab || 'planner.today');
      d.onChange(async (v) => { this.plugin.settings.defaultTab = v; await this.plugin.saveSettings(); });
    });

    containerEl.createEl('h3', { text: 'Cloud sync — coming soon' });
    const cloudDesc = containerEl.createEl('p', { cls: 'setting-item-description' });
    cloudDesc.appendText('Future option to two-way sync your vault with a live Cadence instance, so contacts, deals and partners stay aligned across desktop and mobile. ');
    cloudDesc.createEl('strong', { text: 'Not active yet.' });
    cloudDesc.appendText(' These fields are persisted but unused until the sync feature ships in a later release.');
    new obsidian.Setting(containerEl)
      .setName('Cadence base URL')
      .setDesc('Coming soon')
      .addText((t) => {
        t.setPlaceholder('https://your-cadence-instance')
         .setValue(this.plugin.settings.cadenceApiUrl)
         .onChange(async (v) => { this.plugin.settings.cadenceApiUrl = v; await this.plugin.saveSettings(); });
        t.inputEl.disabled = true;
      });
    new obsidian.Setting(containerEl)
      .setName('API token')
      .setDesc('Coming soon')
      .addText((t) => {
        t.setPlaceholder('paste JWT here when sync ships')
         .setValue(this.plugin.settings.cadenceApiToken)
         .onChange(async (v) => { this.plugin.settings.cadenceApiToken = v; await this.plugin.saveSettings(); });
        t.inputEl.disabled = true;
      });
  }
}

/* ─────────── The plugin ─────────── */
class CadencePlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_CADENCE_APP,
      (leaf) => new CadenceAppView(leaf, this)
    );

    // Single ribbon icon → opens the Cadence app
    this.addRibbonIcon('sparkles', 'Open Cadence', () => this.openApp());

    this.addCommand({
      id: 'open-cadence',
      name: 'Open Cadence',
      callback: () => this.openApp(),
    });
    this.addCommand({
      id: 'open-cadence-home',
      name: 'Open Cadence — Home (command centre)',
      callback: () => this.openApp('home'),
    });
    this.addCommand({
      id: 'open-cadence-today',
      name: 'Open Cadence — Today',
      callback: () => this.openApp('planner.today'),
    });
    this.addCommand({
      id: 'open-cadence-calendar',
      name: 'Open Cadence — Calendar (week)',
      callback: () => this.openApp('planner.calendar'),
    });
    this.addCommand({
      id: 'open-cadence-pipeline',
      name: 'Open Cadence — Pipeline',
      callback: () => this.openApp('crm.pipeline'),
    });
    this.addCommand({
      id: 'new-daily-entry',
      name: 'New today entry (creates if missing)',
      callback: async () => {
        const file = await ensureDailyNote(this.app, this.settings);
        this.app.workspace.openLinkText(file.path, '', false);
      },
    });

    this.addSettingTab(new CadenceSettingTab(this.app, this));

    // ─── Quick capture (with optional reminder) ───
    this.addRibbonIcon('plus-circle', 'Cadence quick capture', () => this.openQuickCapture());
    this.addCommand({
      id: 'quick-capture',
      name: 'Quick capture (with optional reminder)',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'i' }],
      callback: () => this.openQuickCapture(),
    });
    this.addCommand({
      id: 'open-cadence-inbox',
      name: 'Open Cadence — Inbox',
      callback: () => this.openApp('planner.inbox'),
    });

    this.addCommand({
      id: 'cadence-import-csv',
      name: 'Import from CSV',
      callback: () => {
        // Default to whichever entity list the user is on, fallback to contact
        let entityKey = 'contact';
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP)[0];
        if (leaf && leaf.view) {
          const m = String(leaf.view.mode || '');
          if (m === 'crm.contacts')  entityKey = 'contact';
          else if (m === 'crm.companies') entityKey = 'company';
          else if (m === 'crm.activities') entityKey = 'activity';
          else if (m === 'crm.pipeline') entityKey = 'deal';
          else if (m === 'prm.partners') entityKey = 'partner';
          else if (m === 'prm.registrations') entityKey = 'registration';
          else if (m === 'prm.commissions') entityKey = 'commission';
          else if (m === 'prm.leads') entityKey = 'lead';
          else if (m === 'prm.certifications') entityKey = 'certification';
          else if (m === 'workflow.sequences') entityKey = 'sequence';
          else if (m === 'planner.projects') entityKey = 'project';
        }
        new CadenceImportModal(this.app, { entityKey }).open();
      },
    });

    // ─── Reminders engine ───
    // Tick once on load (catches anything that fired while Obsidian was closed),
    // then every 30s.
    this.app.workspace.onLayoutReady(() => this.tickReminders());
    this.registerInterval(window.setInterval(() => this.tickReminders(), 30 * 1000));

    // Optional: open Cadence Home on Obsidian startup.
    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => this.openApp('home'));
    }
  }

  /* ── Quick capture API ── */
  openQuickCapture(prefill) {
    new CadenceCaptureModal(this.app, {
      defaultText: prefill && prefill.text ? prefill.text : '',
      defaultWhen: prefill && prefill.when ? prefill.when : null,
      defaultRepeat: prefill && prefill.repeat ? prefill.repeat : 'none',
      onSubmit: async (result) => {
        if (!result) return;
        await this.addReminder({
          text: result.text,
          when: result.when,
          repeat: result.repeat || 'none',
        });

        // Also append to the relevant daily note's tasks section.
        // - Scheduled today / unscheduled → today's note
        // - Scheduled future date → that day's note
        const targetDate = result.when ? new Date(result.when) : new Date();
        let noteDate = new Date();
        if (!isNaN(targetDate.getTime())) noteDate = targetDate;
        let dailyNoteAppended = false;
        try {
          const file = await ensureDailyNote(this.app, this.settings, noteDate);
          const content = await this.app.vault.read(file);
          const parsed = parseSections(content, this.settings);
          const newTasks = [...parsed.tasks, `- [ ] ${result.text}`];
          const next = replaceSection(content, this.settings.tasksHeading, newTasks.join('\n'));
          await this.app.vault.modify(file, next);
          dailyNoteAppended = true;
        } catch (_) { /* non-fatal — reminder is still saved */ }

        const noteLabel = sameDay(noteDate, new Date()) ? "today's note" : `${ymd(noteDate)} note`;
        if (result.when) {
          new obsidian.Notice(`Reminder set · ${reminderTimeStr(result.when)}${dailyNoteAppended ? ` · added to ${noteLabel}` : ''}`);
        } else {
          new obsidian.Notice(`Captured to Inbox${dailyNoteAppended ? ` · added to ${noteLabel}` : ''}`);
        }
      },
    }).open();
  }

  /* ── Reminders CRUD ── */
  async addReminder(partial) {
    const r = {
      id: reminderId(),
      text: partial.text,
      when: partial.when || null,
      repeat: partial.repeat || 'none',
      notes: partial.notes || '',
      project: partial.project || null,  // file path of linked project, if any
      notified: false,
      done: false,
      createdAt: new Date().toISOString(),
    };
    if (!Array.isArray(this.settings.reminders)) this.settings.reminders = [];
    this.settings.reminders.push(r);
    await this.saveSettings();
    this.refreshOpenViews();
    return r;
  }

  async updateReminder(id, patch) {
    const i = (this.settings.reminders || []).findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.settings.reminders[i] = Object.assign({}, this.settings.reminders[i], patch);
    await this.saveSettings();
    this.refreshOpenViews();
    return this.settings.reminders[i];
  }

  async deleteReminder(id) {
    this.settings.reminders = (this.settings.reminders || []).filter((r) => r.id !== id);
    await this.saveSettings();
    this.refreshOpenViews();
  }

  async snoozeReminder(id, ms) {
    const target = new Date(Date.now() + ms);
    return this.updateReminder(id, {
      when: target.toISOString(),
      notified: false,
    });
  }

  async completeReminder(id) {
    return this.updateReminder(id, { done: true, notified: true });
  }

  refreshOpenViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP).forEach((leaf) => {
      if (leaf.view && typeof leaf.view.render === 'function') leaf.view.render();
    });
  }

  /* ── Reminder ticker ── */
  tickReminders() {
    if (!Array.isArray(this.settings.reminders)) return;
    const now = Date.now();
    let dirty = false;
    const additions = [];
    for (const r of this.settings.reminders) {
      if (r.done || r.notified) continue;
      if (!r.when) continue;
      const w = new Date(r.when).getTime();
      if (isNaN(w) || w > now) continue;
      this._fireReminder(r);
      r.notified = true;
      dirty = true;
      const next = nextRepeat(new Date(r.when), r.repeat);
      if (next) {
        additions.push({
          id: reminderId(),
          text: r.text,
          when: next.toISOString(),
          repeat: r.repeat,
          notified: false,
          done: false,
          createdAt: new Date().toISOString(),
        });
      }
    }
    if (additions.length) this.settings.reminders.push(...additions);
    if (dirty) {
      this.saveSettings().then(() => this.refreshOpenViews());
    }
  }

  _fireReminder(r) {
    new obsidian.Notice(`⏰  ${r.text}`, 8000);
    if (this.settings.desktopNotifications && typeof Notification !== 'undefined') {
      try {
        if (Notification.permission === 'granted') {
          new Notification('Cadence reminder', { body: r.text });
        }
      } catch (_) {}
    }
  }

  async openApp(mode = null) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_CADENCE_APP, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view && typeof leaf.view.setMode === 'function') {
      const target = mode || leaf.view.mode || 'home';
      // Reset week-view anchor to current week when (re)opening that surface
      if (target === 'planner.calendar') leaf.view.plannerAnchor = startOfDay(new Date());
      await leaf.view.setMode(target);
    }
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CADENCE_APP);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    CURRENT_CURRENCY = this.settings.currency || 'USD';
  }
  async saveSettings() {
    await this.saveData(this.settings);
    CURRENT_CURRENCY = this.settings.currency || 'USD';
  }
}

module.exports = CadencePlugin;
