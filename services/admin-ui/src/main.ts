import './style.css';

interface AlertRow {
  sk: string;
  stationId: string;
  name: string;
  minLevel: number;
  maxLevel: number;
  enabled: boolean;
  currentLevel: number | null;
  currentLevelAt: string | null;
  currentFlowM3s?: number | null;
  currentWaterTempC?: number | null;
}

interface AppConfig {
  apiBaseUrl?: string;
}

const ADMIN_KEY_STORAGE = 'imgwAdminApiKey';

let apiBase = '';

function readStoredAdminKey(): string {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? '';
}

function authFetchHeaders(extra?: Record<string, string>): Record<string, string> {
  const k = readStoredAdminKey();
  const h: Record<string, string> = { ...extra };
  if (k) {
    h['X-Admin-Key'] = k;
  }
  return h;
}

function clearAdminSession(): void {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
}

async function resolveApiBase(): Promise<string> {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (env?.trim()) {
    return env.trim().replace(/\/+$/, '');
  }
  const res = await fetch('config.json');
  if (!res.ok) {
    throw new Error(
      'Nie znaleziono config.json. Uruchom lokalnie z VITE_API_URL lub wdróż stack (CDK).'
    );
  }
  const cfg = (await res.json()) as AppConfig;
  const u = cfg.apiBaseUrl?.trim();
  if (!u) {
    throw new Error('config.json nie zawiera apiBaseUrl.');
  }
  return u.replace(/\/+$/, '');
}

function alertsUrl(): string {
  return `${apiBase}/alerts`;
}

async function apiGetAlerts(): Promise<AlertRow[]> {
  const res = await fetch(alertsUrl(), { headers: authFetchHeaders() });
  const data = (await res.json()) as { alerts?: AlertRow[]; error?: string };
  if (res.status === 401) {
    clearAdminSession();
    showLoginView();
    throw new Error('Sesja wygasła lub brak uprawnień.');
  }
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  return data.alerts ?? [];
}

async function apiCreate(body: {
  stationId: string;
  name: string;
  minLevel: number;
  maxLevel: number;
}): Promise<void> {
  const res = await fetch(alertsUrl(), {
    method: 'POST',
    headers: authFetchHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string };
  if (res.status === 401) {
    clearAdminSession();
    showLoginView();
    throw new Error('Sesja wygasła lub brak uprawnień.');
  }
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
}

async function apiUpdate(body: {
  sk: string;
  name: string;
  minLevel: number;
  maxLevel: number;
}): Promise<void> {
  const res = await fetch(alertsUrl(), {
    method: 'PUT',
    headers: authFetchHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string };
  if (res.status === 401) {
    clearAdminSession();
    showLoginView();
    throw new Error('Sesja wygasła lub brak uprawnień.');
  }
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
}

async function apiDelete(sk: string): Promise<void> {
  const res = await fetch(alertsUrl(), {
    method: 'DELETE',
    headers: authFetchHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sk }),
  });
  const data = (await res.json()) as { error?: string };
  if (res.status === 401) {
    clearAdminSession();
    showLoginView();
    throw new Error('Sesja wygasła lub brak uprawnień.');
  }
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
}

function sortAlerts(rows: AlertRow[]): AlertRow[] {
  return [...rows].sort((a, b) => {
    const ka = (a.name || a.stationId).toLowerCase();
    const kb = (b.name || b.stationId).toLowerCase();
    return ka.localeCompare(kb, 'pl');
  });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const app = document.querySelector('#app')!;

const loginShell = el('div', 'login-shell');
const loginCard = el('div', 'login-card');
const loginTitle = el('h1', 'login-title', 'Panel administracyjny');
const loginLead = el('p', 'login-lead', 'Wpisz hasło.');
const keyInput = document.createElement('input');
keyInput.type = 'password';
keyInput.className = 'login-input';
keyInput.autocomplete = 'current-password';
keyInput.id = 'admin-key-input';
const loginBtn = el('button', 'btn btn-primary login-submit', 'Zaloguj');
const loginError = el('p', 'login-error');
loginError.setAttribute('aria-live', 'polite');
loginCard.append(loginTitle, loginLead, keyInput, loginError, loginBtn);
loginShell.append(loginCard);

const mainShell = el('div', 'main-shell');

const header = el('header', 'page-head');
const titleBlock = el('div', 'title-stack');
const h1 = el('h1', '', 'Stacje i alerty');
const sub = el('p', '', 'Kliknij wiersz, aby edytować zakres lub nazwę.');
titleBlock.append(h1, sub);
const addBtn = el('button', 'btn btn-primary', 'Dodaj stację');
header.append(titleBlock, addBtn);

const tableWrap = el('div', 'table-wrap');
mainShell.append(header, tableWrap);
app.append(loginShell, mainShell);

function showLoginView(): void {
  loginShell.style.display = 'flex';
  mainShell.style.display = 'none';
}

function showMainView(): void {
  loginShell.style.display = 'none';
  mainShell.style.display = 'block';
}

async function verifyAdminKey(secret: string): Promise<'ok' | 'bad' | 'error'> {
  const res = await fetch(alertsUrl(), { headers: { 'X-Admin-Key': secret } });
  if (res.status === 200) {
    return 'ok';
  }
  if (res.status === 401) {
    return 'bad';
  }
  let msg = res.statusText;
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) msg = data.error;
  } catch {
    /* ignore */
  }
  throw new Error(msg);
}

loginBtn.addEventListener('click', async () => {
  loginError.textContent = '';
  const secret = keyInput.value.trim();
  if (!secret) {
    loginError.textContent = 'Wpisz hasło.';
    return;
  }
  try {
    const v = await verifyAdminKey(secret);
    if (v === 'bad') {
      loginError.textContent = 'Nieprawidłowe hasło.';
      return;
    }
    sessionStorage.setItem(ADMIN_KEY_STORAGE, secret);
    keyInput.value = '';
    showMainView();
    await refresh();
  } catch (e) {
    loginError.textContent = e instanceof Error ? e.message : String(e);
  }
});

keyInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    loginBtn.click();
  }
});

let rows: AlertRow[] = [];

function formatLevelCm(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${n} cm`;
}

function formatFlowM3s(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  const s = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
  return `${s} m³/s`;
}

function formatWaterTempC(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  const v = Number(n);
  const s = Number.isInteger(v) ? String(v) : String(Number(v.toFixed(1)));
  return `${s} °C`;
}

/** Status icon vs alert range: in range / below min / above max */
function levelStatusEmoji(r: AlertRow): string {
  const lv = r.currentLevel;
  if (lv === null || lv === undefined || Number.isNaN(Number(lv))) return '';
  const min = Number(r.minLevel);
  const max = Number(r.maxLevel);
  if (Number.isNaN(min) || Number.isNaN(max)) return '';
  if (lv >= min && lv <= max) return '✅ ';
  if (lv < min) return '🔻 ';
  return '🔺 ';
}

function renderTable(): void {
  tableWrap.innerHTML = '';
  if (rows.length === 0) {
    const empty = el('div', 'status-msg', 'Brak alertów. Dodaj pierwszą stację.');
    tableWrap.append(empty);
    return;
  }

  const table = el('table');
  const thead = el('thead');
  const trh = el('tr');
  for (const label of [
    'ID stacji',
    'Nazwa',
    'Min',
    'Max',
    'Stan wody',
    'Przepływ',
    'Temp. wody',
    '',
  ]) {
    const th = el('th', '', label);
    trh.append(th);
  }
  thead.append(trh);

  const tbody = el('tbody');
  for (const r of sortAlerts(rows)) {
    const tr = el('tr');
    tr.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.actions')) return;
      openFormModal(r);
    });

    const tdId = el('td', 'num', r.stationId);
    const tdName = el('td', '', r.name || '—');
    const tdMin = el('td', 'num', `${r.minLevel} cm`);
    const tdMax = el('td', 'num', `${r.maxLevel} cm`);
    const tdLevel = el('td', 'num level-cell');
    tdLevel.textContent = levelStatusEmoji(r) + formatLevelCm(r.currentLevel);

    const tdFlow = el('td', 'num', formatFlowM3s(r.currentFlowM3s ?? null));
    const tdTemp = el('td', 'num', formatWaterTempC(r.currentWaterTempC ?? null));

    const tdAct = el('td', 'actions');
    const del = el('button', 'btn btn-danger', 'Usuń');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal(r.sk);
    });
    tdAct.append(del);

    tr.append(tdId, tdName, tdMin, tdMax, tdLevel, tdFlow, tdTemp, tdAct);
    tbody.append(tr);
  }

  table.append(thead, tbody);
  tableWrap.append(table);
}

function showError(msg: string): void {
  window.alert(msg);
}

async function refresh(): Promise<void> {
  try {
    rows = await apiGetAlerts();
    renderTable();
  } catch (e) {
    tableWrap.innerHTML = '';
    const err = el('div', 'status-msg error', e instanceof Error ? e.message : String(e));
    tableWrap.append(err);
  }
}

/* —— Form modal (create / edit) —— */
const formBackdrop = el('div', 'modal-backdrop');
formBackdrop.style.display = 'none';
const formModal = el('div', 'modal');
const formTitle = el('h2', '', '');
const stationInput = document.createElement('input');
stationInput.type = 'text';
stationInput.id = 'f-station';
const nameInput = document.createElement('input');
nameInput.type = 'text';
nameInput.id = 'f-name';
const minInput = document.createElement('input');
minInput.type = 'text';
minInput.id = 'f-min';
const maxInput = document.createElement('input');
maxInput.type = 'text';
maxInput.id = 'f-max';

let editingSk: string | null = null;

function rowLabel(label: string, input: HTMLInputElement): HTMLElement {
  const wrap = el('div', 'form-row');
  const lab = el('label', '', label);
  lab.htmlFor = input.id;
  wrap.append(lab, input);
  return wrap;
}

const formCancel = el('button', 'btn btn-ghost', 'Anuluj');
const formSave = el('button', 'btn btn-primary', 'Zapisz');

formModal.append(
  formTitle,
  rowLabel('Identyfikator stacji IMGW', stationInput),
  rowLabel('Nazwa (własna)', nameInput),
  rowLabel('Poziom min (cm)', minInput),
  rowLabel('Poziom max (cm)', maxInput)
);

const formActions = el('div', 'modal-actions');
formActions.append(formCancel, formSave);
formModal.append(formActions);
formBackdrop.append(formModal);
document.body.append(formBackdrop);

function closeFormModal(): void {
  formBackdrop.style.display = 'none';
  editingSk = null;
}

formCancel.addEventListener('click', closeFormModal);
formBackdrop.addEventListener('click', (e) => {
  if (e.target === formBackdrop) closeFormModal();
});

formSave.addEventListener('click', async () => {
  const stationId = stationInput.value.trim();
  const name = nameInput.value.trim();
  const minLevel = Number(minInput.value);
  const maxLevel = Number(maxInput.value);

  try {
    if (editingSk) {
      await apiUpdate({ sk: editingSk, name, minLevel, maxLevel });
    } else {
      await apiCreate({ stationId, name, minLevel, maxLevel });
    }
    closeFormModal();
    await refresh();
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
});

function openFormModal(existing?: AlertRow): void {
  editingSk = existing ? existing.sk : null;
  formTitle.textContent = existing ? 'Edytuj alert' : 'Nowa stacja';
  stationInput.value = existing ? existing.stationId : '';
  stationInput.disabled = Boolean(existing);
  nameInput.value = existing ? existing.name : '';
  minInput.value = existing ? String(existing.minLevel) : '';
  maxInput.value = existing ? String(existing.maxLevel) : '';
  formSave.textContent = existing ? 'Zapisz' : 'Dodaj';
  formBackdrop.style.display = 'flex';
}

addBtn.addEventListener('click', () => openFormModal());

/* —— Delete modal —— */
const delBackdrop = el('div', 'modal-backdrop');
delBackdrop.style.display = 'none';
const delModal = el('div', 'modal');
const delTitle = el('h2', '', 'Usuń alert');
const delLead = el(
  'p',
  'lead',
  'Czy na pewno chcesz usunąć alert na tej stacji?'
);
const delActions = el('div', 'modal-actions');
const delCancel = el('button', 'btn btn-ghost', 'COFNIJ');
const delOk = el('button', 'btn btn-primary', 'OK');
delOk.style.background = 'var(--danger)';
delOk.style.color = '#fff';
delOk.addEventListener('mouseenter', () => {
  delOk.style.background = 'var(--danger-hover)';
});
delOk.addEventListener('mouseleave', () => {
  delOk.style.background = 'var(--danger)';
});

let deleteTargetSk: string | null = null;

delActions.append(delCancel, delOk);
delModal.append(delTitle, delLead, delActions);
delBackdrop.append(delModal);
document.body.append(delBackdrop);

function closeDeleteModal(): void {
  delBackdrop.style.display = 'none';
  deleteTargetSk = null;
}

delCancel.addEventListener('click', closeDeleteModal);
delBackdrop.addEventListener('click', (e) => {
  if (e.target === delBackdrop) closeDeleteModal();
});

delOk.addEventListener('click', async () => {
  if (!deleteTargetSk) return;
  try {
    await apiDelete(deleteTargetSk);
    closeDeleteModal();
    await refresh();
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
});

function openDeleteModal(sk: string): void {
  deleteTargetSk = sk;
  delBackdrop.style.display = 'flex';
}

async function boot(): Promise<void> {
  try {
    apiBase = await resolveApiBase();
  } catch (e) {
    loginShell.style.display = 'flex';
    mainShell.style.display = 'none';
    loginCard.innerHTML = '';
    loginCard.append(
      el('h1', 'login-title', 'Błąd konfiguracji'),
      el(
        'p',
        'login-error',
        e instanceof Error ? e.message : String(e)
      )
    );
    return;
  }

  if (readStoredAdminKey()) {
    showMainView();
    await refresh();
  } else {
    showLoginView();
  }
}

void boot();
