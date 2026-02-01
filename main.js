/*
  Proyecto: Evaluaciones
  - Inicio: listado de empleados activos (rrhh_legajos_stage) + filtros + busqueda + boton "Asignar"
  - Evaluaciones: asignacion Evaluador -> Evaluados (rrhh_eval_asignaciones) por anio

  Requiere: @supabase/supabase-js v2 (UMD) cargado en el HTML.
*/

const SUPABASE_URL = 'https://gsrivgwhmnbjzlbwdqlx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdzcml2Z3dobW5ianpsYndkcWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3MzAyNjYsImV4cCI6MjA3NDMwNjI2Nn0.v05nTMG5YzBStG_micruXMyd-NIGRfzTnCtjJu7uqb0';

const T_LEGAJOS = 'rrhh_legajos_stage';
const T_ASIG = 'rrhh_eval_asignaciones';

const T_EVAL_CAB = 'rrhh_eval_cab';
const T_EVAL_ITEMS = 'rrhh_eval_items';
const T_EVAL_RESP = 'rrhh_eval_respuestas';

// Compromiso y Presentismo
const T_CP_CAB = 'rrhh_cp_cab';
const T_CP_ITEMS = 'rrhh_cp_items';
const T_CP_RESP = 'rrhh_cp_respuestas';

const $ = (sel, r = document) => r.querySelector(sel);

// =========================
// Header fijo (global)
// - styles.css usa padding-top: var(--header-h)
// - esto evita que el contenido “tape” el header y hace que no desaparezca al scrollear
// =========================
(function syncHeaderHeight(){
  const header = document.querySelector('header');
  if (!header) return;
  const set = () => {
    const h = Math.ceil(header.getBoundingClientRect().height || 0);
    document.documentElement.style.setProperty('--header-h', `${h}px`);
  };
  set();
  window.addEventListener('resize', set, { passive: true });
})();

function escapeHtml(v){
  return String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function normalizeText(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function uniqSorted(arr){
  const out = Array.from(new Set(arr.filter(v => v !== null && v !== undefined).map(v => String(v).trim()).filter(v => v)));
  out.sort((a,b) => a.localeCompare(b, 'es'));
  return out;
}

function fillSelect(selectEl, values, { includeAllLabel } = { includeAllLabel: 'Todas' }){
  if (!selectEl) return;
  const cur = selectEl.value;
  selectEl.innerHTML = `<option value="">${escapeHtml(includeAllLabel || 'Todas')}</option>` +
    values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (values.includes(cur)) selectEl.value = cur;
}

function fillSelectPairs(selectEl, pairs, { includeAllLabel } = { includeAllLabel: 'Todos' }){
  // pairs: [{ value, label }]
  if (!selectEl) return;
  const cur = selectEl.value;

  const dedup = new Map();
  (pairs || []).forEach(p => {
    if (!p) return;
    const value = String(p.value ?? '').trim();
    const label = String(p.label ?? value).trim();
    if (!value) return;
    if (!dedup.has(value)) dedup.set(value, label);
  });

  const opts = Array.from(dedup.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a,b) => a.label.localeCompare(b.label, 'es'));

  selectEl.innerHTML = `<option value="">${escapeHtml(includeAllLabel || 'Todos')}</option>` +
    opts.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');

  if (dedup.has(cur)) selectEl.value = cur;
}

function formatDateOnly(isoOrDate){
  if (!isoOrDate) return '';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  // dd/mm/yyyy
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function formatDateShort(isoOrDate){
  if (!isoOrDate) return '';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  // dd/mm/yy
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function setText(id, txt){
  const el = document.getElementById(id);
  if (el) el.textContent = String(txt);
}

function setSaveState(msg){
  setText('saveState', msg);
}

function getPage(){
  return document.body?.dataset?.page || '';
}

function getFile(){
  return (location.pathname.split('/').pop() || '').toLowerCase();
}

function createClient(){
  // Evita multiples instancias (warning: Multiple GoTrueClient instances detected)
  if (window.supabaseClient) return window.supabaseClient;
  if (!window.supabase) throw new Error('No se cargo el SDK de Supabase.');
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return window.supabaseClient;
}

// Helper para mostrar errores completos de PostgREST/Supabase
function fmtErr(e){
  try{
    if (!e) return 'Error desconocido';
    const parts = [];
    if (e.message) parts.push(String(e.message));
    if (e.code) parts.push(`code=${e.code}`);
    if (e.details) parts.push(`details=${e.details}`);
    if (e.hint) parts.push(`hint=${e.hint}`);
    return parts.join(' | ');
  }catch(_){
    return 'Error desconocido';
  }
}

// =========================
// PIN + Sesión Evaluador (Opción 2)
// - Usa RPC: rrhh_validar_pin_crear_sesion(p_legajo_nro, p_pin, p_horas)
// - Usa RPC: rrhh_validar_sesion(p_session_id)
// Guarda session_id + legajo_id en localStorage para reingreso.
// =========================
const RRHH_EVAL_SESSION_KEY = 'rrhh_eval_session_id';
const RRHH_EVAL_LEGAJO_ID_KEY = 'rrhh_eval_legajo_id';
const RRHH_EVAL_LEGAJO_NRO_KEY = 'rrhh_eval_legajo_nro';

function rrhhGetStoredSession(){
  try{
    const sid = localStorage.getItem(RRHH_EVAL_SESSION_KEY) || '';
    const legajoId = localStorage.getItem(RRHH_EVAL_LEGAJO_ID_KEY) || '';
    const legajoNro = (localStorage.getItem(RRHH_EVAL_LEGAJO_NRO_KEY) || '').trim().toUpperCase();
    return { sid, legajoId, legajoNro };
  }catch(_){
    return { sid:'', legajoId:'', legajoNro:'' };
  }
}

function rrhhIsUuid(v){
  const s = String(v || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}


function rrhhClearStoredSession(){
  try{
    localStorage.removeItem(RRHH_EVAL_SESSION_KEY);
    localStorage.removeItem(RRHH_EVAL_LEGAJO_ID_KEY);
    localStorage.removeItem(RRHH_EVAL_LEGAJO_NRO_KEY);
  }catch(_){}
}

function rrhhStoreSession({ session_id, legajo_id, legajo_nro }){
  try{
    localStorage.setItem(RRHH_EVAL_SESSION_KEY, String(session_id || ''));
    localStorage.setItem(RRHH_EVAL_LEGAJO_ID_KEY, String(legajo_id || ''));
    if (legajo_nro) localStorage.setItem(RRHH_EVAL_LEGAJO_NRO_KEY, String(legajo_nro).trim().toUpperCase());
  }catch(_){}
}

function rrhhEnsurePinModal(){
  if (document.getElementById('rrhhPinModal')) return;

  const wrap = document.createElement('div');
  wrap.id = 'rrhhPinModal';
  wrap.style.cssText = [
    'position:fixed','inset:0','display:none','align-items:center','justify-content:center',
    'background:rgba(0,0,0,.45)','z-index:9999','padding:16px'
  ].join(';');

  wrap.innerHTML = `
    <div style="width:min(420px,100%);background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.25);overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-between">
        <div style="font-weight:700">Validación de evaluador</div>
        <button type="button" id="rrhhPinClose" aria-label="Cerrar" style="border:0;background:transparent;font-size:20px;cursor:pointer;line-height:1">×</button>
      </div>
      <div style="padding:16px">
        <div style="font-size:14px;opacity:.85;margin-bottom:10px">
          Ingresá tu <b>Legajo Nro.</b> (clave) para continuar.
        </div>

        <label for="rrhhLegajoNro" style="display:block;font-size:13px;margin:10px 0 6px">Legajo Nro.</label>
        <input id="rrhhLegajoNro" autocomplete="off" inputmode="text"
               style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,.18);border-radius:10px" />

        <div id="rrhhPinErr" style="display:none;margin-top:10px;color:#b91c1c;font-size:13px"></div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button type="button" id="rrhhPinCancel" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(0,0,0,.18);background:#fff;cursor:pointer">Cancelar</button>
          <button type="button" id="rrhhPinOk" style="padding:9px 12px;border-radius:10px;border:0;background:#1e3a89;color:#fff;cursor:pointer">Validar</button>
        </div>

        <div style="margin-top:12px;font-size:12px;opacity:.7">
          La validación queda recordada hasta que expire la sesión.
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  const close = () => { wrap.style.display = 'none'; };

  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelector('#rrhhPinClose')?.addEventListener('click', close);
  wrap.querySelector('#rrhhPinCancel')?.addEventListener('click', close);
}

async function rrhhValidateStoredSession(supa){
  const { sid } = rrhhGetStoredSession();
  if (!sid) return { ok:false, legajo_id:'', expires_at:null };

  // ✅ si no es UUID, limpiamos y NO llamamos a la RPC (evita 400)
  if (!rrhhIsUuid(sid)){
    rrhhClearStoredSession();
    return { ok:false, legajo_id:'', expires_at:null };
  }

  const { data, error } = await supa.rpc('rrhh_validar_sesion', { p_session_id: sid });
  if (error) return { ok:false, legajo_id:'', expires_at:null, error };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.ok) return { ok:false, legajo_id:'', expires_at:null };

  return { ok:true, legajo_id: String(row.legajo_id || ''), expires_at: row.expires_at || null };
}

async function rrhhPromptAndCreateSession(supa){
  rrhhEnsurePinModal();

  const modal = document.getElementById('rrhhPinModal');
  const inp = document.getElementById('rrhhLegajoNro');
  const err = document.getElementById('rrhhPinErr');
  const btnOk = document.getElementById('rrhhPinOk');
  const btnCancel = document.getElementById('rrhhPinCancel');

  const setErr = (msg) => {
    if (!err) return;
    if (!msg){ err.style.display='none'; err.textContent=''; return; }
    err.style.display='block';
    err.textContent = msg;
  };

  return new Promise((resolve) => {
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      btnOk?.removeEventListener('click', onOk);
      btnCancel?.removeEventListener('click', onCancel);
      modal.style.display = 'none';
    };

    const onCancel = () => { cleanup(); resolve({ ok:false, cancelled:true }); };

    const onOk = async () => {
      const legajoNro = String(inp?.value || '').trim().toUpperCase();
      if (!legajoNro){ setErr('Ingresá el Legajo Nro.'); inp?.focus(); return; }

      setErr('');
      btnOk.disabled = true;
      btnOk.style.opacity = '.8';

      // En tu diseño, la clave ES el Legajo Nro. ⇒ usamos el mismo valor para p_pin.
      const { data, error } = await supa.rpc('rrhh_validar_pin_crear_sesion', {
        p_legajo_nro: legajoNro,
        p_pin: legajoNro,
        p_horas: 12
      });

      btnOk.disabled = false;
      btnOk.style.opacity = '1';

      if (error){
    console.error('PIN/SESIÓN ERROR:', error);
    setErr(error?.message || 'Clave inválida o sesión no creada.');
    return;
  }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.session_id || !row.legajo_id){
        setErr('No se pudo crear la sesión.');
        return;
      }

      rrhhStoreSession({ session_id: row.session_id, legajo_id: row.legajo_id, legajo_nro: legajoNro });
      cleanup();
      resolve({ ok:true, legajo_id: String(row.legajo_id), session_id: String(row.session_id), expires_at: row.expires_at || null });
    };

    btnOk?.addEventListener('click', onOk);
    btnCancel?.addEventListener('click', onCancel);

    // Mostrar modal
    modal.style.display = 'flex';
    setErr('');
    if (inp){
      // Prefill si existía un nro guardado
      const { legajoNro } = rrhhGetStoredSession();
      if (legajoNro) inp.value = legajoNro;
      setTimeout(() => inp.focus(), 50);
    }
  });
}

async function rrhhEnsureAuthorizedEvaluator(supa, targetEvaluadorId){
  const wanted = String(targetEvaluadorId || '').trim();
  if (!wanted) return { ok:false, reason:'no_target' };

  // 1) Si ya hay sesión válida, chequea coincidencia.
  const st = await rrhhValidateStoredSession(supa);
  if (st.ok){
    if (String(st.legajo_id) === wanted) return { ok:true, legajo_id: wanted, from:'stored' };

    // Hay una sesión válida pero pertenece a otro evaluador.
    // Permitimos cambiar de evaluador: limpiamos la sesión y pedimos nuevamente la clave.
    rrhhClearStoredSession();
  }

  // 2) Pedir PIN y crear sesión.
  const created = await rrhhPromptAndCreateSession(supa);
  if (!created.ok) return { ok:false, reason: created.cancelled ? 'cancelled' : 'invalid' };

  // 3) Validar que la sesión creada sea del evaluador seleccionado.
  if (String(created.legajo_id) !== wanted){
    rrhhClearStoredSession();
    return { ok:false, reason:'pin_not_for_selected', created_legajo_id: created.legajo_id };
  }

  return { ok:true, legajo_id: wanted, from:'created' };
}

// Exponer util para debug desde consola
window.rrhhClearEvalSession = rrhhClearStoredSession;


function markActiveNav(){
  const here = (location.pathname.split('/').pop() || '').toLowerCase();
  document.querySelectorAll('a.nav-link').forEach(a => {
    const href = (a.getAttribute('href') || '').split('/').pop().toLowerCase();
    a.classList.toggle('active', href === here);
  });
}

// =========================
// Botón flotante: Volver Arriba (global)
// - Se inyecta por JS para poder reutilizarlo en todas las páginas.
// - Se muestra al scrollear y vuelve al inicio (header).
// =========================
function ensureBackToTop(){
  if (document.getElementById('rrhhBackTop')) return;

  const btn = document.createElement('button');
  btn.id = 'rrhhBackTop';
  btn.type = 'button';
  btn.className = 'backtop';
  btn.setAttribute('aria-label', 'Volver arriba');
  btn.innerHTML = `
    <span class="backtop__icon" aria-hidden="true">↑</span>
    <span class="backtop__text">Arriba</span>
  `;

  document.body.appendChild(btn);

  const toggle = () => {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    btn.classList.toggle('show', y > 260);
  };

  toggle();
  window.addEventListener('scroll', toggle, { passive:true });
  window.addEventListener('resize', toggle);

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// =========================
// INICIO
// =========================

let inicioRows = [];

function inicioApplyAndRender(){
  const fGer = $('#fGerencia')?.value || '';
  const fSuc = $('#fSucursal')?.value || '';
  const fSec = $('#fSector')?.value || '';
  const q = normalizeText(($('#search')?.value || '').trim());

  let rows = inicioRows;
  if (fGer) rows = rows.filter(r => (r.gerencia || '') === fGer);
  if (fSuc) rows = rows.filter(r => (r.sucursal || '') === fSuc);
  if (fSec) rows = rows.filter(r => (r.sector || '') === fSec);

  if (q){
    rows = rows.filter(r => normalizeText(`${r.nombre} ${r.sucursal} ${r.gerencia} ${r.sector}`).includes(q));
  }

  rows = rows.slice().sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));

  setText('count', rows.length);

  const tbody = $('#tbody');
  if (!tbody) return;

  tbody.innerHTML = rows.map(r => {
    const url = `asignaciones.html?evaluador_id=${encodeURIComponent(r.id)}&anio=2026`;
    return `<tr>
      <td>${escapeHtml(r.nombre)}</td>
      <td>${escapeHtml(r.sucursal)}</td>
      <td>${escapeHtml(r.gerencia)}</td>
      <td>${escapeHtml(r.sector)}</td>
      <td class="td-actions"><a class="btn btn-sm btn-icon" href="${url}" title="Asignar"><img class="btn-ico" src="usuario.png" alt="" /><span class="sr-only">Asignar</span></a></td>
    </tr>`;
  }).join('');

  // Re-sync sticky header de Inicio (si está activo)
  if (window.__inicioSticky?.sync) window.__inicioSticky.sync();

}

// =========================
// Sticky header de la tabla (SOLO inicio.html)
// - Igual enfoque que flags: clon fijo del thead, pegado debajo del header principal.
// - Mantiene columnas alineadas y sincroniza scroll horizontal.
// =========================
function inicioSetupStickyHeader(){
  if (document.body?.dataset?.page !== 'inicio') return;

  const wrap = document.querySelector('.inicio-table-card .table-wrap');
  const table = wrap?.querySelector('table');
  const thead = table?.querySelector('thead');
  if (!wrap || !table || !thead) return;

  let host = document.getElementById('inicioStickyHead');
  if (!host){
    host = document.createElement('div');
    host.id = 'inicioStickyHead';
    host.className = 'inicio-sticky-head';
    host.innerHTML = '<div class="inicio-sticky-clip"></div>';
    document.body.appendChild(host);
  }
  const clip = host.querySelector('.inicio-sticky-clip');

  // Build clone thead (una sola vez)
  if (!host._built){
    const cloneTable = document.createElement('table');
    const cloneThead = thead.cloneNode(true);
    cloneTable.appendChild(cloneThead);
    clip.innerHTML = '';
    clip.appendChild(cloneTable);
    host._table = cloneTable;
    host._built = true;
  }

  const sync = () => {
    const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0;

    const wrapRect = wrap.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const theadRect = thead.getBoundingClientRect();

    // Clip del sticky al ancho visible del wrap
    host.style.left = `${wrapRect.left}px`;
    host.style.width = `${wrapRect.width}px`;

    // Ancho real de la tabla (para que coincidan columnas)
    host._table.style.width = `${tableRect.width}px`;

    // Sincronizar anchos de columnas
    const srcTh = Array.from(thead.querySelectorAll('th'));
    const dstTh = Array.from(host._table.querySelectorAll('th'));
    srcTh.forEach((th, i) => {
      const w = Math.ceil(th.getBoundingClientRect().width);
      if (dstTh[i]) dstTh[i].style.width = `${w}px`;
    });

    // Sincronizar scroll horizontal
    const sl = wrap.scrollLeft || 0;
    host._table.style.transform = `translateX(${-sl}px)`;

    // Mostrar/ocultar según scroll vertical de la página
    const theadTop = theadRect.top + window.scrollY;
    const tableBottom = tableRect.bottom + window.scrollY;
    const theadH = theadRect.height || 0;

    const y = window.scrollY + headerH;
    const visible = (y >= theadTop) && (y < (tableBottom - theadH));

    if (visible){
      host.classList.add('is-visible');
      document.body.classList.add('inicio-sticky-on');
    }else{
      host.classList.remove('is-visible');
      document.body.classList.remove('inicio-sticky-on');
    }
  };

  // Exponer para re-sync después de renders
  window.__inicioSticky = { sync };

  // Listeners (solo una vez)
  if (!host._listeners){
    window.addEventListener('scroll', () => sync(), { passive: true });
    window.addEventListener('resize', () => sync(), { passive: true });
    wrap.addEventListener('scroll', () => sync(), { passive: true });
    host._listeners = true;
  }

  sync();
}

async function initInicio(){
  const supa = createClient();

  // Leer solo activos
  const { data, error } = await supa
    .from(T_LEGAJOS)
    .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector","Baja"')
    .eq('Baja', 'Activo')
    .limit(5000);

  if (error) throw error;

  const raw = Array.isArray(data) ? data : [];

  inicioRows = raw.map(r => ({
    id: r['ID'],
    nombre: resCleanName(r['Nombre Completo'] || '—'),
    sucursal: r['Sucursal'] || '',
    gerencia: r['Gerencia'] || '',
    sector: r['Sector'] || ''
  }));

  fillSelect($('#fGerencia'), uniqSorted(inicioRows.map(r => r.gerencia)), { includeAllLabel: 'Todas' });
  fillSelect($('#fSucursal'), uniqSorted(inicioRows.map(r => r.sucursal)), { includeAllLabel: 'Todas' });
  fillSelect($('#fSector'), uniqSorted(inicioRows.map(r => r.sector)), { includeAllLabel: 'Todos' });

  $('#fGerencia')?.addEventListener('change', inicioApplyAndRender);
  $('#fSucursal')?.addEventListener('change', inicioApplyAndRender);
  $('#fSector')?.addEventListener('change', inicioApplyAndRender);
  $('#search')?.addEventListener('input', inicioApplyAndRender);

  inicioApplyAndRender();

  // Sticky del encabezado de la tabla (solo Inicio)
  inicioSetupStickyHeader();
}

// =========================
// EVALUACIONES
// =========================

let evalE = { id: null, nombre: '', sucursal: '', gerencia: '', sector: '' };
let evalAnio = 2026;
let evaluables = []; // {id,nombre,sucursal,gerencia,sector}
let asignados = new Set(); // evaluado_id activos
let pending = 0;
let focusEvaluadoId = ''; // opcional: evaluado a enfocar (viene desde Listado Asignaciones)

function evalUpdateCounters(visibleCount){
  setText('countSel', asignados.size);
  setText('countEva', visibleCount);
}

function evalApplyAndRender(){
  const fGer = $('#aGerencia')?.value || '';
  const fSuc = $('#aSucursal')?.value || '';
  const fSec = $('#aSector')?.value || '';
  const q = normalizeText(($('#aSearch')?.value || '').trim());

  let rows = evaluables;
  // No permitir que el evaluador se asigne a si mismo
  if (evalE?.id) rows = rows.filter(r => r.id !== evalE.id);
  if (fGer) rows = rows.filter(r => (r.gerencia || '') === fGer);
  if (fSuc) rows = rows.filter(r => (r.sucursal || '') === fSuc);
  if (fSec) rows = rows.filter(r => (r.sector || '') === fSec);
  if (q){
    rows = rows.filter(r => normalizeText(`${r.nombre} ${r.sucursal} ${r.gerencia} ${r.sector}`).includes(q));
  }

  rows = rows.slice().sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Si venimos desde Listado Asignaciones, traemos el evaluado elegido al inicio.
  if (focusEvaluadoId){
    const idx = rows.findIndex(r => String(r.id) === String(focusEvaluadoId));
    if (idx > 0){
      const [picked] = rows.splice(idx, 1);
      rows.unshift(picked);
    }
  }

  const list = $('#evaList');
  if (!list) return;

  const isAsignacionesPage = getPage() === 'asignaciones';

  const renderItem = (r) => {
    const checked = asignados.has(r.id) ? 'checked' : '';
    const meta = isAsignacionesPage
      ? (r.gerencia || '—')
      : [r.sucursal, r.gerencia, r.sector].filter(Boolean).join(' · ');
    const input = `<input class="chk" type="checkbox" data-evaluado-id="${escapeHtml(r.id)}" ${checked} />`;
    const focusClass = (focusEvaluadoId && String(r.id) === String(focusEvaluadoId)) ? ' focus' : '';
    return `<label class="item${focusClass}">
      <div class="item-main">
        <div class="item-title">${escapeHtml(r.nombre)}</div>
        <div class="item-sub">${escapeHtml(meta)}</div>
      </div>
      ${isAsignacionesPage ? `<div class="item-check">${input}</div>` : input}
    </label>`;
  };

  if (isAsignacionesPage){
    // Para que el separador horizontal quede alineado por fila (2 columnas)
    // renderizamos por parejas dentro de un contenedor de fila.
    const chunks = [];
    for (let i = 0; i < rows.length; i += 2){
      const left = rows[i];
      const right = rows[i + 1];
      chunks.push(`<div class="pair-row">${renderItem(left)}${right ? renderItem(right) : '<div class="pair-empty"></div>'}</div>`);
    }
    list.innerHTML = chunks.join('');
  } else {
    list.innerHTML = rows.map(renderItem).join('');
  }

  // listeners
  list.querySelectorAll('input.chk').forEach(chk => {
    chk.addEventListener('change', async (ev) => {
      const target = ev.currentTarget;
      const evaluadoId = target.getAttribute('data-evaluado-id');
      const want = target.checked;
      if (!evalE.id || !evaluadoId) return;
      if (evaluadoId === String(evalE.id)) { target.checked = false; return; }

      target.disabled = true;
      try{
        await evalSaveOne(evaluadoId, want);
      }finally{
        target.disabled = false;
      }
    });
  });

  evalUpdateCounters(rows.length);
}

function renderEvaluadorCard(){
  const card = $('#evaluadorCard');
  if (!card) return;

  if (!evalE.id){
    card.innerHTML = `<div class="muted">Selecciona un empleado en Inicio y toca “Asignar”.</div>`;
    return;
  }

  card.innerHTML = `
    <div class="e-name">${escapeHtml(evalE.nombre)}</div>
    <div class="e-meta">
      <div><strong>Sucursal:</strong> ${escapeHtml(evalE.sucursal || '—')}</div>
      <div><strong>Gerencia:</strong> ${escapeHtml(evalE.gerencia || '—')}</div>
    </div>
    <div class="e-actions">
      <a class="btn btn-sm" href="inicio.html">Volver a Inicio</a>
    </div>
  `;
}

async function evalLoadAsignados(supa){
  if (!evalE.id) return;
  const { data, error } = await supa
    .from(T_ASIG)
    .select('evaluado_id')
    .eq('anio', evalAnio)
    .eq('evaluador_id', evalE.id)
    .eq('activo', true)
    .limit(10000);

  if (error) throw error;
  asignados = new Set((data || []).map(r => r.evaluado_id));
  // Evitar auto-asignación si existiera en DB
  if (evalE?.id) asignados.delete(evalE.id);
}

async function evalSaveOne(evaluadoId, activo){
  const supa = createClient();
  pending += 1;
  setSaveState('Guardando...');

  try{
    if (activo){
      const payload = {
        anio: evalAnio,
        evaluador_id: evalE.id,
        evaluado_id: evaluadoId,
        activo: true,
        actualizado_at: new Date().toISOString(),
      };

      const { error } = await supa
        .from(T_ASIG)
        .upsert(payload, { onConflict: 'anio,evaluador_id,evaluado_id' });

      if (error) throw error;
    } else {
      // Si se destilda: borrar la asignación (en lugar de dejar activo=false)
      const { error } = await supa
        .from(T_ASIG)
        .delete()
        .match({ anio: evalAnio, evaluador_id: evalE.id, evaluado_id: evaluadoId });

      if (error) throw error;
    }

    if (activo) asignados.add(evaluadoId);
    else asignados.delete(evaluadoId);

    setSaveState('Guardado');
    evalUpdateCounters(document.querySelectorAll('#evaList .item').length);
  }catch(err){
    console.error(err);
    setSaveState('Error');
    // revert UI best-effort
    const chk = document.querySelector(`#evaList input.chk[data-evaluado-id="${CSS.escape(evaluadoId)}"]`);
    if (chk) chk.checked = !activo;
  }finally{
    pending -= 1;
  }
}

async function evalForceSync(){
  if (!evalE.id) return;
  const supa = createClient();
  setSaveState('Sincronizando...');
  try{
    await evalLoadAsignados(supa);
    evalApplyAndRender();
    setSaveState('OK');
  }catch(err){
    console.error(err);
    setSaveState('Error');
  }
}

async function initEvaluaciones(){
  const supa = createClient();

  const params = new URLSearchParams(location.search);
  const evaluadorId = params.get('evaluador_id');
  // En Asignaciones NO validamos PIN/sesión (la validación solo aplica en Evaluaciones).
  // Si se entra desde el menú (sin evaluador_id), no mostramos alerta: queda la pantalla informativa.
  if (!evaluadorId){
    setSaveState('Seleccioná un Evaluador en Inicio.');
    return;
  }
  focusEvaluadoId = params.get('evaluado_id') || '';
  const anioParam = params.get('anio');
  evalAnio = Number(anioParam || 2026) || 2026;

  const anioInput = $('#anio');
  if (anioInput){
    anioInput.value = String(evalAnio);
    anioInput.addEventListener('change', async () => {
      const v = Number(anioInput.value);
      if (!Number.isFinite(v) || v < 2000 || v > 2100) return;
      evalAnio = v;
      setText('anioLabel', evalAnio);
      await evalForceSync();
    });
  }

  setText('anioLabel', evalAnio);

  // Cargar evaluador elegido
  if (evaluadorId){
    const { data, error } = await supa
      .from(T_LEGAJOS)
      .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector"')
      .eq('ID', evaluadorId)
      .single();

    if (error) throw error;

    evalE = {
      id: data['ID'],
      nombre: data['Nombre Completo'] || '—',
      sucursal: data['Sucursal'] || '',
      gerencia: data['Gerencia'] || '',
      sector: data['Sector'] || ''
    };
  } else {
    evalE = { id: null, nombre: '', sucursal: '', gerencia: '', sector: '' };
  }

  renderEvaluadorCard();
  // Cargar lista de evaluables (por flags.es_evaluable_desempeno)
  // Nota: NO usamos rrhh_legajos_stage.es_evaluable (migracion a flags)
  const { data: dLeg, error: eLeg } = await supa
    .from(T_LEGAJOS)
    .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector","Baja"')
    .eq('Baja', 'Activo')
    .limit(5000);

  if (eLeg) throw eLeg;

  const legRows = Array.isArray(dLeg) ? dLeg : [];
  const ids = legRows.map(r => r['ID']).filter(Boolean);

  // Traer flags solo para estos IDs (si ids esta vacio, usamos un UUID dummy para evitar error en .in)
  const { data: dFlags, error: eFlags } = await supa
    .from(T_FLAGS)
    .select('legajo_id,es_evaluable_desempeno')
    .in('legajo_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    .limit(10000);

  if (eFlags) throw eFlags;

  const mFlags = new Map((dFlags || []).map(f => [String(f.legajo_id), (typeof f.es_evaluable_desempeno === 'boolean') ? f.es_evaluable_desempeno : true]));

  // default: si falta flag para alguien, lo consideramos evaluable (no lo ocultamos por error de datos)
  evaluables = legRows
    .filter(r => mFlags.get(String(r['ID'])) !== false)
    .map(r => ({
      id: r['ID'],
      nombre: resCleanName(r['Nombre Completo'] || '—'),
      sucursal: r['Sucursal'] || '',
      gerencia: r['Gerencia'] || '',
      sector: r['Sector'] || ''
    }));

  fillSelect($('#aGerencia'), uniqSorted(evaluables.map(r => r.gerencia)), { includeAllLabel: 'Todas' });
  fillSelect($('#aSucursal'), uniqSorted(evaluables.map(r => r.sucursal)), { includeAllLabel: 'Todas' });
  fillSelect($('#aSector'), uniqSorted(evaluables.map(r => r.sector)), { includeAllLabel: 'Todos' });

  $('#aGerencia')?.addEventListener('change', evalApplyAndRender);
  $('#aSucursal')?.addEventListener('change', evalApplyAndRender);
  $('#aSector')?.addEventListener('change', evalApplyAndRender);
  $('#aSearch')?.addEventListener('input', evalApplyAndRender);
  // Imprimir / Guardar como PDF (Asignaciones)
  document.getElementById('btnImprimir')?.addEventListener('click', () => {
    // Abre el diálogo del navegador (permite “Guardar como PDF”)
    window.print();
  });

  // Asignados
  if (evalE.id){
    await evalLoadAsignados(supa);
  }

  setSaveState('OK');
  evalApplyAndRender();
}

// =========================
// LISTADO ASIGNACIONES
// =========================

let listAnio = 2026;
let listAll = []; // filas completas

function listApplyAndRender(){
  const fEval = $('#lEvaluador')?.value || '';
  const fEva = $('#lEvaluado')?.value || '';
  const fSuc = $('#lSucursal')?.value || '';
  const fGer = $('#lGerencia')?.value || '';
  const q = normalizeText(($('#lSearch')?.value || '').trim());

  let rows = listAll;
  if (fEval) rows = rows.filter(r => String(r.evaluador_id) === String(fEval));
  if (fEva) rows = rows.filter(r => String(r.evaluado_id) === String(fEva));
  if (fSuc) rows = rows.filter(r => (r.sucursal || '') === fSuc);
  if (fGer) rows = rows.filter(r => (r.gerencia || '') === fGer);
  if (q){
    rows = rows.filter(r => normalizeText(`${r.evaluador_nombre} ${r.evaluado_nombre} ${r.sucursal} ${r.gerencia}`).includes(q));
  }

  // Orden: evaluador, evaluado
  rows = rows.slice().sort((a,b) => {
    const c1 = a.evaluador_nombre.localeCompare(b.evaluador_nombre, 'es');
    if (c1 !== 0) return c1;
    return a.evaluado_nombre.localeCompare(b.evaluado_nombre, 'es');
  });

  setText('lCountTotal', listAll.length);
  setText('lCountVis', rows.length);

  const tbody = $('#lTbody');
  if (!tbody) return;

  tbody.innerHTML = rows.map(r => {
    const hrefAsignar = `asignaciones.html?evaluador_id=${encodeURIComponent(r.evaluador_id)}&anio=${encodeURIComponent(listAnio)}&evaluado_id=${encodeURIComponent(r.evaluado_id)}`;
    const hrefEvaluar = `evaluaciones.html?evaluador_id=${encodeURIComponent(r.evaluador_id)}&anio=${encodeURIComponent(listAnio)}&evaluado_id=${encodeURIComponent(r.evaluado_id)}`;
    const act = formatDateOnly(r.actualizado || r.updated_at || r.created_at);
    return `<tr>
      <td>${escapeHtml(r.evaluador_nombre)}</td>
      <td>${escapeHtml(r.evaluado_nombre)}</td>
      <td>${escapeHtml(r.sucursal || '—')}</td>
      <td>${escapeHtml(r.gerencia || '—')}</td>
      <td>${escapeHtml(r.anio)}</td>
      <td>${escapeHtml(act)}</td>
      <td class="td-actions">
        <a class="btn btn-sm btn-icon" href="${hrefAsignar}" title="Asignar">
          <i class="bi bi-person-plus btn-ico" aria-hidden="true"></i>
          <span class="sr-only">Asignar</span>
        </a>
      </td>
      <td class="td-actions">
        <a class="btn btn-sm btn-icon" href="${hrefEvaluar}" title="Evaluar">
          <i class="bi bi-clipboard-check btn-ico" aria-hidden="true"></i>
          <span class="sr-only">Evaluar</span>
        </a>
      </td>
    </tr>`;
  }).join('');

  // Reaplicar filtro de búsqueda local (Completas), si hay texto cargado
  dApplyCompletasSearchFilter();
}

function listExportCSV(){
  const tbody = $('#lTbody');
  if (!tbody) return;

  // Reaplicar filtros para exportar exactamente lo visible
  const fEval = $('#lEvaluador')?.value || '';
  const fEva = $('#lEvaluado')?.value || '';
  const fSuc = $('#lSucursal')?.value || '';
  const fGer = $('#lGerencia')?.value || '';
  const q = normalizeText(($('#lSearch')?.value || '').trim());

  let rows = listAll;
  if (fEval) rows = rows.filter(r => String(r.evaluador_id) === String(fEval));
  if (fEva) rows = rows.filter(r => String(r.evaluado_id) === String(fEva));
  if (fSuc) rows = rows.filter(r => (r.sucursal || '') === fSuc);
  if (fGer) rows = rows.filter(r => (r.gerencia || '') === fGer);
  if (q){
    rows = rows.filter(r => normalizeText(`${r.evaluador_nombre} ${r.evaluado_nombre} ${r.sucursal} ${r.gerencia}`).includes(q));
  }

  const header = ['anio','evaluador_id','evaluador','evaluado_id','evaluado','sucursal','gerencia','actualizado'];
  const lines = [header.join(',')];
  rows.forEach(r => {
    const values = [
      r.anio,
      r.evaluador_id,
      r.evaluador_nombre,
      r.evaluado_id,
      r.evaluado_nombre,
      r.sucursal || '',
      r.gerencia || '',
      formatDateOnly(r.actualizado || r.updated_at || r.created_at)
    ].map(v => {
      const s = String(v ?? '');
      // CSV escape
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
      return s;
    });
    lines.push(values.join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `listado_asignaciones_${listAnio}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function initListado(){
  const supa = createClient();

  const anioInput = $('#lAnio');
  listAnio = Number(anioInput?.value || 2026) || 2026;
  setText('lAnioLabel', listAnio);

  async function load(){
    setText('lState', 'Cargando...');
    setText('lAnioLabel', listAnio);

    const { data: asigs, error } = await supa
      .from(T_ASIG)
      .select('*')
      .eq('anio', listAnio)
      .limit(10000);

    if (error) throw error;

    const raw = (asigs || []).filter(r => (typeof r.activo === 'boolean') ? r.activo : true);
    const ids = Array.from(new Set(raw.flatMap(r => [r.evaluador_id, r.evaluado_id]).filter(Boolean).map(v => String(v))));

    let legajos = [];
    if (ids.length){
      const { data: legs, error: e2 } = await supa
        .from(T_LEGAJOS)
        .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector"')
        .in('ID', ids)
        .limit(5000);
      if (e2) throw e2;
      legajos = legs || [];
    }

    const map = new Map(legajos.map(l => [String(l['ID']), {
      nombre: l['Nombre Completo'] || '—',
      sucursal: l['Sucursal'] || '',
      gerencia: l['Gerencia'] || '',
      sector: l['Sector'] || ''
    }]));

    listAll = raw.map(r => {
      const ev = map.get(String(r.evaluador_id)) || { nombre: '—', sucursal: '', gerencia: '', sector: '' };
      const ed = map.get(String(r.evaluado_id)) || { nombre: '—', sucursal: '', gerencia: '', sector: '' };
      return {
        anio: r.anio,
        evaluador_id: r.evaluador_id,
        evaluado_id: r.evaluado_id,
        evaluador_nombre: ev.nombre,
        evaluado_nombre: ed.nombre,
        // meta la tomamos del evaluado
        sucursal: ed.sucursal,
        gerencia: ed.gerencia,
        actualizado: r.actualizado_at || r.actualizado || r.updated_at || r.created_at,
        updated_at: r.updated_at,
        created_at: r.created_at,
      };
    });

    fillSelectPairs($('#lEvaluador'), uniqSorted(listAll.map(r => r.evaluador_nombre)).map(n => {
      const first = listAll.find(x => x.evaluador_nombre === n);
      return { value: first?.evaluador_id, label: n };
    }), { includeAllLabel: 'Todos' });

    fillSelectPairs($('#lEvaluado'), uniqSorted(listAll.map(r => r.evaluado_nombre)).map(n => {
      const first = listAll.find(x => x.evaluado_nombre === n);
      return { value: first?.evaluado_id, label: n };
    }), { includeAllLabel: 'Todos' });

    fillSelect($('#lSucursal'), uniqSorted(listAll.map(r => r.sucursal)), { includeAllLabel: 'Todas' });
    fillSelect($('#lGerencia'), uniqSorted(listAll.map(r => r.gerencia)), { includeAllLabel: 'Todas' });

    setText('lState', 'OK');
    listApplyAndRender();
  }

  // listeners
  $('#lEvaluador')?.addEventListener('change', listApplyAndRender);
  $('#lEvaluado')?.addEventListener('change', listApplyAndRender);
  $('#lSucursal')?.addEventListener('change', listApplyAndRender);
  $('#lGerencia')?.addEventListener('change', listApplyAndRender);
  $('#lSearch')?.addEventListener('input', listApplyAndRender);

  $('#lReload')?.addEventListener('click', async () => {
    const v = Number($('#lAnio')?.value || listAnio) || listAnio;
    listAnio = v;
    await load();
  });

  $('#lAnio')?.addEventListener('change', async () => {
    const v = Number($('#lAnio')?.value || listAnio) || listAnio;
    listAnio = v;
    await load();
  });

  // imprimir / guardar como PDF
  $('#lPrint')?.addEventListener('click', () => window.print());

  $('#lExport')?.addEventListener('click', listExportCSV);

  await load();
}

// =========================
// EVALUACIONES (REALIZAR)
// =========================


// Rubrica fija (modal de evaluación)
const R_RUBRICA = [
  {
    title: 'Calidad y Productividad',
    items: [
      { id: '1.1', label: 'Precisión y calidad del trabajo realizado' },
      { id: '1.2', label: 'Cantidad de trabajo completada' },
      { id: '1.3', label: 'Organización del trabajo en tiempo y forma' },
      { id: '1.4', label: 'Cuidado de herramientas y equipos' },
    ],
  },
  {
    title: 'Conocimiento',
    items: [
      { id: '2.1', label: 'Nivel de experiencia y conocimiento técnico para el trabajo requerido' },
      { id: '2.2', label: 'Uso y conocimiento de métodos y procedimiento' },
      { id: '2.3', label: 'Uso y conocimiento de Herramientas' },
      { id: '2.4', label: 'Puede desempeñarse con poca o ninguna ayuda' },
      { id: '2.5', label: 'Tiene capacidad de enseñar/ayudar a otros' },
    ],
  },
  {
    title: 'Iniciativa y liderazgo',
    items: [
      { id: '3.1', label: 'Cuando completa sus tareas busca nuevas asignaciones' },
      { id: '3.2', label: 'Elige prioridades de forma eficiente' },
      { id: '3.3', label: 'Sugiere mejoras' },
      { id: '3.4', label: 'Identifica errores y trabaja para arreglarlos' },
      { id: '3.5', label: 'Motiva y ayuda a los demás' },
    ],
  },
  {
    title: 'Trabajo en equipo',
    items: [
      { id: '4.1', label: 'Trabaja fluidamente con supervisores, pares y subordinados' },
      { id: '4.2', label: 'Tiene actitud positiva y proactiva' },
      { id: '4.3', label: 'Promueve el trabajo en equipo' },
    ],
  },
];

// Rubrica fija: Compromiso y Presentismo
const CP_RUBRICA = [
  {
    title: 'Compromiso y Presentismo',
    items: [
      { id: '5.1', label: 'Trabaja sin necesidad de supervisión' },
      { id: '5.2', label: 'Se esfuerza más si la situación lo requiere' },
      { id: '5.3', label: 'Puntualidad' },
      { id: '5.4', label: 'Presentismo' },
      { id: '5.5', label: 'Nivel Conflictividad' },
    ],
  },
];


const R_OPCIONES = [
  { value: '', label: 'Seleccionar...' },
  // IMPORTANTE: estos valores se guardan en rrhh_eval_respuestas.valor.
  // Si aparece: "violates check constraint rrhh_eval_valor_chk",
  // ajustar la constraint en Supabase para aceptar estos valores.
  { value: 'Bajo Normal', label: 'Bajo Normal' },
  { value: 'Normal', label: 'Normal' },
  { value: 'Muy Bien', label: 'Muy Bien' },
  { value: 'Excelente', label: 'Excelente' },
];

let rAnio = 2026;
let rEvaluadorId = '';
let rAutoEvaluadoId = '';
// cache de evaluaciones por evaluado para pintar estado en el listado
let rEvalMap = new Map(); // evaluado_id -> { eval_id, estado }

function rSetState(msg){
  setText('rState', msg);
}

function rShowModal(show){
  const bd = document.getElementById('rBackdrop');
  if (!bd) return;
  bd.classList.toggle('show', !!show);
  bd.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function rGetLocalKey(evaluadoId){
  return `rrhh_eval_local_${rAnio}_${rEvaluadorId}_${evaluadoId}`;
}

function rModalMissingCount(){
  const body = document.getElementById('rModalBody');
  if (!body) return 0;
  const selects = Array.from(body.querySelectorAll('select[data-crit]'));
  return selects.filter(sel => !String(sel.value || '').trim()).length;
}

function rModalIsComplete(){
  return rModalMissingCount() === 0;
}

function rRefreshModalValidation({ silent } = { silent: true }){
  const btn = document.getElementById('rSave');
  if (btn) btn.disabled = !rModalIsComplete();

  const msg = document.getElementById('rModalMsg');
  if (!msg) return;

  const missing = rModalMissingCount();
  if (missing > 0){
    if (!silent) msg.textContent = `Faltan ${missing} respuestas para habilitar Guardar.`;
  } else {
    // si estaba mostrando un warning de incompleto, lo limpiamos
    if (msg.textContent && msg.textContent.startsWith('Faltan ')) msg.textContent = '';
  }
}


function rApplySelectColor(sel){
  if (!sel) return;
  const v = String(sel.value || '').trim();

  sel.classList.remove('is-bajo','is-normal','is-muy','is-exc');

  if (v === 'Bajo Normal') sel.classList.add('is-bajo');
  else if (v === 'Normal') sel.classList.add('is-normal');
  else if (v === 'Muy Bien') sel.classList.add('is-muy');
  else if (v === 'Excelente') sel.classList.add('is-exc');
}

function rBindModalValidation(){
  const body = document.getElementById('rModalBody');
  if (!body) return;

  // Cuando cambia cualquier criterio, revalida + pinta color del select
  body.querySelectorAll('select[data-crit]').forEach(sel => {
    // pinta estado inicial (por si ya viene cargado)
    rApplySelectColor(sel);

    sel.addEventListener('change', () => {
      rApplySelectColor(sel);
      rRefreshModalValidation({ silent: true });
    });
  });

  // Observaciones no es obligatoria por ahora; igualmente revalida por consistencia
  const notes = document.getElementById('rNotes');
  notes?.addEventListener('input', () => rRefreshModalValidation({ silent: true }));

  // Estado inicial
  rRefreshModalValidation({ silent: true });
}

async function rOpenModal({ evaluadorNombre, evaluadoId, evaluadoNombre, evalId = null, estado = '' }){
  setText('rModalTitle', 'Evaluación');
  setText('rModalSub', `${evaluadorNombre} → ${evaluadoNombre} · Año ${rAnio}`);

  const msg = document.getElementById('rModalMsg');
  if (msg) msg.textContent = '';

  const body = document.getElementById('rModalBody');
  if (!body) return;

  // Prefill desde Supabase (si existe evalId)
  const supa = createClient();
  const answersByDbItemId = new Map(); // item_id (SMALLINT) -> valor
  let notes = '';
  let cabEstado = String(estado || '').trim();

  // Traemos el orden real de items activos en DB (define el mapeo UI <-> DB)
  let dbItemIds = [];
  try{
    const { data: itData, error: itErr } = await supa
      .from(T_EVAL_ITEMS)
      .select('item_id')
      .eq('activo', true)
      .order('item_id', { ascending: true })
      .limit(5000);
    if (itErr) throw itErr;
    dbItemIds = (itData || []).map(r => r.item_id).filter(v => v !== null && v !== undefined);
  }catch(e){
    // si falla, seguimos igual (permitimos completar sin prefill)
    console.error(e);
  }

  if (evalId){
    try{
      // Cabecera (estado/observaciones) - algunas columnas pueden no existir
      try{
        const { data: cab, error: cabErr } = await supa
          .from(T_EVAL_CAB)
          .select('estado,observaciones')
          .eq('eval_id', evalId)
          .limit(1);
        if (cabErr) throw cabErr;
        if (cab && cab.length){
          cabEstado = String(cab[0].estado || cabEstado || '').trim();
          notes = String(cab[0].observaciones || '').trim();
        }
      }catch(_){
        const { data: cab, error: cabErr } = await supa
          .from(T_EVAL_CAB)
          .select('estado')
          .eq('eval_id', evalId)
          .limit(1);
        if (!cabErr && cab && cab.length){
          cabEstado = String(cab[0].estado || cabEstado || '').trim();
        }
      }

      // Respuestas
      const { data: resp, error: respErr } = await supa
        .from(T_EVAL_RESP)
        .select('item_id,valor')
        .eq('eval_id', evalId)
        .limit(5000);
      if (respErr) throw respErr;
      (resp || []).forEach(r => {
        if (r && r.item_id !== null && r.item_id !== undefined){
          answersByDbItemId.set(r.item_id, String(r.valor || '').trim());
        }
      });
    }catch(e){
      console.error(e);
      if (msg) msg.textContent = `No se pudieron cargar respuestas previas: ${fmtErr(e)}`;
    }
  }

  const legend = `
    <div class="r-legend" aria-label="Escala">
      <span class="r-tag r-tag-bajo">Bajo Normal</span>
      <span class="r-tag r-tag-normal">Normal</span>
      <span class="r-tag r-tag-muy">Muy Bien</span>
      <span class="r-tag r-tag-exc">Excelente</span>
    </div>
  `;

  const sections = R_RUBRICA.map(sec => {
    const rows = sec.items.map(it => {
      const opts = R_OPCIONES.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
      return `
        <div class="r-row">
          <div class="r-q">
            <div class="r-code">${escapeHtml(it.id)}</div>
            <div class="r-text">${escapeHtml(it.label)}</div>
          </div>
          <div class="r-a">
            <select class="select r-select" data-crit="${escapeHtml(it.id)}">
              ${opts}
            </select>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="r-sec">
        <div class="r-sec-title">${escapeHtml(sec.title)}</div>
        <div class="r-sec-body">${rows}</div>
      </div>
    `;
  }).join('');

  body.innerHTML = `
    ${legend}
    <div class="rubrica">${sections}</div>
    <div class="field" style="margin-top:14px">
      <label for="rNotes">Observaciones</label>
      <textarea id="rNotes" class="textarea" rows="3" placeholder="Escribir observaciones..."></textarea>
    </div>
    <input type="hidden" id="rEvaluadoId" value="${escapeHtml(evaluadoId)}" />
    <input type="hidden" id="rEvalId" value="${escapeHtml(evalId || '')}" />
  `;

  // set values (mapeo por orden UI -> orden rrhh_eval_items(activo))
  const uiCrits = Array.from(body.querySelectorAll('select[data-crit]'));
  uiCrits.forEach((sel, idx) => {
    if (!dbItemIds.length) return; // sin items db no podemos mapear
    const dbId = dbItemIds[idx];
    const v = answersByDbItemId.has(dbId) ? answersByDbItemId.get(dbId) : '';
    sel.value = String(v || '');
  });

  // aplicar color segun valor precargado
  uiCrits.forEach(rApplySelectColor);

  const nEl = document.getElementById('rNotes');
  if (nEl) nEl.value = String(notes);

  // mensaje de estado (si existe)
  if (cabEstado){
    const m = document.getElementById('rModalMsg');
    if (m && !m.textContent) m.textContent = `Estado: ${cabEstado}`;
  }

  rShowModal(true);
  rBindModalValidation();
}


function rCloseModal(){
  rShowModal(false);
}

async function rLoadEvaluadores(supa){
  const { data, error } = await supa
    .from(T_ASIG)
    .select('evaluador_id')
    .eq('anio', rAnio)
    .eq('activo', true)
    .limit(10000);

  if (error) throw error;

  const ids = Array.from(new Set((data || []).map(r => String(r.evaluador_id)).filter(Boolean)));

  let legs = [];
  if (ids.length){
    const { data: d2, error: e2 } = await supa
      .from(T_LEGAJOS)
      .select('"ID","Nombre Completo"')
      .in('ID', ids)
      .limit(5000);
    if (e2) throw e2;
    legs = d2 || [];
  }

  const map = new Map(legs.map(l => [String(l['ID']), l['Nombre Completo'] || '—']));
  const pairs = ids.map(id => ({ value: id, label: map.get(id) || `ID ${id}` }));

  fillSelectPairs(document.getElementById('rEvaluador'), pairs, { includeAllLabel: 'Seleccionar...' });

  // mantener seleccion si existe
  const sel = document.getElementById('rEvaluador');
  if (sel && rEvaluadorId){
    const has = pairs.some(p => String(p.value) === String(rEvaluadorId));
    if (has) sel.value = String(rEvaluadorId);
  }
}

async function rLoadEvaluados(supa){
  const list = document.getElementById('rList');
  if (!list) return;

  if (!rEvaluadorId){
    list.innerHTML = '';
    setText('rCount', 0);
    return;
  }

  rSetState('Cargando...');

  const { data, error } = await supa
    .from(T_ASIG)
	    // rrhh_eval_asignaciones no tiene columnas de auditoria consistentes (p.ej. created_at/updated_at).
	    // Para evitar 400 (Bad Request), pedimos solo la columna minima.
	    .select('evaluado_id')
    .eq('anio', rAnio)
    .eq('evaluador_id', rEvaluadorId)
    .eq('activo', true)
    .limit(10000);

  if (error) throw error;

  const ids = Array.from(new Set((data || []).map(r => String(r.evaluado_id)).filter(Boolean)));

  // Filtro por elegibilidad (migracion a rrhh_legajo_flags)
  // - No usamos rrhh_legajos_stage.es_evaluable
  // - Si falta flag, asumimos evaluable=true para no ocultar gente por error de datos
  let idsElegibles = ids;
  try{
    if (idsElegibles.length){
      const { data: fData, error: fErr } = await supa
        .from(T_FLAGS)
        .select('legajo_id,es_evaluable_desempeno')
        .in('legajo_id', idsElegibles)
        .limit(20000);
      if (fErr) throw fErr;
      const mFlags = new Map((fData || []).map(f => [String(f.legajo_id), (typeof f.es_evaluable_desempeno === 'boolean') ? f.es_evaluable_desempeno : true]));
      idsElegibles = idsElegibles.filter(id => mFlags.has(String(id)) ? (mFlags.get(String(id)) !== false) : true);
    }
  }catch(e){
    // Si falla el select (RLS / tabla), no cortamos la pantalla.
    console.error(e);
    idsElegibles = ids;
  }

  let legs = [];
  if (idsElegibles.length){
    const { data: d2, error: e2 } = await supa
      .from(T_LEGAJOS)
      .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector"')
      .in('ID', idsElegibles)
      .limit(5000);
    if (e2) throw e2;
    legs = d2 || [];
  }

  const map = new Map(legs.map(l => [String(l['ID']), {
    nombre: l['Nombre Completo'] || '—',
    sucursal: l['Sucursal'] || '',
    gerencia: l['Gerencia'] || '',
    sector: l['Sector'] || ''
  }]));

  const rowsAll = idsElegibles.map(id => ({ id, ...(map.get(id) || { nombre: '—', sucursal: '', gerencia: '', sector: '' }) }))
    .sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));

  // ====== Estado de evaluaciones (Completa / Borrador / Pendiente) ======
  // Nota: puede haber mas de una cabecera por evaluado (si no hay unique). Nos quedamos con la mas "nueva"
  // segun orden descendente de eval_id (UUID). Es suficiente para el caso de uso actual.
  rEvalMap = new Map();
  let completas = 0;
  try{
    if (idsElegibles.length){
      const { data: cabs, error: cabErr } = await supa
        .from(T_EVAL_CAB)
        .select('eval_id,evaluado_id,estado')
        .eq('anio', rAnio)
        .eq('evaluador_id', rEvaluadorId)
        .in('evaluado_id', idsElegibles)
        .order('eval_id', { ascending: false })
        .limit(20000);
      if (cabErr) throw cabErr;

      (cabs || []).forEach(c => {
        const eid = String(c.evaluado_id || '').trim();
        if (!eid) return;
        if (rEvalMap.has(eid)) return;
        const st = String(c.estado || '').trim();
        rEvalMap.set(eid, { eval_id: c.eval_id, estado: st });
      });

      completas = Array.from(rEvalMap.values()).filter(v => String(v.estado || '').toUpperCase() === 'COMPLETA').length;
    }
  }catch(e){
    // Si falla el select (RLS / columnas), no cortamos la pantalla; solo queda todo como pendiente.
    console.error(e);
    rEvalMap = new Map();
    completas = 0;
  }

  // Aplicar filtro por estado (dropdown)
  const fEst = String(document.getElementById('rFiltroEstado')?.value || '').trim().toUpperCase();
  let rows = rowsAll;
  if (fEst === 'COMPLETA'){
    rows = rowsAll.filter(r => String((rEvalMap.get(String(r.id)) || {}).estado || '').trim().toUpperCase() === 'COMPLETA');
  } else if (fEst === 'PENDIENTE'){
    rows = rowsAll.filter(r => String((rEvalMap.get(String(r.id)) || {}).estado || '').trim().toUpperCase() !== 'COMPLETA');
  }

  const completasVis = rows.filter(r => String((rEvalMap.get(String(r.id)) || {}).estado || '').trim().toUpperCase() === 'COMPLETA').length;
  const pendientesVis = Math.max(0, rows.length - completasVis);

  // nombre del evaluador para el modal
  const evaluadorNombre = document.getElementById('rEvaluador')?.selectedOptions?.[0]?.textContent?.trim() || 'Evaluador';

  list.innerHTML = rows.map(r => {
    const info = rEvalMap.get(String(r.id)) || null;
    const stRaw = String(info?.estado || '').trim();
    const st = stRaw ? stRaw.toUpperCase() : 'PENDIENTE';
    const isCompleta = st === 'COMPLETA';
    const badgeText = isCompleta ? 'Completa' : (stRaw ? 'Borrador' : 'Pendiente');
    const badgeClass = isCompleta
      ? 'r-badge r-badge--ok'
      : (stRaw ? 'r-badge r-badge--draft' : 'r-badge r-badge--pending');
    const meta = [r.sucursal, r.gerencia, r.sector].filter(Boolean).join(' · ');
    return `
      <div class="r-item">
        <div class="r-main">
          <div class="r-name">${escapeHtml(r.nombre)}</div>
          <div class="r-meta">${escapeHtml(meta || '—')}</div>
          <div class="r-status"><span class="${badgeClass}">${escapeHtml(badgeText)}</span></div>
        </div>
        <button class="btn btn-sm btn-icon ${isCompleta ? 'is-complete' : ''}" type="button" data-evaluado-id="${escapeHtml(r.id)}" data-eval-id="${escapeHtml(info?.eval_id || '')}" data-estado="${escapeHtml(stRaw)}" title="${isCompleta ? 'Ver' : 'Evaluar'}">
          <img class="btn-ico" src="evaluacion.png" alt="" />
          <span class="sr-only">${isCompleta ? 'Ver' : 'Evaluar'}</span>
        </button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('button[data-evaluado-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const evaluadoId = btn.getAttribute('data-evaluado-id');
      const evalId = btn.getAttribute('data-eval-id') || '';
      const estado = btn.getAttribute('data-estado') || '';
      const row = rows.find(x => String(x.id) === String(evaluadoId));
      if (!row) return;
      rOpenModal({ evaluadorNombre, evaluadoId: row.id, evaluadoNombre: row.nombre, evalId: evalId || null, estado });
    });
  });

  setText('rCount', rows.length);
  rSetState(`Completa: ${completasVis} · Pendiente: ${pendientesVis}`);

  // auto-open (si viene desde Listado Asignaciones)
  if (rAutoEvaluadoId){
    const row = rows.find(x => String(x.id) === String(rAutoEvaluadoId));
    if (row){
      const info = rEvalMap.get(String(row.id)) || null;
      await rOpenModal({
        evaluadorNombre,
        evaluadoId: row.id,
        evaluadoNombre: row.nombre,
        evalId: info?.eval_id || null,
        estado: info?.estado || ''
      });
    }
    rAutoEvaluadoId = '';
  }
}

async function initRealizar(){
  const supa = createClient();

  const params = new URLSearchParams(location.search);
  rEvaluadorId = params.get('evaluador_id') || '';
  rAutoEvaluadoId = params.get('evaluado_id') || '';
  rAnio = Number(params.get('anio') || document.getElementById('rAnio')?.value || 2026) || 2026;

  const anioInput = document.getElementById('rAnio');
  if (anioInput) anioInput.value = String(rAnio);
  setText('rAnioLabel', rAnio);

  document.getElementById('rReload')?.addEventListener('click', async () => {
    const v = Number(document.getElementById('rAnio')?.value || rAnio) || rAnio;
    rAnio = v;
    setText('rAnioLabel', rAnio);
    await rLoadEvaluadores(supa);
    rEvaluadorId = document.getElementById('rEvaluador')?.value || '';
    await rLoadEvaluados(supa);
  });

  anioInput?.addEventListener('change', async () => {
    const v = Number(document.getElementById('rAnio')?.value || rAnio) || rAnio;
    rAnio = v;
    setText('rAnioLabel', rAnio);
    await rLoadEvaluadores(supa);
    rEvaluadorId = document.getElementById('rEvaluador')?.value || '';
    await rLoadEvaluados(supa);
  });

  document.getElementById('rEvaluador')?.addEventListener('change', async (ev) => {
    const sel = ev.currentTarget;
    const nextId = sel.value || '';
    const prevId = rEvaluadorId || '';

    // Si se limpia la selección, solo refrescamos.
    if (!nextId){
      rEvaluadorId = '';
      await rLoadEvaluados(supa);
      return;
    }

    // Validar que el evaluador seleccionado sea el autorizado por sesión/PIN.
    const auth = await rrhhEnsureAuthorizedEvaluator(supa, nextId);
    if (!auth.ok){
      // Volver a la selección anterior
      sel.value = prevId;
      return;
    }

    rEvaluadorId = nextId;
    await rLoadEvaluados(supa);
  });

  // Filtro por estado (Todos / Completa / Pendiente)
  document.getElementById('rFiltroEstado')?.addEventListener('change', async () => {
    await rLoadEvaluados(supa);
  });

  document.getElementById('rClose')?.addEventListener('click', rCloseModal);
  document.getElementById('rBackdrop')?.addEventListener('click', (ev) => {
    if (ev.target && ev.target.id === 'rBackdrop') rCloseModal();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') rCloseModal();
  });

  document.getElementById('rSave')?.addEventListener('click', async () => {
    const evaluadoId = document.getElementById('rEvaluadoId')?.value || '';
    if (!evaluadoId) return;

    // Si el modal se abrio desde una evaluación existente, ya tenemos eval_id
    const evalIdFromModal = String(document.getElementById('rEvalId')?.value || '').trim();

    // Si no esta completo, no permite guardar.
    if (!rModalIsComplete()){
      rRefreshModalValidation({ silent: false });
      return;
    }

    const btn = document.getElementById('rSave');
    if (btn) btn.disabled = true;

    const msg = document.getElementById('rModalMsg');

    // Helpers
    const scoreFromValor = (v) => {
      const s = String(v || '').trim();
      if (s === 'Bajo Normal') return 1;
      if (s === 'Normal') return 2;
      if (s === 'Muy Bien') return 3;
      if (s === 'Excelente') return 4;
      return null;
    };

    const getAnswersFromModal = () => {
      const body = document.getElementById('rModalBody');
      const out = [];
      if (!body) return out;
      body.querySelectorAll('select[data-crit]').forEach(sel => {
        const itemId = sel.getAttribute('data-crit');
        const valor = String(sel.value || '').trim();
        out.push({ item_id: itemId, valor, score: scoreFromValor(valor) });
      });
      return out;
    };

    const answers = getAnswersFromModal();
    const notes = String(document.getElementById('rNotes')?.value || '').trim();

    try{
      const supa2 = supa; // reutilizamos la instancia unica

      // Paso 0: sanity básico
      if (!rEvaluadorId){
        throw new Error('Falta seleccionar Evaluador.');
      }

      // Paso 1: obtener items reales desde Supabase (item_id es SMALLINT)
      // La rubrica del modal usa codigos visuales (1.1, 2.3, etc.). Para guardar, mapeamos
      // el orden de esos select al orden de rrhh_eval_items (activo=true ORDER BY item_id).
      if (msg) msg.textContent = 'Chequeando items (rrhh_eval_items)...';

      const { data: itData, error: itErr } = await supa2
        .from(T_EVAL_ITEMS)
        .select('item_id')
        .eq('activo', true)
        .order('item_id', { ascending: true })
        .limit(5000);
      if (itErr) throw itErr;

      const dbItemIds = (itData || []).map(r => r.item_id).filter(v => v !== null && v !== undefined);
      if (dbItemIds.length !== answers.length){
        throw new Error(`Cantidad de items no coincide. En UI: ${answers.length}. En rrhh_eval_items(activo): ${dbItemIds.length}. Hay que alinear la rubrica con la tabla.`);
      }

      // Paso 2: crear o reutilizar cabecera (rrhh_eval_cab)
      if (msg) msg.textContent = 'Guardando cabecera (rrhh_eval_cab)...';

      // Intentamos reutilizar la cabecera existente para (anio,evaluador_id,evaluado_id) si ya existe.
      // Si tu tabla no tiene estas columnas, este select va a fallar y el mensaje te lo muestra.
      let evalId = evalIdFromModal || null;
      const { data: cabExist, error: cabSelErr } = await supa2
        .from(T_EVAL_CAB)
        .select('eval_id')
        .eq('anio', rAnio)
        .eq('evaluador_id', rEvaluadorId)
        .eq('evaluado_id', evaluadoId)
        .order('eval_id', { ascending: false })
        .limit(1);
      if (cabSelErr) throw cabSelErr;
      if (!evalId && cabExist && cabExist.length) evalId = cabExist[0].eval_id;

      if (!evalId){
        const cabPayload = {
          anio: rAnio,
          evaluador_id: rEvaluadorId,
          evaluado_id: evaluadoId,
        };

        const { data: cabIns, error: cabInsErr } = await supa2
          .from(T_EVAL_CAB)
          .insert(cabPayload)
          .select('eval_id')
          .limit(1);
        if (cabInsErr) throw cabInsErr;
        evalId = cabIns?.[0]?.eval_id || null;
      }

      if (!evalId) throw new Error('No se pudo obtener eval_id de rrhh_eval_cab.');

      // Paso 3: guardar respuestas (rrhh_eval_respuestas) - PK compuesta (eval_id,item_id)
      if (msg) msg.textContent = `Guardando respuestas (rrhh_eval_respuestas)... (eval_id=${evalId})`;

      const respPayload = answers.map((a, idx) => ({
        eval_id: evalId,
        // item_id real (SMALLINT) segun el orden de rrhh_eval_items
        item_id: dbItemIds[idx],
        valor: a.valor,
        score: a.score,
      }));

      // Upsert por PK compuesta
      const { error: upErr } = await supa2
        .from(T_EVAL_RESP)
        .upsert(respPayload, { onConflict: 'eval_id,item_id' });
      if (upErr) throw upErr;

      // Paso 4: actualizar observaciones/estado en cabecera (queremos que se refleje en la pantalla)
      // Si falla (RLS/columna), lo informamos y NO cerramos el modal.
      // Intentamos guardar observaciones si existe la columna; si no, al menos marcamos COMPLETA.
      let cabUpErr = null;
      {
        const patch = { estado: 'COMPLETA' };
        if (notes) patch.observaciones = notes;
        const { error } = await supa2
          .from(T_EVAL_CAB)
          .update(patch)
          .eq('eval_id', evalId);
        cabUpErr = error || null;
      }

      if (cabUpErr){
        // Fallback: si falla por columna inexistente, intentamos solo estado
        const msgTxt = String(cabUpErr.message || '').toLowerCase();
        if (msgTxt.includes('observaciones') || msgTxt.includes('column')){
          const { error } = await supa2
            .from(T_EVAL_CAB)
            .update({ estado: 'COMPLETA' })
            .eq('eval_id', evalId);
          cabUpErr = error || null;
        }
      }

      if (cabUpErr) throw cabUpErr;

      // Refresca listado para que aparezca "Completa" sin recargar pagina
      await rLoadEvaluados(supa2);

      if (msg) msg.textContent = `OK: evaluación guardada (Completa).`;

      // Cierra el modal luego de guardar
      setTimeout(() => rCloseModal(), 350);

    }catch(err){
      console.error(err);
      if (msg) msg.textContent = `Error al guardar en Supabase: ${fmtErr(err)}`;
    }finally{
      // Rehabilita solo si sigue completo
      if (btn) btn.disabled = !rModalIsComplete();
    }
  });


  // init
  rSetState('Cargando...');
  await rLoadEvaluadores(supa);

  const sel = document.getElementById('rEvaluador');
  if (sel && rEvaluadorId) sel.value = String(rEvaluadorId);

  // Normalizar desde el select (por si el evaluador_id del query no existe en la lista)
  rEvaluadorId = sel?.value || rEvaluadorId || '';

  // Si ya viene seleccionado, pedimos validación y solo cargamos si está autorizado.
  if (rEvaluadorId){
    const auth = await rrhhEnsureAuthorizedEvaluator(supa, rEvaluadorId);
    if (!auth.ok){
      if (sel) sel.value = '';
      rEvaluadorId = '';
      rSetState('Seleccioná evaluador');
      // Igual cargamos el listado vacío para que la UI quede estable
      await rLoadEvaluados(supa);
      return;
    }
  }

  await rLoadEvaluados(supa);
  rSetState('OK');
}

// =========================
// LISTADO EVALUACIONES
// =========================

let leRows = []; // { evaluador_id, evaluador_nombre, evaluado_id, evaluado_nombre, sucursal, gerencia, estado_ui }
let leAnio = 2026;

function leEstadoUiFromDb(estadoDb){
  const s = String(estadoDb || '').trim().toUpperCase();
  if (!s) return 'Pendiente';
  if (s.includes('COMPLE') || s.includes('FINAL')) return 'Completa';
  return 'Pendiente';
}

function leBadgeClass(estadoUi){
  return estadoUi === 'Completa' ? 'r-badge r-badge--ok' : 'r-badge r-badge--pending';
}

function leSetState(msg){
  const el = $('#leState');
  if (!el) return;
  const t = String(msg || '').trim();
  // No mostramos estados "OK" (ni vacios) para evitar texto suelto al pie.
  if (!t || t.toUpperCase() === 'OK'){
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.textContent = t;
  el.style.display = 'block';
}

function leUpdateStats(rows){
  const total = rows.length;
  const comp = rows.filter(r => r.estado_ui === 'Completa').length;
  const pend = total - comp;
  const pct = total ? Math.round((comp / total) * 100) : 0;

  setText('leTotal', total);
  setText('leComp', comp);
  setText('lePend', pend);
  setText('lePct', `${pct}%`);
}

function leApplyAndRender(){
  const fEval = document.getElementById('leEvaluador')?.value || '';
  const fSuc = document.getElementById('leSucursal')?.value || '';
  const fGer = document.getElementById('leGerencia')?.value || '';
  const fEst = document.getElementById('leEstado')?.value || '';
  const q = normalizeText((document.getElementById('leSearch')?.value || '').trim());

  let rows = leRows;
  if (fEval) rows = rows.filter(r => String(r.evaluador_id) === String(fEval));
  if (fSuc) rows = rows.filter(r => (r.sucursal || '') === fSuc);
  if (fGer) rows = rows.filter(r => (r.gerencia || '') === fGer);
  if (fEst) rows = rows.filter(r => String(r.estado_ui || '') === String(fEst));
  if (q){
    rows = rows.filter(r => normalizeText(`${r.evaluador_nombre} ${r.evaluado_nombre} ${r.sucursal} ${r.gerencia}`).includes(q));
  }

  rows = rows.slice().sort((a,b) => {
    const c1 = a.evaluador_nombre.localeCompare(b.evaluador_nombre, 'es');
    if (c1 !== 0) return c1;
    return a.evaluado_nombre.localeCompare(b.evaluado_nombre, 'es');
  });

  leUpdateStats(rows);

  const tbody = $('#leTbody');
  if (!tbody) return;

  tbody.innerHTML = rows.map(r => {
    const badge = `<span class="${leBadgeClass(r.estado_ui)}">${escapeHtml(r.estado_ui)}</span>`;
    return `<tr>
      <td>${escapeHtml(r.evaluador_nombre)}</td>
      <td>${escapeHtml(r.evaluado_nombre)}</td>
      <td>${escapeHtml(r.sucursal)}</td>
      <td>${escapeHtml(r.gerencia)}</td>
      <td class="col-date">${escapeHtml(r.fecha_ui || '')}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');

  leSetState(`Mostrando ${rows.length} registros.`);

  window.__leSticky?.sync?.();
}

async function initListadoEvaluaciones(){
  const supa = createClient();

  const anioInput = document.getElementById('leAnio');
  leAnio = Number(anioInput?.value || 2026) || 2026;
  setText('leAnioLabel', leAnio);

  const reload = async () => {
    leAnio = Number(document.getElementById('leAnio')?.value || leAnio) || leAnio;
    setText('leAnioLabel', leAnio);
    await loadListadoEvaluacionesData(supa);
  };

  document.getElementById('leReload')?.addEventListener('click', reload);
  document.getElementById('lePrint')?.addEventListener('click', () => {
    // Abre el diálogo del navegador (permite “Guardar como PDF”)
    window.print();
  });
  anioInput?.addEventListener('change', reload);

  document.getElementById('leEvaluador')?.addEventListener('change', leApplyAndRender);
  document.getElementById('leSucursal')?.addEventListener('change', leApplyAndRender);
  document.getElementById('leGerencia')?.addEventListener('change', leApplyAndRender);
  document.getElementById('leEstado')?.addEventListener('change', leApplyAndRender);
  document.getElementById('leSearch')?.addEventListener('input', leApplyAndRender);

  leSetState('Cargando...');
  await loadListadoEvaluacionesData(supa);

  // Sticky header de la tabla (solo Listado Evaluaciones)
  leSetupStickyHeader();
}

async function loadListadoEvaluacionesData(supa){
  leSetState('Leyendo evaluaciones...');

  // Traemos todas las cabeceras del año (incluye completas y pendientes)
  const { data: cabs, error: cabErr } = await supa
    .from(T_EVAL_CAB)
    .select('eval_id, anio, evaluador_id, evaluado_id, estado, created_at, updated_at')
    .eq('anio', leAnio)
    .limit(5000);
  if (cabErr) throw cabErr;

  const cabRows = Array.isArray(cabs) ? cabs : [];

  // Si aun no existen cabeceras, igual podemos mostrar pendientes basadas en rrhh_eval_asignaciones
  leSetState('Leyendo asignaciones...');
  const { data: asigs, error: asErr } = await supa
    .from(T_ASIG)
    .select('anio, evaluador_id, evaluado_id, activo')
    .eq('anio', leAnio)
    .eq('activo', true)
    .limit(5000);
  if (asErr) throw asErr;

  const asigRows = Array.isArray(asigs) ? asigs : [];
    dAsigRowsAll = asigRows;

  // Mapear cabeceras por par evaluador-evaluado
  const cabByPair = new Map();
  cabRows.forEach(r => {
    const key = `${r.evaluador_id}__${r.evaluado_id}`;
    // si hubiera duplicados, nos quedamos con el que tenga estado mas "completo"
    const prev = cabByPair.get(key);
    if (!prev) cabByPair.set(key, r);
    else{
      const prevUi = leEstadoUiFromDb(prev.estado);
      const curUi = leEstadoUiFromDb(r.estado);
      if (prevUi !== 'Completa' && curUi === 'Completa') cabByPair.set(key, r);
    }
  });

  // Para fecha de realización: tomamos el MAX(updated_at) de rrhh_eval_respuestas por eval_id
  // (solo para evaluaciones completas, para no cargar de más)
  const completeEvalIds = new Set();
  cabByPair.forEach(cab => {
    if (!cab?.eval_id) return;
    const ui = leEstadoUiFromDb(cab.estado);
    if (ui === 'Completa') completeEvalIds.add(String(cab.eval_id));
  });

  const respMaxByEval = new Map(); // eval_id -> isoDate
  if (completeEvalIds.size){
    leSetState('Leyendo fechas (respuestas)...');
    const { data: resps, error: respErr } = await supa
      .from(T_EVAL_RESP)
      .select('eval_id, updated_at')
      .in('eval_id', Array.from(completeEvalIds))
      .limit(20000);
    if (respErr) throw respErr;

    (resps || []).forEach(r => {
      const eid = String(r.eval_id || '');
      if (!eid || !r.updated_at) return;
      const t = new Date(r.updated_at).getTime();
      if (Number.isNaN(t)) return;
      const prev = respMaxByEval.get(eid);
      if (!prev){
        respMaxByEval.set(eid, r.updated_at);
        return;
      }
      const prevT = new Date(prev).getTime();
      if (Number.isNaN(prevT) || t > prevT) respMaxByEval.set(eid, r.updated_at);
    });
  }

  // Construimos universo final a mostrar basado en asignaciones (lo correcto para "Pendiente")
  let pairs = asigRows.map(a => ({ evaluador_id: a.evaluador_id, evaluado_id: a.evaluado_id }));

  // IDs a resolver en legajos
  const ids = new Set();
  const idsEvaluados = new Set();
  pairs.forEach(p => {
    if (p.evaluador_id) ids.add(String(p.evaluador_id));
    if (p.evaluado_id){
      const eid = String(p.evaluado_id);
      ids.add(eid);
      idsEvaluados.add(eid);
    }
  });

  leSetState('Resolviendo nombres (legajos)...');
  const idArr = Array.from(ids);
  let legajosMap = new Map();
  if (idArr.length){
    const { data: legs, error: legErr } = await supa
      .from(T_LEGAJOS)
      .select('"ID","Nombre Completo","Sucursal","Gerencia","Baja"')
      .in('ID', idArr)
      .limit(5000);
    if (legErr) throw legErr;
    (legs || []).forEach(l => {
      legajosMap.set(String(l['ID']), {
        nombre: l['Nombre Completo'] || '—',
        sucursal: l['Sucursal'] || '',
        gerencia: l['Gerencia'] || '',
        baja: l['Baja'] || ''
      });
    });
  }

  // Filtro por elegibilidad (migracion a rrhh_legajo_flags)
  // - No usamos rrhh_legajos_stage.es_evaluable
  // - Solo consideramos legajos Activos
  // - Si falta flag, asumimos evaluable=true para no ocultar gente por error de datos
  let flagsMap = new Map(); // evaluado_id -> boolean
  try{
    const evalArr = Array.from(idsEvaluados);
    if (evalArr.length){
      const { data: fData, error: fErr } = await supa
        .from(T_FLAGS)
        .select('legajo_id,es_evaluable_desempeno')
        .in('legajo_id', evalArr)
        .limit(20000);
      if (fErr) throw fErr;
      flagsMap = new Map((fData || []).map(f => [String(f.legajo_id), (typeof f.es_evaluable_desempeno === 'boolean') ? f.es_evaluable_desempeno : true]));
    }
  }catch(e){
    console.error(e);
    flagsMap = new Map();
  }

  // Aplicar filtro (Activos + flags)
  pairs = pairs.filter(p => {
    const evalLeg = legajosMap.get(String(p.evaluador_id));
    const evaLeg = legajosMap.get(String(p.evaluado_id));
    // Solo mostramos relaciones con ambos legajos Activos
    if (!evalLeg || String(evalLeg.baja || '') !== 'Activo') return false;
    if (!evaLeg || String(evaLeg.baja || '') !== 'Activo') return false;
    const flag = flagsMap.has(String(p.evaluado_id)) ? flagsMap.get(String(p.evaluado_id)) : true;
    return flag !== false;
  });

  leRows = pairs.map(p => {
    const key = `${p.evaluador_id}__${p.evaluado_id}`;
    const cab = cabByPair.get(key) || null;
    const estado_ui = cab ? leEstadoUiFromDb(cab.estado) : 'Pendiente';
    const fecha_src = (estado_ui === 'Completa' && cab)
      ? (respMaxByEval.get(String(cab.eval_id)) || cab.updated_at || cab.created_at)
      : null;
    const fecha_ui = (estado_ui === 'Completa' && cab) ? formatDateShort(fecha_src) : '';
    const evalLeg = legajosMap.get(String(p.evaluador_id)) || { nombre: '—', sucursal: '', gerencia: '' };
    const evaLeg = legajosMap.get(String(p.evaluado_id)) || { nombre: '—', sucursal: '', gerencia: '' };

    return {
      evaluador_id: p.evaluador_id,
      evaluador_nombre: evalLeg.nombre,
      evaluado_id: p.evaluado_id,
      evaluado_nombre: evaLeg.nombre,
      // Sucursal/Gerencia del evaluado (más útil para filtrar a quién se evalúa)
      sucursal: evaLeg.sucursal,
      gerencia: evaLeg.gerencia,
      fecha_ui,
      estado_ui
    };
  });

  // Cargar combos
  fillSelectPairs(document.getElementById('leEvaluador'), leRows.map(r => ({ value: r.evaluador_id, label: r.evaluador_nombre })), { includeAllLabel: 'Todos' });
  fillSelect(document.getElementById('leSucursal'), uniqSorted(leRows.map(r => r.sucursal)), { includeAllLabel: 'Todas' });
  fillSelect(document.getElementById('leGerencia'), uniqSorted(leRows.map(r => r.gerencia)), { includeAllLabel: 'Todas' });
  fillSelect(document.getElementById('leEstado'), ['Completa','Pendiente'], { includeAllLabel: 'Todas' });

  leApplyAndRender();
  leSetState('OK');
}



// =========================
// COMPROMISO Y PRESENTISMO (cp)
// - Evaluador unico (no se muestra en UI)
// - Evalua a todos los empleados evaluables
// =========================

const CP_EVALUADOR_FIJO = 'RRHH'; // se usa solo para auditoria en DB

let cAnio = 2026;
let cAutoEvaluadoId = '';
let cLegajosAll = []; // base sin filtrar
let cLegajos = []; // lista filtrada para render {id,nombre,sucursal,gerencia,sector}
let cCabMap = new Map(); // evaluado_id -> { eval_id, estado }

let cFiltroSucursal = '';
let cFiltroGerencia = '';
let cFiltroEstado = '';

function cSetState(msg){
  setText('cState', msg);
}

function cShowModal(show){
  const bd = document.getElementById('cBackdrop');
  if (!bd) return;
  bd.classList.toggle('show', !!show);
  bd.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function cCloseModal(){
  cShowModal(false);
}

function cModalMissingCount(){
  const body = document.getElementById('cModalBody');
  if (!body) return 0;
  const sels = Array.from(body.querySelectorAll('select[data-crit]'));
  return sels.filter(sel => !String(sel.value || '').trim()).length;
}

function cModalIsComplete(){
  return cModalMissingCount() === 0;
}

function cRefreshModalValidation({ silent } = { silent: true }){
  const btn = document.getElementById('cSave');
  if (btn) btn.disabled = !cModalIsComplete();

  const msg = document.getElementById('cModalMsg');
  if (!msg) return;

  const missing = cModalMissingCount();
  if (missing > 0){
    if (!silent) msg.textContent = `Faltan ${missing} respuestas para habilitar Guardar.`;
  } else {
    if (msg.textContent && msg.textContent.startsWith('Faltan ')) msg.textContent = '';
  }
}

function cBindModalValidation(){
  const body = document.getElementById('cModalBody');
  if (!body) return;

  body.querySelectorAll('select[data-crit]').forEach(sel => {
    // Reutilizamos el pintado del select de la pantalla de Evaluaciones
    rApplySelectColor(sel);
    sel.addEventListener('change', () => {
      rApplySelectColor(sel);
      cRefreshModalValidation({ silent: true });
    });
  });

  const notes = document.getElementById('cNotes');
  notes?.addEventListener('input', () => cRefreshModalValidation({ silent: true }));

  cRefreshModalValidation({ silent: true });
}

async function cOpenModal({ evaluadoId, evaluadoNombre, evalId = null, estado = '' }){
  setText('cModalTitle', 'Compromiso y Presentismo');
  setText('cModalSub', `${evaluadoNombre} · Año ${cAnio}`);

  const msg = document.getElementById('cModalMsg');
  if (msg) msg.textContent = '';

  const body = document.getElementById('cModalBody');
  if (!body) return;

  const supa = createClient();

  // 1) Items (orden DB)
  let dbItemIds = [];
  try{
    const { data: itData, error: itErr } = await supa
      .from(T_CP_ITEMS)
      .select('item_id')
      .eq('activo', true)
      .order('item_id', { ascending: true })
      .limit(200);
    if (itErr) throw itErr;
    dbItemIds = (itData || []).map(r => r.item_id).filter(v => v !== null && v !== undefined);
  }catch(e){
    console.error(e);
  }

  // 2) Prefill desde DB
  const answersByDbItemId = new Map();
  let notes = '';
  let cabEstado = String(estado || '').trim();

  if (evalId){
    try{
      // cabecera
      try{
        const { data: cab, error: cabErr } = await supa
          .from(T_CP_CAB)
          .select('estado,observaciones')
          .eq('eval_id', evalId)
          .limit(1);
        if (cabErr) throw cabErr;
        if (cab && cab.length){
          cabEstado = String(cab[0].estado || cabEstado || '').trim();
          notes = String(cab[0].observaciones || '').trim();
        }
      }catch(_){
        const { data: cab, error: cabErr } = await supa
          .from(T_CP_CAB)
          .select('estado')
          .eq('eval_id', evalId)
          .limit(1);
        if (!cabErr && cab && cab.length){
          cabEstado = String(cab[0].estado || cabEstado || '').trim();
        }
      }

      const { data: resp, error: respErr } = await supa
        .from(T_CP_RESP)
        .select('item_id,valor')
        .eq('eval_id', evalId)
        .limit(200);
      if (respErr) throw respErr;
      (resp || []).forEach(r => {
        if (r && r.item_id !== null && r.item_id !== undefined){
          answersByDbItemId.set(r.item_id, String(r.valor || '').trim());
        }
      });
    }catch(e){
      console.error(e);
      if (msg) msg.textContent = `No se pudieron cargar respuestas previas: ${fmtErr(e)}`;
    }
  }

  const legend = `
    <div class="r-legend" aria-label="Escala">
      <span class="r-tag r-tag-bajo">Bajo Normal</span>
      <span class="r-tag r-tag-normal">Normal</span>
      <span class="r-tag r-tag-muy">Muy Bien</span>
      <span class="r-tag r-tag-exc">Excelente</span>
    </div>
  `;

  const sections = CP_RUBRICA.map(sec => {
    const rows = sec.items.map(it => {
      const opts = R_OPCIONES.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
      return `
        <div class="r-row">
          <div class="r-q">
            <div class="r-code">${escapeHtml(it.id)}</div>
            <div class="r-text">${escapeHtml(it.label)}</div>
          </div>
          <div class="r-a">
            <select class="select r-select" data-crit="${escapeHtml(it.id)}">
              ${opts}
            </select>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="r-sec">
        <div class="r-sec-title">${escapeHtml(sec.title)}</div>
        <div class="r-sec-body">${rows}</div>
      </div>
    `;
  }).join('');

  body.innerHTML = `
    ${legend}
    <div class="rubrica">${sections}</div>
    <div class="field" style="margin-top:14px">
      <label for="cNotes">Observaciones</label>
      <textarea id="cNotes" class="textarea" rows="3" placeholder="Escribir observaciones..."></textarea>
    </div>
    <input type="hidden" id="cEvaluadoId" value="${escapeHtml(evaluadoId)}" />
    <input type="hidden" id="cEvalId" value="${escapeHtml(evalId || '')}" />
  `;

  // set values (mapeo por orden UI -> orden rrhh_cp_items(activo))
  const uiCrits = Array.from(body.querySelectorAll('select[data-crit]'));
  uiCrits.forEach((sel, idx) => {
    if (!dbItemIds.length) return;
    const dbId = dbItemIds[idx];
    const v = answersByDbItemId.has(dbId) ? answersByDbItemId.get(dbId) : '';
    sel.value = String(v || '');
  });

  uiCrits.forEach(rApplySelectColor);

  const nEl = document.getElementById('cNotes');
  if (nEl) nEl.value = String(notes);

  if (cabEstado){
    const m = document.getElementById('cModalMsg');
    if (m && !m.textContent) m.textContent = `Estado: ${cabEstado}`;
  }

  cShowModal(true);
  cBindModalValidation();
}

async function cLoadList(){
  const supa = createClient();

  cSetState('Cargando...');

  // 1) Legajos activos (la elegibilidad se controla SOLO por rrhh_legajo_flags.es_evaluable_cp)
  const { data: legs, error: legErr } = await supa
    .from(T_LEGAJOS)
    .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector","Baja"')
    .eq('Baja', 'Activo')
    .limit(5000);
  if (legErr) throw legErr;

  // 1.0) Flags CP (si falta flag -> true, para no ocultar por falta de datos)
  const legIds = (legs || []).map(r => r['ID']).filter(Boolean);
  const cpFlagMap = new Map();
  if (legIds.length){
    const { data: flags, error: fErr } = await supa
      .from('rrhh_legajo_flags')
      .select('legajo_id,es_evaluable_cp')
      .in('legajo_id', legIds)
      .limit(20000);
    if (fErr) throw fErr;
    (flags || []).forEach(f => {
      const id = String(f.legajo_id || '').trim();
      if (!id) return;
      const v = (typeof f.es_evaluable_cp === 'boolean') ? f.es_evaluable_cp : true;
      cpFlagMap.set(id, v);
    });
  }

  cLegajosAll = (legs || [])
    .filter(r => {
      const id = String(r['ID'] || '').trim();
      if (!id) return false;
      const v = cpFlagMap.has(id) ? cpFlagMap.get(id) : true;
      return !!v;
    })
    .map(r => ({
      id: r['ID'],
      nombre: resCleanName(r['Nombre Completo'] || '—'),
      sucursal: r['Sucursal'] || '',
      gerencia: r['Gerencia'] || '',
      sector: r['Sector'] || ''
    }))
    .sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));

  // 1.1) Poblar filtros (Sucursal / Gerencia)
  fillSelect($('#cFiltroSucursal'), uniqSorted(cLegajosAll.map(r => r.sucursal)), { includeAllLabel: 'Todas' });
  fillSelect($('#cFiltroGerencia'), uniqSorted(cLegajosAll.map(r => r.gerencia)), { includeAllLabel: 'Todas' });

  // 1.2) Leer filtros seleccionados
  cFiltroSucursal = String($('#cFiltroSucursal')?.value || '').trim();
  cFiltroGerencia = String($('#cFiltroGerencia')?.value || '').trim();
  cFiltroEstado = String($('#cFiltroEstado')?.value || '').trim();

  // 1.3) Aplicar filtros
  cLegajos = cLegajosAll.filter(r => {
    const okSuc = !cFiltroSucursal || String(r.sucursal || '') === cFiltroSucursal;
    const okGer = !cFiltroGerencia || String(r.gerencia || '') === cFiltroGerencia;
    return okSuc && okGer;
  });

  // 2) Cabeceras existentes (para pintar estado)
  cCabMap = new Map();
  if (cLegajos.length){
    const ids = cLegajos.map(l => l.id);
    const { data: cabs, error: cabErr } = await supa
      .from(T_CP_CAB)
      .select('eval_id,evaluado_id,estado')
      .eq('anio', cAnio)
      .in('evaluado_id', ids)
      .order('eval_id', { ascending: false })
      .limit(20000);
    if (cabErr) throw cabErr;

    (cabs || []).forEach(c => {
      const eid = String(c.evaluado_id || '').trim();
      if (!eid) return;
      if (cCabMap.has(eid)) return;
      cCabMap.set(eid, { eval_id: c.eval_id, estado: String(c.estado || '').trim() });
    });
  }

  // 2.1) Filtro por Estado (Completa / Pendiente)
  const fEst = String(cFiltroEstado || '').trim().toUpperCase();
  if (fEst === 'COMPLETA'){
    cLegajos = cLegajos.filter(r => {
      const st = String((cCabMap.get(String(r.id)) || {}).estado || '').trim().toUpperCase();
      return st === 'COMPLETA';
    });
  } else if (fEst === 'PENDIENTE'){
    cLegajos = cLegajos.filter(r => {
      const st = String((cCabMap.get(String(r.id)) || {}).estado || '').trim().toUpperCase();
      return st !== 'COMPLETA';
    });
  }

  const completas = cLegajos.filter(r => {
    const st = String((cCabMap.get(String(r.id)) || {}).estado || '').trim().toUpperCase();
    return st === 'COMPLETA';
  }).length;
  const pendientes = Math.max(0, cLegajos.length - completas);

  setText('cCount', cLegajos.length);
  cSetState(`Completa: ${completas} · Pendiente: ${pendientes}`);

  const list = document.getElementById('cList');
  if (!list) return;

  list.innerHTML = cLegajos.map(r => {
    const info = cCabMap.get(String(r.id)) || null;
    const stRaw = String(info?.estado || '').trim();
    const st = stRaw ? stRaw.toUpperCase() : 'PENDIENTE';
    const isCompleta = st === 'COMPLETA';
    const badgeText = isCompleta ? 'Completa' : (stRaw ? 'Borrador' : 'Pendiente');
    const badgeClass = isCompleta
      ? 'r-badge r-badge--ok'
      : (stRaw ? 'r-badge r-badge--draft' : 'r-badge r-badge--pending');

    const meta = [r.sucursal, r.gerencia, r.sector].filter(Boolean).join(' · ');

    return `
      <div class="r-item">
        <div class="r-main">
          <div class="r-name">${escapeHtml(r.nombre)}</div>
          <div class="r-meta">${escapeHtml(meta || '—')}</div>
          <div class="r-status"><span class="${badgeClass}">${escapeHtml(badgeText)}</span></div>
        </div>
        <button class="btn btn-sm btn-icon ${isCompleta ? 'is-complete' : ''}" type="button" data-evaluado-id="${escapeHtml(r.id)}" data-eval-id="${escapeHtml(info?.eval_id || '')}" data-estado="${escapeHtml(stRaw)}" title="${isCompleta ? 'Ver' : 'Evaluar'}">
          <img class="btn-ico" src="evaluacion.png" alt="" />
          <span class="sr-only">${isCompleta ? 'Ver' : 'Evaluar'}</span>
        </button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('button[data-evaluado-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const evaluadoId = btn.getAttribute('data-evaluado-id');
      const evalId = btn.getAttribute('data-eval-id') || '';
      const estado = btn.getAttribute('data-estado') || '';
      const row = cLegajos.find(x => String(x.id) === String(evaluadoId));
      if (!row) return;
      await cOpenModal({ evaluadoId: row.id, evaluadoNombre: row.nombre, evalId: evalId || null, estado });
    });
  });

  // auto-open (si lo necesitamos más adelante)
  if (cAutoEvaluadoId){
    const row = cLegajos.find(x => String(x.id) === String(cAutoEvaluadoId));
    if (row){
      const info = cCabMap.get(String(row.id)) || null;
      await cOpenModal({
        evaluadoId: row.id,
        evaluadoNombre: row.nombre,
        evalId: info?.eval_id || null,
        estado: info?.estado || ''
      });
    }
    cAutoEvaluadoId = '';
  }
}

async function initCompromisoPresentismo(){
  const supa = createClient();

  const params = new URLSearchParams(location.search);
  cAutoEvaluadoId = params.get('evaluado_id') || '';
  cAnio = Number(params.get('anio') || document.getElementById('cAnio')?.value || 2026) || 2026;

  const anioInput = document.getElementById('cAnio');
  if (anioInput) anioInput.value = String(cAnio);
  setText('cAnioLabel', cAnio);

  const reload = async () => {
    cAnio = Number(document.getElementById('cAnio')?.value || cAnio) || cAnio;
    setText('cAnioLabel', cAnio);
    await cLoadList();
  };

  document.getElementById('cReload')?.addEventListener('click', reload);
  anioInput?.addEventListener('change', reload);

  document.getElementById('cFiltroSucursal')?.addEventListener('change', async () => {
    cFiltroSucursal = String(document.getElementById('cFiltroSucursal')?.value || '').trim();
    await cLoadList();
  });

  document.getElementById('cFiltroGerencia')?.addEventListener('change', async () => {
    cFiltroGerencia = String(document.getElementById('cFiltroGerencia')?.value || '').trim();
    await cLoadList();
  });

  document.getElementById('cFiltroEstado')?.addEventListener('change', async () => {
    cFiltroEstado = String(document.getElementById('cFiltroEstado')?.value || '').trim();
    await cLoadList();
  });

  document.getElementById('cClose')?.addEventListener('click', cCloseModal);
  document.getElementById('cBackdrop')?.addEventListener('click', (ev) => {
    if (ev.target && ev.target.id === 'cBackdrop') cCloseModal();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') cCloseModal();
  });

  document.getElementById('cSave')?.addEventListener('click', async () => {
    const evaluadoId = document.getElementById('cEvaluadoId')?.value || '';
    if (!evaluadoId) return;

    const evalIdFromModal = String(document.getElementById('cEvalId')?.value || '').trim();

    if (!cModalIsComplete()){
      cRefreshModalValidation({ silent: false });
      return;
    }

    const btn = document.getElementById('cSave');
    if (btn) btn.disabled = true;

    const msg = document.getElementById('cModalMsg');

    const scoreFromValor = (v) => {
      const s = String(v || '').trim();
      if (s === 'Bajo Normal') return 1;
      if (s === 'Normal') return 2;
      if (s === 'Muy Bien') return 3;
      if (s === 'Excelente') return 4;
      return null;
    };

    const getAnswersFromModal = () => {
      const body = document.getElementById('cModalBody');
      const out = [];
      if (!body) return out;
      body.querySelectorAll('select[data-crit]').forEach(sel => {
        const itemId = sel.getAttribute('data-crit');
        const valor = String(sel.value || '').trim();
        out.push({ item_id: itemId, valor, score: scoreFromValor(valor) });
      });
      return out;
    };

    const answers = getAnswersFromModal();
    const notes = String(document.getElementById('cNotes')?.value || '').trim();

    try{
      if (msg) msg.textContent = 'Chequeando items (rrhh_cp_items)...';

      const { data: itData, error: itErr } = await supa
        .from(T_CP_ITEMS)
        .select('item_id')
        .eq('activo', true)
        .order('item_id', { ascending: true })
        .limit(200);
      if (itErr) throw itErr;

      const dbItemIds = (itData || []).map(r => r.item_id).filter(v => v !== null && v !== undefined);
      if (dbItemIds.length != answers.length){
        throw new Error(`Cantidad de items no coincide. En UI: ${answers.length}. En rrhh_cp_items(activo): ${dbItemIds.length}.`);
      }

      if (msg) msg.textContent = 'Guardando cabecera (rrhh_cp_cab)...';

      let evalId = evalIdFromModal || null;

      const { data: cabExist, error: cabSelErr } = await supa
        .from(T_CP_CAB)
        .select('eval_id')
        .eq('anio', cAnio)
        .eq('evaluado_id', evaluadoId)
        .order('eval_id', { ascending: false })
        .limit(1);
      if (cabSelErr) throw cabSelErr;
      if (!evalId && cabExist && cabExist.length) evalId = cabExist[0].eval_id;

      if (!evalId){
        const cabPayload = {
          anio: cAnio,
          evaluador_id: CP_EVALUADOR_FIJO,
          evaluado_id: evaluadoId,
        };

        const { data: cabIns, error: cabInsErr } = await supa
          .from(T_CP_CAB)
          .insert(cabPayload)
          .select('eval_id')
          .limit(1);
        if (cabInsErr) throw cabInsErr;
        evalId = cabIns?.[0]?.eval_id || null;
      }

      if (!evalId) throw new Error('No se pudo obtener eval_id de rrhh_cp_cab.');

      if (msg) msg.textContent = 'Guardando respuestas (rrhh_cp_respuestas)...';

      const respPayload = answers.map((a, idx) => ({
        eval_id: evalId,
        item_id: dbItemIds[idx],
        valor: a.valor,
        score: a.score,
      }));

      const { error: upErr } = await supa
        .from(T_CP_RESP)
        .upsert(respPayload, { onConflict: 'eval_id,item_id' });
      if (upErr) throw upErr;

      let cabUpErr = null;
      {
        const patch = { estado: 'COMPLETA' };
        if (notes) patch.observaciones = notes;
        const { error } = await supa
          .from(T_CP_CAB)
          .update(patch)
          .eq('eval_id', evalId);
        cabUpErr = error || null;
      }

      if (cabUpErr){
        const msgTxt = String(cabUpErr.message || '').toLowerCase();
        if (msgTxt.includes('observaciones') || msgTxt.includes('column')){
          const { error } = await supa
            .from(T_CP_CAB)
            .update({ estado: 'COMPLETA' })
            .eq('eval_id', evalId);
          cabUpErr = error || null;
        }
      }

      if (cabUpErr) throw cabUpErr;

      await cLoadList();

      if (msg) msg.textContent = 'OK: evaluación guardada (Completa).';
      setTimeout(() => cCloseModal(), 350);

    }catch(err){
      console.error(err);
      if (msg) msg.textContent = `Error al guardar en Supabase: ${fmtErr(err)}`;
    }finally{
      if (btn) btn.disabled = !cModalIsComplete();
    }
  });

  cSetState('Cargando...');
  await cLoadList();
  // cLoadList() ya setea el estado con los contadores (Completa / Pendiente).
  // No sobrescribir con "OK".
}


// =========================
// FLAGS (Elegibilidad)
// =========================

const T_FLAGS = 'rrhh_legajo_flags';

let flagsRows = [];
let flagsDirty = new Map(); // id -> { des, cp }
let flagsBase = new Map();  // id -> { des, cp } baseline (para detectar cambios reales)

// Auto-guardado (solo flags):
// - Debounce para no spammear requests
// - Evita solapamiento de guardados y reintenta si hubo cambios durante el guardado
let flagsAutoSaveTimer = null;
let flagsAutoSaveInFlight = false;
let flagsAutoSaveQueued = false;

function flagsScheduleAutoSave(){
  if (document.body?.dataset?.page !== 'flags') return;

  // Si no hay cambios, no guardamos nada
  if (flagsDirty.size === 0){
    flagsSetState('Sin cambios');
    return;
  }

  if (flagsAutoSaveTimer) clearTimeout(flagsAutoSaveTimer);

  // Feedback inmediato (sin bloquear UI)
  flagsSetState('Pendiente de guardar...');

  flagsAutoSaveTimer = setTimeout(async () => {
    if (flagsDirty.size === 0){
      flagsSetState('Sin cambios');
      return;
    }

    if (flagsAutoSaveInFlight){
      flagsAutoSaveQueued = true;
      return;
    }

    flagsAutoSaveInFlight = true;
    try{
      await flagsSave();
    }catch(err){
      console.error(err);
      flagsSetState('Error al guardar');
    }finally{
      flagsAutoSaveInFlight = false;

      // Si hubo cambios mientras guardábamos, reintentar (debounce)
      if (flagsAutoSaveQueued){
        flagsAutoSaveQueued = false;
        flagsScheduleAutoSave();
      }
    }
  }, 650);
}

function flagsGetFilters(){
  return {
    ger: ($('#fFGerencia')?.value || ''),
    suc: ($('#fFSucursal')?.value || ''),
    sec: ($('#fFSector')?.value || ''),
    q: normalizeText(($('#fSearch')?.value || '').trim()),
    checkCol: ($('#fCheckCol')?.value || 'des'),
    checkState: ($('#fCheckState')?.value || '')
  };
}

function flagsSetState(msg){
  setText('fState', msg);
}

function flagsUpdateDirtyPills(){
  setText('fDirty', flagsDirty.size);
}

function flagsUpdateSummaryPills(rows){
  // rows: conjunto actualmente visible (post-filtros)
  const evalCount = rows.reduce((acc, r) => acc + (r.des ? 1 : 0), 0);
  const cpCount = rows.reduce((acc, r) => acc + (r.cp ? 1 : 0), 0);
  setText('fEvalCount', evalCount);
  setText('fCpCount', cpCount);
}

function flagsGetVisibleRows(){
  const { ger, suc, sec, q, checkCol, checkState } = flagsGetFilters();

  let rows = flagsRows;
  if (ger) rows = rows.filter(r => (r.gerencia || '') === ger);
  if (suc) rows = rows.filter(r => (r.sucursal || '') === suc);
  if (sec) rows = rows.filter(r => (r.sector || '') === sec);

  if (q){
    rows = rows.filter(r => normalizeText(`${r.nombre} ${r.sucursal} ${r.gerencia} ${r.sector}`).includes(q));
  }


  // Filtro por tildados/no tildados (según columna seleccionada)
  if (checkState){
    const wantChecked = checkState === 'checked';
    if (checkCol === 'cp') rows = rows.filter(r => (!!r.cp) === wantChecked);
    else rows = rows.filter(r => (!!r.des) === wantChecked);
  }

  return rows.slice().sort((a,b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function flagsApplyAndRender(){
  const rows = flagsGetVisibleRows();

  setText('fCount', rows.length);
  flagsUpdateSummaryPills(rows);

  const tbody = $('#fTbody');
  if (!tbody) return;

  tbody.innerHTML = rows.map(r => {
    const isDirty = flagsDirty.has(r.id);
    return `<tr data-id="${escapeHtml(r.id)}" class="${isDirty ? 'row-dirty' : ''}">
      <td>${escapeHtml(r.nombre)}</td>
      <td>${escapeHtml(r.sucursal)}</td>
      <td>${escapeHtml(r.gerencia)}</td>
      <td>${escapeHtml(r.sector)}</td>
      <td class="td-center">
        <input type="checkbox" class="chk" data-id="${escapeHtml(r.id)}" data-k="des" ${r.des ? 'checked' : ''} />
      </td>
      <td class="td-center">
        <input type="checkbox" class="chk" data-id="${escapeHtml(r.id)}" data-k="cp" ${r.cp ? 'checked' : ''} />
      </td>
    </tr>`;
  }).join('');

  // listeners (delegation)
  tbody.querySelectorAll('input.chk').forEach(chk => {
    chk.addEventListener('change', (ev) => {
      const el = ev.currentTarget;
      const id = el.getAttribute('data-id');
      const k = el.getAttribute('data-k');
      const v = !!el.checked;

      const row = flagsRows.find(x => x.id === id);
      if (!row) return;

      if (k === 'des') row.des = v;
      if (k === 'cp') row.cp = v;

      // Detectar si realmente cambió respecto al baseline
      const base = flagsBase.get(id) || { des: row.des, cp: row.cp };
      const isReallyDirty = (row.des !== !!base.des) || (row.cp !== !!base.cp);

      if (isReallyDirty) flagsDirty.set(id, { des: row.des, cp: row.cp });
      else flagsDirty.delete(id);

      flagsUpdateDirtyPills();

      // marcar/desmarcar fila
      const tr = el.closest('tr');
      if (tr){
        if (isReallyDirty) tr.classList.add('row-dirty');
        else tr.classList.remove('row-dirty');
      }

      // re-render para respetar el filtro (por ejemplo, si deja de matchear)
      flagsApplyAndRender();

      flagsScheduleAutoSave();
    });
  });

  // sticky header (solo flags)
  if (window.__flagsSticky && typeof window.__flagsSticky.sync === 'function'){
    window.__flagsSticky.sync();
  }

}

async function flagsLoad(){
  const supa = createClient();
  flagsSetState('Cargando...');

  // 1) Legajos activos
  const { data: legajos, error: e1 } = await supa
    .from(T_LEGAJOS)
    // Nota: ya NO dependemos de rrhh_legajos_stage.es_evaluable (se migró a rrhh_legajo_flags)
    .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector","Baja"')
    .eq('Baja', 'Activo')
    .limit(5000);
  if (e1) throw e1;

  // 2) Flags
  const { data: flags, error: e2 } = await supa
    .from(T_FLAGS)
    .select('legajo_id,es_evaluable_desempeno,es_evaluable_cp')
    .limit(10000);
  if (e2) throw e2;

  const byId = new Map();
  (flags || []).forEach(f => {
    if (f && f.legajo_id) byId.set(f.legajo_id, f);
  });

  const raw = Array.isArray(legajos) ? legajos : [];

  flagsRows = raw.map(r => {
    const id = r['ID'];
    const f = byId.get(id);

    // defaults: si no hay flag, consideramos evaluable (true)
    const des = (f && typeof f.es_evaluable_desempeno === 'boolean')
      ? f.es_evaluable_desempeno
      : true;

    const cp = (f && typeof f.es_evaluable_cp === 'boolean') ? f.es_evaluable_cp : true;

    return {
      id,
      nombre: resCleanName(r['Nombre Completo'] || '—'),
      sucursal: r['Sucursal'] || '',
      gerencia: r['Gerencia'] || '',
      sector: r['Sector'] || '',
      des: !!des,
      cp: !!cp
    };
  });

  // Baseline
  flagsBase = new Map(flagsRows.map(r => [r.id, { des: !!r.des, cp: !!r.cp }]));

  // filtros
  fillSelect($('#fFGerencia'), uniqSorted(flagsRows.map(r => r.gerencia)), { includeAllLabel: 'Todas' });
  fillSelect($('#fFSucursal'), uniqSorted(flagsRows.map(r => r.sucursal)), { includeAllLabel: 'Todas' });
  fillSelect($('#fFSector'), uniqSorted(flagsRows.map(r => r.sector)), { includeAllLabel: 'Todos' });

  flagsDirty = new Map();
  flagsUpdateDirtyPills();

  flagsApplyAndRender();
  flagsSetState('OK');
}

async function flagsSave(){
  const supa = createClient();
  const btn = $('#fSave');
  if (btn) btn.disabled = true;

  try{
    if (flagsDirty.size === 0){
      flagsSetState('Sin cambios');
      return;
    }

    flagsSetState('Guardando...');

    const payload = [];
    for (const [id, v] of flagsDirty.entries()){
      payload.push({
        legajo_id: id,
        es_evaluable_desempeno: !!v.des,
        es_evaluable_cp: !!v.cp
      });
    }

    // 1) upsert flags
    const { error: e1 } = await supa
      .from(T_FLAGS)
      .upsert(payload, { onConflict: 'legajo_id' });
    if (e1) throw e1;

    // Nota: ya NO sincronizamos rrhh_legajos_stage.es_evaluable.
    // La fuente de verdad es rrhh_legajo_flags.

    // Actualizar baseline para que los cambios guardados dejen de contarse como "dirty"
    for (const p of payload){
      flagsBase.set(p.legajo_id, { des: !!p.es_evaluable_desempeno, cp: !!p.es_evaluable_cp });
    }

    flagsDirty = new Map();
    flagsUpdateDirtyPills();

    // quitar marca dirty de filas
    document.querySelectorAll('tr.row-dirty').forEach(tr => tr.classList.remove('row-dirty'));

    // refrescar tabla y contadores visibles
    flagsApplyAndRender();
    flagsSetState('OK: guardado');

  }finally{
    if (btn) btn.disabled = false;
  }
}

// =========================
// Sticky header de la tabla (SOLO flags.html)
// - No usamos position:sticky del thead porque .table-wrap tiene overflow:auto (rompe sticky vertical).
// - Solución: clon fijo del thead, alineado y sincronizado con scroll horizontal.
// =========================
function flagsSetupStickyHeader(){
  if (document.body?.dataset?.page !== 'flags') return;

  const wrap = document.querySelector('.flags-table-card .table-wrap');
  const table = wrap?.querySelector('table');
  const thead = table?.querySelector('thead');
  if (!wrap || !table || !thead) return;

  let host = document.getElementById('flagsStickyHead');
  if (!host){
    host = document.createElement('div');
    host.id = 'flagsStickyHead';
    host.className = 'flags-sticky-head';
    host.innerHTML = '<div class="flags-sticky-clip"></div>';
    document.body.appendChild(host);
  }
  const clip = host.querySelector('.flags-sticky-clip');

  // Build clone thead table (una sola vez)
  if (!host._built){
    const cloneTable = document.createElement('table');
    const cloneThead = thead.cloneNode(true);
    cloneTable.appendChild(cloneThead);
    clip.innerHTML = '';
    clip.appendChild(cloneTable);
    host._table = cloneTable;
    host._built = true;
  }

  const sync = () => {
    const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0;

    const wrapRect = wrap.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const theadRect = thead.getBoundingClientRect();

    // Posicion/clip del sticky (solo el ancho visible del wrap)
    host.style.left = `${wrapRect.left}px`;
    host.style.width = `${wrapRect.width}px`;

    // Ancho real de la tabla (para que coincidan columnas)
    host._table.style.width = `${tableRect.width}px`;

    // Sincronizar anchos de columnas
    const srcTh = Array.from(thead.querySelectorAll('th'));
    const dstTh = Array.from(host._table.querySelectorAll('th'));
    srcTh.forEach((th, i) => {
      const w = Math.ceil(th.getBoundingClientRect().width);
      if (dstTh[i]) dstTh[i].style.width = `${w}px`;
    });

    // Sincronizar scroll horizontal del wrap
    const sl = wrap.scrollLeft || 0;
    host._table.style.transform = `translateX(${-sl}px)`;

    // Mostrar/ocultar según scroll vertical de la página
    const theadTop = theadRect.top + window.scrollY;
    const tableBottom = tableRect.bottom + window.scrollY;
    const theadH = theadRect.height || 0;

    const y = window.scrollY + headerH; // borde superior disponible debajo del header fijo
    const visible = (y >= theadTop) && (y < (tableBottom - theadH));

    if (visible){
      host.classList.add('is-visible');
      document.body.classList.add('flags-sticky-on');
    }else{
      host.classList.remove('is-visible');
      document.body.classList.remove('flags-sticky-on');
    }
  };

  // Exponer para re-sync después de cada render/filtro
  window.__flagsSticky = { sync };

  // Listeners (solo se registran una vez)
  if (!host._listeners){
    window.addEventListener('scroll', () => sync(), { passive: true });
    window.addEventListener('resize', () => sync(), { passive: true });
    wrap.addEventListener('scroll', () => sync(), { passive: true });
    host._listeners = true;
  }

  // Primer sync
  sync();
}


// =========================
// Sticky del thead SOLO en Listado Evaluaciones (clon fijo)
// =========================
function leSetupStickyHeader(){
  const body = document.body;
  if (!body || body.dataset.page !== 'listado_evaluaciones') return;

  const wrap = document.querySelector('.le-card2 .table-wrap');
  const table = wrap?.querySelector('table');
  const thead = table?.querySelector('thead');
  if (!wrap || !table || !thead) return;

  // Host fijo (creado una sola vez)
  let host = document.getElementById('leStickyHead');
  if (!host){
    host = document.createElement('div');
    host.id = 'leStickyHead';
    host.className = 'le-sticky-head';
    host.innerHTML = '<div class="le-sticky-clip"></div>';
    document.body.appendChild(host);
  }
  const clip = host.querySelector('.le-sticky-clip');

  // Tabla clon (solo header)
  let cloneTable = host.querySelector('table');
  if (!cloneTable){
    cloneTable = document.createElement('table');
    cloneTable.className = table.className;
    clip.appendChild(cloneTable);
  }
  cloneTable.innerHTML = '';
  cloneTable.appendChild(thead.cloneNode(true));

  const sync = () => {
    // header principal
    const header = document.querySelector('header');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--header-h', headerH + 'px');

    // geometría
    const wrapRect = wrap.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const origThs = Array.from(thead.querySelectorAll('th'));
    const cloneThs = Array.from(cloneTable.querySelectorAll('th'));

    // copiar anchos de columnas
    origThs.forEach((th, i) => {
      const w = th.getBoundingClientRect().width;
      if (cloneThs[i]) cloneThs[i].style.width = w + 'px';
    });

    // ancho total de la tabla (para que al hacer scroll horizontal calce)
    cloneTable.style.width = tableRect.width + 'px';

    // pos/clip del host
    host.style.left = wrapRect.left + 'px';
    host.style.width = wrapRect.width + 'px';

    // compensar scroll horizontal
    cloneTable.style.transform = `translateX(${-wrap.scrollLeft}px)`;

    // rango visible (entre top del thead y bottom de la tabla)
    const theadRect = thead.getBoundingClientRect();
    const theadH = theadRect.height || 44;
    const tableTop = window.scrollY + theadRect.top;
    const tableBottom = window.scrollY + tableRect.bottom;
    const y = window.scrollY + headerH;

    const shouldShow = y >= tableTop && y < (tableBottom - theadH - 4);
    host.classList.toggle('is-visible', shouldShow);
    document.body.classList.toggle('le-sticky-on', shouldShow);

    // evitar ver lo de abajo “atravesando” (fondo sólido)
    if (shouldShow){
      clip.style.background = '#eef2ff';
    }
  };

  const onScroll = () => sync();
  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('resize', onScroll);
  wrap.addEventListener('scroll', onScroll, { passive:true });

  // expone para re-sync tras render
  window.__leSticky = { sync };
  sync();
}

async function initFlags(){
  // listeners
  $('#fFGerencia')?.addEventListener('change', flagsApplyAndRender);
  $('#fFSucursal')?.addEventListener('change', flagsApplyAndRender);
  $('#fFSector')?.addEventListener('change', flagsApplyAndRender);
  $('#fSearch')?.addEventListener('input', flagsApplyAndRender);
  $('#fCheckCol')?.addEventListener('change', flagsApplyAndRender);
  $('#fCheckState')?.addEventListener('change', flagsApplyAndRender);

  $('#fReload')?.addEventListener('click', async () => {
    try{ await flagsLoad(); }catch(err){ console.error(err); flagsSetState('Error'); }
  });
  await flagsLoad();
  // sticky header del thead (solo flags)
  flagsSetupStickyHeader();
}

// =========================
// Resultados
// - Página "Resultados": lista SOLO evaluaciones COMPLETAS (Desempeño)
// - Al seleccionar un evaluado, muestra la grilla completa (Desempeño + Compromiso y Presentismo)
// =========================

let resLegajos = [];
let resLegajoById = new Map(); // id -> legajo
let resEvalCabMap = new Map(); // evaluado_id -> { eval_id, estado, updated_at }
// Para soportar múltiples evaluaciones por evaluado (Resultados)
let resEvalCabsByEvaluado = new Map(); // evaluado_id -> [cab...] (solo COMPLETAS, orden desc)
let resEvalCabById = new Map(); // eval_id -> cab
let resCpCabMap   = new Map(); // evaluado_id -> { eval_id, estado, updated_at }
// Para soportar múltiples C&P por evaluado (Resultados - contadores)
let resCpCabsByEvaluado = new Map(); // evaluado_id -> [cab...] (solo COMPLETAS, orden desc)
let resCpCabById = new Map(); // eval_id -> cab

let resSelectedId = '';
let resSelectedEvalId = '';
let resAnio = 2026;


// Cache de flags por legajo (Resultados)
let resFlagsCache = new Map(); // legajo_id -> { cp: boolean }

async function resGetFlagCp(supa, legajoId){
  const key = String(legajoId || '');
  if (!key) return true; // por defecto: se asume evaluable (más seguro)
  const cached = resFlagsCache.get(key);
  if (cached && typeof cached.cp === 'boolean') return cached.cp;

  try{
    const { data, error } = await supa
      .from(T_FLAGS)
      .select('es_evaluable_cp')
      .eq('legajo_id', key)
      .maybeSingle();
    if (error) throw error;

    const cp = (data && typeof data.es_evaluable_cp === 'boolean') ? data.es_evaluable_cp : true;
    resFlagsCache.set(key, { cp });
    return cp;
  }catch(e){
    console.error('resGetFlagCp', e);
    // Si falla, no inventamos "no aplica": preferimos pedir evaluación
    resFlagsCache.set(key, { cp: true });
    return true;
  }
}


// Precarga flags CP para acelerar contadores/lista (Resultados)
async function resPrimeFlagsCp(supa, legajoIds){
  const ids = Array.from(new Set((legajoIds || []).map(x => String(x||'').trim()).filter(Boolean)));
  if (!ids.length) return;

  // chunk para evitar límites del IN
  const CHUNK = 500;
  for (let i=0; i<ids.length; i+=CHUNK){
    const chunk = ids.slice(i, i+CHUNK);
    try{
      const { data, error } = await supa
        .from(T_FLAGS)
        .select('legajo_id,es_evaluable_cp')
        .in('legajo_id', chunk)
        .limit(20000);
      if (error) throw error;

      (data || []).forEach(f => {
        const id = String(f.legajo_id || '').trim();
        if (!id) return;
        const cp = (typeof f.es_evaluable_cp === 'boolean') ? f.es_evaluable_cp : true;
        resFlagsCache.set(id, { cp });
      });
    }catch(e){
      console.error('resPrimeFlagsCp', e);
      // si falla, dejamos cache vacío (fallback: true)
      return;
    }
  }
}


function resEstadoUiFromDb(dbEstado){
  const stRaw = String(dbEstado || '').trim();
  const st = stRaw ? stRaw.toUpperCase() : '';
  if (st === 'COMPLETA' || st === 'FINALIZADA') return { ui: 'Completa', raw: stRaw };
  if (stRaw) return { ui: 'Borrador', raw: stRaw };
  return { ui: 'Pendiente', raw: '' };
}

function resBadgeClass(ui){
  if (ui === 'Completa') return 'r-badge r-badge--ok';
  if (ui === 'Borrador') return 'r-badge r-badge--draft';
  return 'r-badge r-badge--pending';
}

function resSetState(msg){
  setText('resState', msg);
}

function resNormalizeValor(v){
  const s = String(v || '').trim();
  if (!s) return '';
  // Normaliza variantes para que el dashboard y los gráficos no "pierdan" la categoría.
  const lo = s.toLowerCase();
  if (lo === 'muy bueno' || lo === 'muy bien') return 'Muy Bien';
  if (lo === 'bajo normal') return 'Bajo Normal';
  if (lo === 'normal') return 'Normal';
  if (lo === 'excelente') return 'Excelente';
  return s;
}

function resCleanName(s){
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function resValorTagClass(v){
  const x = String(v || '').toLowerCase();
  if (x === 'bajo normal') return 'r-tag r-tag-bajo';
  if (x === 'normal') return 'r-tag r-tag-normal';
  if (x === 'muy bueno' || x === 'muy bien') return 'r-tag r-tag-muy';
  if (x === 'excelente') return 'r-tag r-tag-exc';
  return 'r-tag';
}

async function resLoadLegajos(supa){
  const { data, error } = await supa
    .from(T_LEGAJOS)
    .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector","Baja"')
    .eq('Baja', 'Activo')
    .limit(5000);
  if (error) throw error;

  const raw = Array.isArray(data) ? data : [];
  resLegajos = raw.map(r => ({
    id: r['ID'],
    nombre: resCleanName(r['Nombre Completo'] || '—'),
    sucursal: r['Sucursal'] || '',
    gerencia: r['Gerencia'] || '',
    sector: r['Sector'] || ''
  }));


  // cache rápido por id
  resLegajoById = new Map(resLegajos.map(x => [String(x.id), x]));
}

async function resBuildCabMap(supa, cabTable, selectFields){
  const fields = selectFields || 'eval_id,evaluado_id,estado,updated_at';
  const { data, error } = await supa
    .from(cabTable)
    .select(fields)
    .eq('anio', resAnio)
    .limit(20000);
  if (error) throw error;

  const map = new Map();
  (data || []).forEach(r => {
    const eid = String(r.evaluado_id || '');
    if (!eid) return;

    const cur = { eval_id: r.eval_id, evaluado_id: r.evaluado_id, evaluador_id: r.evaluador_id, estado: r.estado, updated_at: r.updated_at };
    const prev = map.get(eid);

    if (!prev){
      map.set(eid, cur);
      return;
    }

    // Preferimos COMPLETA por sobre borrador/pendiente; si ambas iguales, usamos la más nueva.
    const prevUi = resEstadoUiFromDb(prev.estado).ui;
    const curUi  = resEstadoUiFromDb(cur.estado).ui;

    if (prevUi !== 'Completa' && curUi === 'Completa'){
      map.set(eid, cur);
      return;
    }
    if (prevUi === curUi){
      const p = prev.updated_at ? new Date(prev.updated_at).getTime() : 0;
      const c = cur.updated_at ? new Date(cur.updated_at).getTime() : 0;
      if (c > p) map.set(eid, cur);
    }
  });

  return map;
}

// Carga TODAS las evaluaciones COMPLETAS (Desempeño) del año para soportar selector en Resultados
async function resLoadAllEvalCabs(supa){
  const { data, error } = await supa
    .from(T_EVAL_CAB)
    .select('eval_id,evaluado_id,evaluador_id,estado,updated_at,created_at')
    .eq('anio', resAnio)
    .limit(20000);
  if (error) throw error;

  const byEvaluado = new Map();
  const byId = new Map();

  (data || []).forEach(r => {
    const evaluadoId = String(r?.evaluado_id || '');
    const evalId = String(r?.eval_id || '');
    if (!evaluadoId || !evalId) return;

    // Solo COMPLETAS
    if (resEstadoUiFromDb(r?.estado).ui !== 'Completa') return;

    const cab = {
      eval_id: r.eval_id,
      evaluado_id: r.evaluado_id,
      evaluador_id: r.evaluador_id,
      estado: r.estado,
      updated_at: r.updated_at,
      created_at: r.created_at
    };

    byId.set(evalId, cab);
    const arr = byEvaluado.get(evaluadoId) || [];
    arr.push(cab);
    byEvaluado.set(evaluadoId, arr);
  });

  // Orden: más nueva primero
  byEvaluado.forEach(arr => {
    arr.sort((a,b) => {
      const ta = a?.updated_at || a?.created_at || 0;
      const tb = b?.updated_at || b?.created_at || 0;
      return (new Date(tb).getTime() || 0) - (new Date(ta).getTime() || 0);
    });
  });

  // Mapa default: última completa por evaluado
  const defaultMap = new Map();
  byEvaluado.forEach((arr, eid) => {
    if (arr && arr.length) defaultMap.set(String(eid), arr[0]);
  });

  return { byEvaluado, byId, defaultMap };
}

// Carga TODAS las C&P COMPLETAS del año para contar múltiples por evaluado en Resultados (si existieran)
async function resLoadAllCpCabs(supa){
  const { data, error } = await supa
    .from(T_CP_CAB)
    .select('eval_id,evaluado_id,evaluador_id,estado,updated_at,created_at')
    .eq('anio', resAnio)
    .limit(20000);
  if (error) throw error;

  const byEvaluado = new Map();
  const byId = new Map();

  (data || []).forEach(r => {
    const evaluadoId = String(r?.evaluado_id || '');
    const evalId = String(r?.eval_id || '');
    if (!evaluadoId || !evalId) return;

    // Solo COMPLETAS
    if (resEstadoUiFromDb(r?.estado).ui !== 'Completa') return;

    const cab = {
      eval_id: r.eval_id,
      evaluado_id: r.evaluado_id,
      evaluador_id: r.evaluador_id,
      estado: r.estado,
      updated_at: r.updated_at,
      created_at: r.created_at
    };

    byId.set(evalId, cab);
    const arr = byEvaluado.get(evaluadoId) || [];
    arr.push(cab);
    byEvaluado.set(evaluadoId, arr);
  });

  // Orden: más nueva primero
  byEvaluado.forEach(arr => {
    arr.sort((a,b) => {
      const ta = a?.updated_at || a?.created_at || 0;
      const tb = b?.updated_at || b?.created_at || 0;
      return (new Date(tb).getTime() || 0) - (new Date(ta).getTime() || 0);
    });
  });

  return { byEvaluado, byId };
}



function resApplyAndRender(){
  const fGer = $('#resGerencia')?.value || '';
  const fSuc = $('#resSucursal')?.value || '';
  const q = normalizeText(($('#resSearch')?.value || '').trim());

  let rows = resLegajos.slice();
  if (fGer) rows = rows.filter(r => (r.gerencia || '') === fGer);
  if (fSuc) rows = rows.filter(r => (r.sucursal || '') === fSuc);
  if (q){
    rows = rows.filter(r => normalizeText(`${r.nombre} ${r.sucursal} ${r.gerencia} ${r.sector}`).includes(q));
  }

  // SOLO COMPLETAS (Desempeño)
  rows = rows.filter(r => resEstadoUiFromDb(resEvalCabMap.get(String(r.id))?.estado).ui === 'Completa');

  // Orden consistente por nombre
  rows.sort((a,b) => normalizeText(a.nombre).localeCompare(normalizeText(b.nombre), 'es'));

  // Contador de Evaluaciones: suma todas las evaluaciones COMPLETAS (considera múltiples por evaluado)
  const totalEval = rows.reduce((acc, r) => {
    const id = String(r.id);
    return acc + ((resEvalCabsByEvaluado.get(id) || []).length || 0);
  }, 0);
  setText('resCount', totalEval);

  // Contador de Completas: suma todas las evaluaciones cuya C.P. está completa o NO se evalúa (si falta C.P. y es elegible, quedan incompletas)
  const totalCompletas = rows.reduce((acc, r) => {
    const id = String(r.id);
    const evalCount = (resEvalCabsByEvaluado.get(id) || []).length || 0;

    const cpEleg = resFlagsCache.get(id)?.cp;
    const isEleg = (typeof cpEleg === 'boolean') ? cpEleg : true; // si falta flag: asumimos elegible

    const cpUi = resEstadoUiFromDb(resCpCabMap.get(id)?.estado).ui;
    const isDone = (cpUi === 'Completa' || !isEleg);

    return acc + (isDone ? evalCount : 0);
  }, 0);
  setText('resCountOk', totalCompletas);


  const list = document.getElementById('resList');
  if (!list) return;

  list.innerHTML = rows.map(r => {
    const id = String(r.id);
    const isSel = String(resSelectedId) && String(resSelectedId) === id;

    // Cantidad de evaluaciones COMPLETAS del año (si >1, mostramos badge)
    const evalCount = (resEvalCabsByEvaluado.get(id) || []).length;

    const cpEleg = resFlagsCache.get(id)?.cp;
    const isEleg = (typeof cpEleg === 'boolean') ? cpEleg : true;
    const cpUi = resEstadoUiFromDb(resCpCabMap.get(id)?.estado).ui;
    const isDone = (cpUi === 'Completa' || !isEleg);

    // Visual: verde suave si está completo (o no aplica C&P), rojo suave si le falta C&P
    const statusClass = isDone ? 'is-done' : 'is-pending';

    return `
      <div class="r-item ${statusClass} ${isSel ? 'is-selected' : ''}" data-evaluado-id="${escapeHtml(r.id)}" role="button" tabindex="0">
        <div class="r-main">
          <div class="r-name">${escapeHtml(r.nombre)}${evalCount > 1 ? ` <span class="res-multi-count" aria-label="${evalCount} evaluaciones">${evalCount}</span>` : ''}</div>
        </div>
        <button class="r-action" type="button" aria-label="Ver">&#8250;</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-evaluado-id]').forEach(el => {
    const handler = async () => {
      const id = el.getAttribute('data-evaluado-id') || '';
      await resSelectEvaluado(id);
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });

  // Si ya hay uno seleccionado y quedó filtrado afuera, limpiamos.
  if (resSelectedId && !rows.some(r => String(r.id) === String(resSelectedId))){
    resSelectedId = '';
    setText('resSelName', '—');
    setText('resSelEvaluador', 'Evaluador: —');
    setText('resSelFecha', '');
    const msg = document.getElementById('resEmptyMsg'); if (msg) msg.textContent = 'Seleccioná un evaluado para ver el detalle.';
    const punt = document.getElementById('resPuntaje'); if (punt) punt.textContent = '—';
    const tb = document.getElementById('resTbody'); if (tb) tb.innerHTML = '';
    const pr = document.getElementById('resPrint'); if (pr) pr.style.display = 'none';
    const ob = document.getElementById('resObsBlock'); if (ob) ob.style.display = 'none';
    const oe = document.getElementById('resObsEval'); if (oe) oe.textContent = '—';
    const oc = document.getElementById('resObsCp'); if (oc) oc.textContent = '—';
  }
}

function resEnsureEvalPicker(allCabs){
  const left = document.querySelector('body[data-page="resultados"] .pane-detalle .pane-head .pane-left');
  if (!left) return;

  let row = document.getElementById('resEvalPickRow');
  if (!row){
    row = document.createElement('div');
    row.id = 'resEvalPickRow';
    row.className = 'res-eval-pick';
    row.innerHTML = `
      <span class="res-eval-label">Evaluación</span>
      <select id="resEvalSelect" class="select res-eval-select" aria-label="Seleccionar evaluación"></select>
    `.trim();

    const evLine = document.getElementById('resSelEvaluador');
    if (evLine && evLine.parentElement === left){
      evLine.insertAdjacentElement('afterend', row);
    } else {
      left.appendChild(row);
    }
  }

  const sel = document.getElementById('resEvalSelect');
  if (!sel) return;

  const cabs = Array.isArray(allCabs) ? allCabs : [];
  if (cabs.length <= 1){
    row.style.display = 'none';
    sel.innerHTML = '';
    return;
  }

  row.style.display = 'flex';

  const fmtDate = (d) => {
    if (!d) return '';
    try{ return new Date(d).toLocaleDateString('es-AR'); }catch(_){ return ''; }
  };

  sel.innerHTML = cabs.map(cab => {
    const id = String(cab?.eval_id || '');
    const evId = cab?.evaluador_id ? String(cab.evaluador_id) : '';
    const ev = evId ? (resLegajoById.get(evId) || null) : null;
    const when = fmtDate(cab?.updated_at || cab?.created_at);
    const label = `${when || '—'} · ${ev?.nombre || '—'}`;
    return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
  }).join('');

  // Selección por defecto: última realizada (1ra del array)
  const fallbackId = String(cabs[0]?.eval_id || '');
  const targetId = String(resSelectedEvalId || fallbackId);
  sel.value = targetId;
  if (sel.value !== targetId) sel.value = fallbackId;

  // Bind una sola vez
  if (!sel.dataset.bound){
    sel.addEventListener('change', () => {
      resSelectedEvalId = sel.value || '';
      if (resSelectedId) resSelectEvaluado(resSelectedId);
    });
    sel.dataset.bound = '1';
  }
}


async function resSelectEvaluado(evaluadoId){
  resSelectedId = evaluadoId || '';
  resApplyAndRender();

  const row = resLegajos.find(x => String(x.id) === String(resSelectedId));
  setText('resSelName', row ? row.nombre : '—');
  setText('resPrintName', row ? row.nombre : '');

  // Selección de evaluación: si hay múltiples, usamos el dropdown; por defecto la última realizada
  const allCabs = resEvalCabsByEvaluado.get(String(resSelectedId)) || [];
  let evalInfo = null;
  if (resSelectedEvalId && allCabs.some(c => String(c?.eval_id) === String(resSelectedEvalId))){
    evalInfo = resEvalCabById.get(String(resSelectedEvalId)) || null;
  }
  if (!evalInfo){
    evalInfo = (allCabs && allCabs.length) ? allCabs[0] : (resEvalCabMap.get(String(resSelectedId)) || null);
  }
  resSelectedEvalId = evalInfo?.eval_id ? String(evalInfo.eval_id) : '';
  resEnsureEvalPicker(allCabs);
  const cpInfo   = resCpCabMap.get(String(resSelectedId)) || null;

  // Mostrar evaluador debajo del nombre
  const evEl = document.getElementById('resSelEvaluador');
  if (evEl){
    const evId = evalInfo?.evaluador_id ? String(evalInfo.evaluador_id) : '';
    const ev = evId ? (resLegajoById.get(evId) || null) : null;
    evEl.textContent = 'Evaluador: ' + (ev?.nombre || '—');
  }

  const msgEl = document.getElementById('resEmptyMsg');
  const tbody = document.getElementById('resTbody');
  const lastEl = document.getElementById('resSelFecha');
  const puntEl = document.getElementById('resPuntaje');
  const chipEl = document.getElementById('puntajeChip');
  const printBtn = document.getElementById('resPrint');
const obsBlock = document.getElementById('resObsBlock');
  const obsEvalEl = document.getElementById('resObsEval');
  const obsCpEl   = document.getElementById('resObsCp');


  if (tbody) tbody.innerHTML = '';
  if (lastEl) lastEl.textContent = '';
  if (puntEl) puntEl.textContent = '—';
  if (chipEl) chipEl.style.display = 'none';
  if (printBtn) printBtn.style.display = 'none';
  if (obsEvalEl) obsEvalEl.textContent = '—';
  if (obsCpEl) obsCpEl.textContent = '—';
  if (obsBlock) obsBlock.style.display = 'none';

  if (!evalInfo?.eval_id){
    if (msgEl) msgEl.textContent = 'Sin evaluación completa para este año.';
    return;
  }

  if (msgEl) msgEl.textContent = 'Cargando...';

  const supa = createClient();

  // =========
  // 1) Traemos IDs de items (ordenados) para mapear UI -> DB
  // =========
  async function loadDbItemIds(table){
    try{
      const { data, error } = await supa
        .from(table)
        .select('item_id')
        .eq('activo', true)
        .order('item_id', { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data || []).map(r => r.item_id);
    }catch(e){
      console.error(e);
      return [];
    }
  }

  const evalDbItemIds = await loadDbItemIds(T_EVAL_ITEMS);

  // C&P: ids + puntaje_indiv (máximo) por orden
  async function loadDbItemMeta(table){
    try{
      const { data, error } = await supa
        .from(table)
        .select('item_id,puntaje_indiv')
        .eq('activo', true)
        .order('item_id', { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data || []).map(r => ({
        id: r.item_id,
        max: (typeof r.puntaje_indiv === 'number')
          ? r.puntaje_indiv
          : (r.puntaje_indiv != null ? Number(r.puntaje_indiv) : 0)
      }));
    }catch(e){
      console.error(e);
      return [];
    }
  }

  const cpDbItems   = await loadDbItemMeta(T_CP_ITEMS);
  const cpDbItemIds = cpDbItems.map(x => x.id);
  const cpMaxByIdx  = cpDbItems.map(x => (typeof x.max === 'number' && !Number.isNaN(x.max)) ? x.max : 0);

  // =========
  // 2) Respuestas (DB item_id -> valor)
  // =========
  async function loadAnswers(evalId, table){
    const mapValor = new Map();
    const mapPuntaje = new Map();
    try{
      const { data, error } = await supa
        .from(table)
        .select('item_id,valor,puntaje,updated_at')
        .eq('eval_id', evalId)
        .limit(20000);
      if (error) throw error;

      (data || []).forEach(r => {
        if (r && r.item_id !== null && r.item_id !== undefined){
          mapValor.set(r.item_id, resNormalizeValor(r.valor));
          mapPuntaje.set(
            r.item_id,
            (typeof r.puntaje === 'number')
              ? r.puntaje
              : (r.puntaje != null ? Number(r.puntaje) : null)
          );
        }
      });

      const last = (data || []).reduce((acc, r) => {
        const t = r?.updated_at ? new Date(r.updated_at).getTime() : 0;
        return Math.max(acc, t);
      }, 0);

      return { mapValor, mapPuntaje, lastTs: last };
    }catch(e){
      console.error(e);
      return { mapValor: new Map(), mapPuntaje: new Map(), lastTs: 0 };
    }
  }

  const evalAns = await loadAnswers(evalInfo.eval_id, 'rrhh_eval_respuestas_calc');
  const cpAns   = cpInfo?.eval_id
    ? await loadAnswers(cpInfo.eval_id, 'rrhh_cp_respuestas_calc')
    : { mapValor: new Map(), mapPuntaje: new Map(), lastTs: 0 };
  // =========
  // Observaciones (cabecera)
  // =========
  async function loadCabObs(table, evalId){
    if (!evalId) return '';
    try{
      const { data, error } = await supa
        .from(table)
        .select('observaciones')
        .eq('eval_id', evalId)
        .limit(1);
      if (error) throw error;
      const v = (data && data[0] && data[0].observaciones != null) ? String(data[0].observaciones) : '';
      return v.trim();
    }catch(e){
      // Si la columna no existe o falla, no mostramos nada
      return '';
    }
  }

  const obsEvalRaw = await loadCabObs(T_EVAL_CAB, evalInfo.eval_id);
  const obsCpRaw   = cpInfo?.eval_id ? await loadCabObs(T_CP_CAB, cpInfo.eval_id) : '';



  // Última actualización: la más nueva entre cab y resp (si existiera)
  const cabTs = Math.max(
    evalInfo?.updated_at ? new Date(evalInfo.updated_at).getTime() : 0,
    cpInfo?.updated_at ? new Date(cpInfo.updated_at).getTime() : 0
  );
  const lastTs = Math.max(cabTs, evalAns.lastTs, cpAns.lastTs);
  if (lastEl && lastTs){
    lastEl.textContent = `Últ. actualización: ${new Date(lastTs).toLocaleDateString('es-AR')}`;
  }

  // =========
  // 3) Mapeo UI (códigos 1.1, 1.2, etc.) -> valor
  // =========
  function flattenUi(rubrica){
    const out = [];
    rubrica.forEach(sec => sec.items.forEach(it => out.push({ code: it.id, label: it.label, sec: sec.title })));
    return out;
  }

  const uiEval = flattenUi(R_RUBRICA);
  const uiCp   = flattenUi(CP_RUBRICA);

  const valByUiCode = new Map();
  const puntByUiCode = new Map();

  uiEval.forEach((it, idx) => {
    const dbId = evalDbItemIds[idx];
    const v = dbId !== undefined ? evalAns.mapValor.get(dbId) : '';
    const p = dbId !== undefined ? evalAns.mapPuntaje.get(dbId) : null;
    valByUiCode.set(it.code, v || '');
    puntByUiCode.set(it.code, (typeof p === 'number' && !Number.isNaN(p)) ? p : null);
  });

  const cpEsEvaluable = await resGetFlagCp(supa, resSelectedId);

// - Si NO es evaluable en C&P => mostramos máximo (como "no aplica").
// - Si SÍ es evaluable pero no tiene evaluación C&P => marcamos "Falta" (en todas las filas) y puntaje 0,00.
const cpFalta = !!cpEsEvaluable && ( !(cpInfo?.eval_id) || cpAns.mapPuntaje.size === 0 );
const cpNoAplica = !cpEsEvaluable;

// Observaciones: mostrar al final del detalle (2 líneas)
let obsEval = (obsEvalRaw || '').trim();
let obsCp = (obsCpRaw || '').trim();

if (!obsEval) obsEval = '—';
if (cpNoAplica) obsCp = 'No se Evalua';
if (!obsCp) obsCp = '—';

if (obsEvalEl) obsEvalEl.textContent = obsEval;
if (obsCpEl) obsCpEl.textContent = obsCp;
if (obsBlock) obsBlock.style.display = 'block';


uiCp.forEach((it, idx) => {
  const dbId = cpDbItemIds[idx];

  // Valoración
  let v = '';
  if (!cpNoAplica && !cpFalta && dbId !== undefined){
    v = (cpAns.mapValor.get(dbId) || '');
  } else if (cpFalta){
    v = 'Falta';
  }

  // Puntaje
  let p = null;
  if (dbId !== undefined){
    if (!cpNoAplica && !cpFalta){
      const got = cpAns.mapPuntaje.get(dbId);
      p = (typeof got === 'number' && !Number.isNaN(got)) ? got : null;
    } else if (cpNoAplica){
      const mx = cpMaxByIdx[idx] ?? 0;
      p = (typeof mx === 'number' && !Number.isNaN(mx)) ? mx : null;
    } else if (cpFalta){
      p = 0;
    }
  }

  valByUiCode.set(it.code, v || '');
  puntByUiCode.set(it.code, p);
});

  // =========
  // 4) Render grilla completa (Desempeño + C&P)
  // =========
  const full = [...R_RUBRICA, ...CP_RUBRICA];


// Helpers de formato (Argentina) + color por rango
function fmtAR(num){
  try{
    return Number(num).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }catch(_){
    return String(num);
  }
}
function applyPuntajeColor(el, total){
  if (!el) return;
  el.classList.remove('puntaje-v-rojo','puntaje-v-amarillo','puntaje-v-verdeclaro','puntaje-v-verdoscuro');
  const t = typeof total === 'number' ? total : Number(total);
  if (!Number.isFinite(t)) return;
  if (t <= 50){
    el.classList.add('puntaje-v-rojo');
  } else if (t <= 75){
    el.classList.add('puntaje-v-amarillo');
  } else if (t <= 80){
    el.classList.add('puntaje-v-verdeclaro');
  } else {
    el.classList.add('puntaje-v-verdoscuro');
  }
}

  // Total puntaje (calculado en Supabase via *_calc)
  let totalPuntaje = 0;
  full.forEach(sec => {
    (sec.items || []).forEach(it => {
      const p = puntByUiCode.get(it.id);
      if (typeof p === 'number' && !Number.isNaN(p)) totalPuntaje += p;
    });
  });
  if (puntEl) {
    puntEl.textContent = (typeof totalPuntaje === 'number' && !Number.isNaN(totalPuntaje)) ? fmtAR(totalPuntaje) : '—';
    applyPuntajeColor(puntEl, totalPuntaje);
  }
  if (chipEl) chipEl.style.display = 'inline-flex';

  const html = full.map(sec => {
    const head = `<tr class="r-sec-row"><td colspan="4">${escapeHtml(sec.title)}</td></tr>`;
    const rows = sec.items.map(it => {
      const v = valByUiCode.get(it.id) || '';
      const isCpSec = normalizeText(sec.title || '').includes('compromiso') && normalizeText(sec.title || '').includes('presentismo');

      // Valoración (tag)
      let val = v ? `<span class="${resValorTagClass(v)}">${escapeHtml(v)}</span>` : '—';

      if (isCpSec){
        const cpEleg = resFlagsCache.get(String(resSelectedId))?.cp;
        const isEleg = (typeof cpEleg === 'boolean') ? cpEleg : true; // si falta flag: asumimos elegible

        if (!isEleg){
          // No aplica Compromiso & Presentismo
          val = `<span class="cp-tag cp-tag-noeval">No se Evalua</span>`;
        } else {
          // Elegible: si falta respuesta mostramos "Falta" (en rojo)
          const vv = String(v || '').trim();
          if (!vv || vv.toLowerCase() === 'falta'){
            val = `<span class="cp-tag cp-tag-falta">Falta</span>`;
          }
        }
      }

      const p = puntByUiCode.get(it.id);
      const ptxt = (typeof p === 'number' && !Number.isNaN(p)) ? fmtAR(p) : '—';
      return `<tr>
        <td class="col-id">${escapeHtml(it.id)}</td>
        <td>${escapeHtml(it.label)}</td>
        <td class="col-val">${val}</td>
        <td class="col-score">${ptxt}</td>
      </tr>`;
    }).join('');
    return head + rows;
  }).join('');

  if (tbody) tbody.innerHTML = html || `<tr><td colspan="4">—</td></tr>`;
  if (msgEl) msgEl.textContent = '';
  if (printBtn) printBtn.style.display = 'inline-flex';
}

async function initResultados(){
  const supa = createClient();

  // defaults
  resAnio = Number(document.getElementById('resAnio')?.value || 2026) || 2026;

  async function doReload(){
    try{
      resAnio = Number(document.getElementById('resAnio')?.value || resAnio) || resAnio;
      setText('resAnioLabel', resAnio);


      resFlagsCache = new Map();
      resSetState('Cargando...');
      await resLoadLegajos(supa);
      await resPrimeFlagsCp(supa, resLegajos.map(r => r.id));
      fillSelect($('#resGerencia'), uniqSorted(resLegajos.map(r => r.gerencia)), { includeAllLabel: 'Todas' });
      fillSelect($('#resSucursal'), uniqSorted(resLegajos.map(r => r.sucursal)), { includeAllLabel: 'Todas' });

      // Desempeño: traer todas las COMPLETAS del año para soportar múltiples evaluaciones por evaluado
      {
        const all = await resLoadAllEvalCabs(supa);
        resEvalCabsByEvaluado = all.byEvaluado;
        resEvalCabById = all.byId;
        resEvalCabMap = all.defaultMap;
      }
      resCpCabMap   = await resBuildCabMap(supa, T_CP_CAB);

      // C&P: traer todas las COMPLETAS del año para contar múltiples por evaluado si existieran
      {
        const allCp = await resLoadAllCpCabs(supa);
        resCpCabsByEvaluado = allCp.byEvaluado;
        resCpCabById = allCp.byId;
      }


      resSelectedId = '';
      resSelectedEvalId = '';
      setText('resSelName', '—');
      setText('resSelEvaluador', 'Evaluador: —');
      setText('resSelFecha', '');
      const msg = document.getElementById('resEmptyMsg'); if (msg) msg.textContent = 'Seleccioná un evaluado para ver el detalle.';
      const punt = document.getElementById('resPuntaje'); if (punt) punt.textContent = '—';
      const tb = document.getElementById('resTbody'); if (tb) tb.innerHTML = '';
      const pr = document.getElementById('resPrint'); if (pr) pr.style.display = 'none';

      const ob = document.getElementById('resObsBlock'); if (ob) ob.style.display = 'none';
      const oe = document.getElementById('resObsEval'); if (oe) oe.textContent = '—';
      const oc = document.getElementById('resObsCp'); if (oc) oc.textContent = '—';


      resApplyAndRender();
      resSetState('OK');
    }catch(err){
      console.error(err);
      resSetState('Error');
      const msg = document.getElementById('resEmptyMsg');
      if (msg) msg.textContent = `Error al cargar: ${fmtErr(err)}`;
    }
  }

  // listeners
    document.getElementById('resPrint')?.addEventListener('click', () => {
    // Imprimir SOLO el detalle (evita espacios en blanco por layout/scroll del grid)
    const name = (document.getElementById('resPrintName')?.textContent || document.getElementById('resSelName')?.textContent || '').trim();
    const tableEl = document.querySelector('#resPrintArea table');
    if (!tableEl){
      alert('No hay detalle para imprimir.');
      return;
    }

    const title = 'Resultados';
    const safeName = (name || '').replace(/[<>]/g, '');
    const evalLineRaw = (document.getElementById('resSelEvaluador')?.textContent || '').trim();
    const evalLine = evalLineRaw ? evalLineRaw.replace(/[<>]/g, '') : '';
    const puntTextRaw = (document.getElementById('resPuntaje')?.textContent || '').trim();
    const puntText = puntTextRaw && puntTextRaw !== '—' ? puntTextRaw : '';
    const obsEvalTxtRaw = (document.getElementById('resObsEval')?.textContent || '').trim();
    const obsCpTxtRaw   = (document.getElementById('resObsCp')?.textContent || '').trim();
    const obsEvalTxt = obsEvalTxtRaw ? obsEvalTxtRaw.replace(/[<>]/g, '') : '';
    const obsCpTxt   = obsCpTxtRaw ? obsCpTxtRaw.replace(/[<>]/g, '') : '';
    const obsHtml = `
      <div class="obs">
        <div class="obs-row"><span class="obs-label">Observaciones Evaluación:</span> <span>${obsEvalTxt || '—'}</span></div>
        <div class="obs-row"><span class="obs-label">Observaciones C.P.:</span> <span>${obsCpTxt || '—'}</span></div>
      </div>
    `.trim();

    const parseAR = (s) => {
      // "1.234,56" -> 1234.56
      const n = String(s || '').replace(/\./g,'').replace(',', '.');
      const v = Number(n);
      return Number.isFinite(v) ? v : NaN;
    };
    const puntNum = puntText ? parseAR(puntText) : NaN;
    const puntClass = (() => {
      if (!Number.isFinite(puntNum)) return '';
      if (puntNum <= 50) return 'puntaje-v-rojo';
      if (puntNum <= 75) return 'puntaje-v-amarillo';
      if (puntNum <= 80) return 'puntaje-v-verdeclaro';
      return 'puntaje-v-verdoscuro';
    })();
    const css = `
@page{ size: A4 landscape; margin: 12mm; }
@media print{ *{ -webkit-print-color-adjust: exact; print-color-adjust: exact; } }

:root{ --text:#0f172a; --line:#cbd5e1; --brand:#1E3A89; }
*{ box-sizing:border-box; }
body{ margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--text); }
.header{ margin:0 0 10px 0; padding:0; }
.h1{ font-size:18px; font-weight:900; margin:0 0 6px 0; }
.name{ font-size:16px; font-weight:900; margin:0 0 4px 0; }
.eval{ font-size:12px; font-weight:800; margin:0 0 10px 0; color: rgba(15,23,42,.86); }

.header{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.header-left{ min-width:0; }
.puntaje-chip{ display:inline-flex; align-items:center; gap:10px; padding:6px 10px; border-radius:999px; border:1px solid rgba(15,23,42,.10); background: rgba(30,58,137,.08); }
.puntaje-chip-label{ background:#000; color:#fff; padding:10px 14px; border-radius:999px; font-weight:900; line-height:1; white-space:nowrap; }
.puntaje-chip-value{ padding:10px 14px; border-radius:999px; font-weight:900; line-height:1; min-width:92px; text-align:center; }
.puntaje-v-rojo{ background:#d32f2f; color:#fff; }
.puntaje-v-amarillo{ background:#fbc02d; color:#000; }
.puntaje-v-verdeclaro{ background:#a5d6a7; color:#000; }
.puntaje-v-verdoscuro{ background:#1b5e20; color:#fff; }

table{ width:100%; border-collapse:collapse; font-size:12px; }
th,td{ border:1px solid var(--line); padding:8px; vertical-align:top; }
.obs{ margin-top:10px; padding-top:8px; border-top:1px dashed var(--line); font-size:12px; }
.obs-row{ margin:6px 0; }
.obs-label{ font-weight:900; color: rgba(15,23,42,.86); }

th{ background:#eef2ff; font-weight:900; }
.col-num{ width:60px; }
.col-val{ width:160px; }
.col-score{ width:90px; }

.r-sec-row td{ background: rgba(30,58,137,.08); font-weight:900; color: rgba(2,6,23,.86); }

.r-tag{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  font-weight:900;
  padding:3px 10px;
  border-radius:999px;
  border:1px solid rgba(15,23,42,.12);
  background: rgba(15,23,42,.04);
  white-space: nowrap;
}
.r-tag-bajo{ background: rgba(220,38,38,.12); border-color: rgba(220,38,38,.25); color: rgba(153,27,27,.95); }
.r-tag-normal{ background: rgba(245,158,11,.14); border-color: rgba(245,158,11,.28); color: rgba(146,64,14,.98); }
.r-tag-muy{ background: #ffe2b3; border-color: rgba(245,158,11,.38); color: rgba(146,64,14,.98); }
.r-tag-exc{ background: rgba(22,163,74,.12); border-color: rgba(22,163,74,.22); color: rgba(20,83,45,.98); }
.cp-tag{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  font-weight:900;
  padding:3px 10px;
  border-radius:999px;
  border:1px solid rgba(15,23,42,.12);
  white-space: nowrap;
}
.cp-tag-falta{ background:#dc2626; border-color:#dc2626; color:#fff; }
.cp-tag-noeval{ background:#000; border-color:#000; color:#fff; }
    `.trim();

    const html = `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${title}${safeName ? ' · ' + safeName : ''}</title>
  <style>${css}</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="h1">${title}</div>
      ${safeName ? `<div class="name">${safeName}</div>` : ''}
      ${evalLine ? `<div class="eval">${evalLine}</div>` : ''}
    </div>
    ${puntText ? `<div class="puntaje-chip"><span class="puntaje-chip-label">Puntaje ⇒</span><span class="puntaje-chip-value ${puntClass}">${puntText}</span></div>` : ''}
  </div>

  ${tableEl.outerHTML}

  ${obsHtml}
</body>
</html>
    `.trim();

    const w = window.open('', '_blank');
    if (!w){
      alert('El navegador bloqueó la impresión. Permití ventanas emergentes (popups) para este sitio.');
      return;
    }

    w.document.open();
    w.document.write(html);
    w.document.close();

    // Edge/Chrome: esperar al load del nuevo documento para asegurar estilos antes de imprimir
    w.onload = () => {
      w.focus();
      w.print();
      w.close();
    };
  });


  ['resGerencia'
,'resSucursal'].forEach(id => document.getElementById(id)?.addEventListener('change', resApplyAndRender));

  // Buscar: mostrar "x" para limpiar
  const resSearch = document.getElementById('resSearch');
  const resSearchClear = document.getElementById('resSearchClear');
  const syncSearchClear = () => {
    if (!resSearch || !resSearchClear) return;
    resSearchClear.style.display = resSearch.value ? 'flex' : 'none';
  };

  resSearch?.addEventListener('input', () => {
    syncSearchClear();
    resApplyAndRender();
  });

  resSearchClear?.addEventListener('click', () => {
    if (!resSearch) return;
    resSearch.value = '';
    syncSearchClear();
    resApplyAndRender();
    resSearch.focus();
  });

  // estado inicial
  syncSearchClear();
  document.getElementById('resAnio')?.addEventListener('change', () => {
    doReload();
  });

  // init
  setText('resAnioLabel', resAnio);
  doReload();
}







// =========================
// COMPARATIVOS
// =========================

let cmpAnio = 2026;
let cmpLegajos = []; // { id, nombre }
let cmpLegajoById = new Map();
let cmpEvalCabsByEvaluado = new Map(); // evaluado_id -> [{ eval_id, evaluador_id, updated_at, created_at }]
let cmpEvalDbItemIds = []; // item_id[] ordenado
let cmpPairs = []; // [{ value, label }]
let cmpFlagsMap = new Map(); // legajo_id -> { des:boolean, cp:boolean }
let cmpCpCabByEvaluado = new Map(); // evaluado_id -> { eval_id, estado }
let cmpCpDbItemIds = []; // item_id[] ordenado (C.P.)
let cmpCpMaxByIdx = []; // puntaje_indiv[] por orden (C.P.)

function cmpSetState(msg){
  setText('cmpState', msg);
}

function cmpFlattenUi(rubrica){
  const out = [];
  try{
    (rubrica || []).forEach(sec => {
      (sec.items || []).forEach(it => {
        out.push({ code: it.id, label: it.label, sec: sec.title });
      });
    });
  }catch(_){ /* noop */ }
  return out;
}

function cmpCleanName(s){
  return String(s || '').replace(/\s+/g, ' ').trim();
}

async function cmpLoadLegajos(supa){
  const { data, error } = await supa
    .from(T_LEGAJOS)
    .select('"ID","Nombre Completo","Baja"')
    .eq('Baja', 'Activo')
    .limit(5000);
  if (error) throw error;

  const raw = Array.isArray(data) ? data : [];
  cmpLegajos = raw.map(r => ({
    id: r['ID'],
    nombre: cmpCleanName(r['Nombre Completo'] || '—'),
  }));
  cmpLegajoById = new Map(cmpLegajos.map(x => [String(x.id), x]));
}

async function cmpLoadAllEvalCabs(supa){
  const { data, error } = await supa
    .from(T_EVAL_CAB)
    .select('eval_id,evaluado_id,evaluador_id,estado,updated_at,created_at')
    .eq('anio', cmpAnio)
    .limit(20000);
  if (error) throw error;

  const byEvaluado = new Map();
  (data || []).forEach(r => {
    const evaluadoId = String(r?.evaluado_id || '');
    const evalId = String(r?.eval_id || '');
    if (!evaluadoId || !evalId) return;
    if (resEstadoUiFromDb(r?.estado).ui !== 'Completa') return;

    const cab = {
      eval_id: r.eval_id,
      evaluado_id: r.evaluado_id,
      evaluador_id: r.evaluador_id,
      estado: r.estado,
      updated_at: r.updated_at,
      created_at: r.created_at,
    };

    const arr = byEvaluado.get(evaluadoId) || [];
    arr.push(cab);
    byEvaluado.set(evaluadoId, arr);
  });

  // Orden: más nueva primero
  byEvaluado.forEach(arr => {
    arr.sort((a,b) => {
      const ta = a?.updated_at || a?.created_at || 0;
      const tb = b?.updated_at || b?.created_at || 0;
      return (new Date(tb).getTime() || 0) - (new Date(ta).getTime() || 0);
    });
  });

  cmpEvalCabsByEvaluado = byEvaluado;
}

async function cmpLoadFlags(supa){
  const { data, error } = await supa
    .from(T_FLAGS)
    .select('legajo_id,es_evaluable_desempeno,es_evaluable_cp')
    .limit(10000);
  if (error) throw error;

  const m = new Map();
  (data || []).forEach(f => {
    const id = String(f?.legajo_id || '').trim();
    if (!id) return;
    const des = (typeof f.es_evaluable_desempeno === 'boolean') ? f.es_evaluable_desempeno : true;
    const cp  = (typeof f.es_evaluable_cp === 'boolean') ? f.es_evaluable_cp : true;
    m.set(id, { des: !!des, cp: !!cp });
  });
  cmpFlagsMap = m;
}

async function cmpLoadCpCabMap(supa){
  const { data, error } = await supa
    .from(T_CP_CAB)
    .select('eval_id,evaluado_id,estado')
    .eq('anio', cmpAnio)
    .limit(20000);
  if (error) throw error;

  const m = new Map();
  (data || []).forEach(r => {
    const eid = String(r?.evaluado_id || '').trim();
    const cpEvalId = String(r?.eval_id || '').trim();
    if (!eid || !cpEvalId) return;
    m.set(eid, { eval_id: cpEvalId, estado: r?.estado || '' });
  });
  cmpCpCabByEvaluado = m;
}

async function cmpLoadCpDbMeta(supa){
  try{
    const { data, error } = await supa
      .from(T_CP_ITEMS)
      .select('item_id,puntaje_indiv')
      .eq('activo', true)
      .order('item_id', { ascending: true })
      .limit(5000);
    if (error) throw error;

    cmpCpDbItemIds = (data || []).map(r => r.item_id);
    cmpCpMaxByIdx = (data || []).map(r => {
      const p = (typeof r.puntaje_indiv === 'number') ? r.puntaje_indiv : Number(r.puntaje_indiv);
      return Number.isFinite(p) ? p : 0;
    });
  }catch(e){
    console.error('cmpLoadCpDbMeta', e);
    cmpCpDbItemIds = [];
    cmpCpMaxByIdx = [];
  }
}

async function cmpLoadDbItemIds(supa){
  try{
    const { data, error } = await supa
      .from(T_EVAL_ITEMS)
      .select('item_id')
      .eq('activo', true)
      .order('item_id', { ascending: true })
      .limit(5000);
    if (error) throw error;
    return (data || []).map(r => r.item_id);
  }catch(e){
    console.error(e);
    return [];
  }
}

async function cmpBatchLoadAnswers(supa, evalIds, { table } = { table: 'rrhh_eval_respuestas_calc' }){
  // return: eval_id -> { val: Map(item_id->valor), punt: Map(item_id->puntaje) }
  const out = new Map();
  const ids = Array.from(new Set((evalIds || []).map(x => String(x||'').trim()).filter(Boolean)));
  if (!ids.length) return out;

  const CHUNK = 200;
  for (let i=0; i<ids.length; i+=CHUNK){
    const chunk = ids.slice(i, i+CHUNK);
    try{
      const { data, error } = await supa
        .from(table)
        .select('eval_id,item_id,valor,puntaje')
        .in('eval_id', chunk)
        .limit(200000);
      if (error) throw error;

      (data || []).forEach(r => {
        const eid = String(r?.eval_id || '').trim();
        if (!eid) return;
        const cur = out.get(eid) || { val: new Map(), punt: new Map() };
        if (r && r.item_id !== null && r.item_id !== undefined){
          cur.val.set(r.item_id, resNormalizeValor(r.valor));
          const p = (typeof r.puntaje === 'number') ? r.puntaje : (r.puntaje != null ? Number(r.puntaje) : null);
          if (p !== null && p !== undefined && Number.isFinite(p)) cur.punt.set(r.item_id, p);
        }
        out.set(eid, cur);
      });
    }catch(e){
      console.error('cmpBatchLoadAnswers', table, e);
    }
  }

  return out;
}

function cmpBuildPairs(){
  // Solo evaluados que tienen al menos 1 evaluación completa del año
  const ids = new Set(Array.from(cmpEvalCabsByEvaluado.keys()).map(String));
  const legs = cmpLegajos.filter(l => ids.has(String(l.id)));
  legs.sort((a,b) => normalizeText(a.nombre).localeCompare(normalizeText(b.nombre), 'es'));
  cmpPairs = legs.map(l => ({ value: String(l.id), label: l.nombre }));
}

function cmpFillAllSelects(){
  const s1 = document.getElementById('cmpEval1');
  fillSelectPairs(s1, cmpPairs, { includeAllLabel: 'Seleccionar...' });

  // 2do selector (por ahora no afecta el render, solo replica el listado)
  const s2 = document.getElementById('cmpEval2');
  if (s2) fillSelectPairs(s2, cmpPairs, { includeAllLabel: 'Seleccionar...' });
}

function cmpWireSearch({ selectId, inputId, clearId }){
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  const clr = document.getElementById(clearId);
  if (!sel || !inp || !clr) return;

  const syncClear = () => {
    clr.style.display = inp.value ? 'flex' : 'none';
  };

  function applyFilter(){
    const q = normalizeText(inp.value || '');
    const current = String(sel.value || '');

    const filtered = !q ? cmpPairs : cmpPairs.filter(p => normalizeText(p.label).includes(q));

    // reconstruir sin perder selección si sigue estando
    const keep = filtered.some(p => String(p.value) === current);
    const includeAllLabel = sel.id === 'cmpEval1' ? 'Seleccionar...' : '(Vacío)';
    fillSelectPairs(sel, filtered, { includeAllLabel });
    if (keep) sel.value = current;

    syncClear();
  }

  inp.addEventListener('input', applyFilter);
  clr.addEventListener('click', () => {
    inp.value = '';
    applyFilter();
    inp.focus();
  });

  // init
  syncClear();
}

function cmpRenderEmpty(){
  const thead = document.getElementById('cmpThead');
  const tbody = document.getElementById('cmpTbody');
  if (thead) thead.innerHTML = '';
  if (tbody) tbody.innerHTML = '';
}

function cmpPrintCurrent(){
  // Imprimir SOLO el comparativo (tabla) para evitar espacios en blanco por layout/sticky.
  const tableEl = document.querySelector('table.cmp-table');
  if (!tableEl || !tableEl.tBodies || !tableEl.tBodies[0] || !tableEl.tBodies[0].rows.length){
    alert('No hay comparativo para imprimir. Elegí un evaluado primero.');
    return;
  }

  const sel1 = document.getElementById('cmpEval1');
  const name = sel1 ? (sel1.options[sel1.selectedIndex]?.textContent || '').trim() : '';

  const anio = String(document.getElementById('cmpAnio')?.value || cmpAnio || '').trim();

  // Clonar para sacar attrs/handlers y asegurar que el html quede “plano”.
  const clone = tableEl.cloneNode(true);
  clone.classList.remove('cmp-one');

  const css = `
    :root{ color-scheme: light; }
    @page{ size: landscape; margin: 10mm; }
    body{ font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; padding: 14px; color:#0f172a; }
    h1{ font-size: 16px; margin: 0 0 6px; }
    .sub{ color:#475569; margin: 0 0 14px; }
    table{ width:100%; border-collapse: collapse; table-layout: fixed; }
    th,td{ border:1px solid #e2e8f0; padding:6px 8px; text-align:left; vertical-align: top; font-size: 11px; line-height: 1.25; }
    th{ background:#eef2ff; font-weight: 800; }
    /* Ajuste de anchos para que entre en landscape */
    th:nth-child(1), td:nth-child(1){ width: 6%; text-align:center; }
    th:nth-child(2), td:nth-child(2){ width: 28%; }
    /* Quitar sticky en impresión */
    thead th{ position: static !important; top:auto !important; }
    /* Colores de puntaje (igual criterio que la UI) */
    .puntaje-v-rojo{ color:#991b1b; font-weight: 900; }
    .puntaje-v-amarillo{ color:#92400e; font-weight: 900; }
    .puntaje-v-verdeclaro{ color:#14532d; font-weight: 900; }
    .puntaje-v-verdoscuro{ color:#14532d; font-weight: 900; }
    /* Tags (Eval y C.P.) */
    .r-tag,.cp-tag{ display:inline-flex; align-items:center; justify-content:center; font-weight:900; padding:4px 10px; border-radius:999px; border:1px solid rgba(15,23,42,.12); white-space:nowrap; }
    .r-tag-bajo{ background: rgba(220,38,38,.12); border-color: rgba(220,38,38,.25); color: rgba(153,27,27,.95); }
    .r-tag-normal{ background: rgba(245,158,11,.14); border-color: rgba(245,158,11,.28); color: rgba(146,64,14,.98); }
    .r-tag-muy{ background: #ffe2b3; border-color: rgba(245,158,11,.38); color: rgba(146,64,14,.98); }
    .r-tag-exc{ background: rgba(22,163,74,.12); border-color: rgba(22,163,74,.22); color: rgba(20,83,45,.98); }
    .cp-tag-falta{ background:#dc2626; border-color:#dc2626; color:#fff; }
    .cp-tag-noeval{ background:#000; border-color:#000; color:#fff; }
    @media print{ body{ padding: 0; } }
  `.trim();

  const title = 'Comparativos';
  // En impresión: dejar SOLO el año (el resto ya se ve en la tabla)
  const sub = `${anio ? ('Año: ' + anio) : ''}`.trim();

  const html = `<!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}${name ? ' · ' + name.replace(/[<>]/g,'') : ''}</title>
    <style>${css}</style>
  </head>
  <body>
    <h1>${title}</h1>
    ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}
    ${clone.outerHTML}
  </body>
  </html>`;

  const w = window.open('', '_blank');
  if (!w){
    alert('El navegador bloqueó la impresión. Permití ventanas emergentes (popups) para este sitio.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => {
    try{
      w.focus();
      w.print();
      w.close();
    }catch(_){
      // no romper la app
    }
  };
}

function cmpFmtAR(num){
  try{
    return Number(num).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }catch(_){
    return String(num);
  }
}

function cmpPuntajeClass(total){
  const t = typeof total === 'number' ? total : Number(total);
  if (!Number.isFinite(t)) return '';
  if (t <= 50) return 'puntaje-v-rojo';
  if (t <= 75) return 'puntaje-v-amarillo';
  if (t <= 80) return 'puntaje-v-verdeclaro';
  return 'puntaje-v-verdoscuro';
}

function cmpShortName(full){
  const s = cmpCleanName(full);
  if (!s) return '';
  if (s.includes(',')){
    const [ap, rest] = s.split(',', 2);
    const first = cmpCleanName(rest).split(/\s+/)[0] || '';
    return cmpCleanName(`${ap}, ${first}`);
  }
  // fallback: primer token + segundo token
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return cmpCleanName(`${parts[0]} ${parts[1]}`);
  return s;
}

function cmpIsCpEligible(legajoId){
  const f = cmpFlagsMap.get(String(legajoId));
  return f ? (f.cp !== false) : true;
}

// Ajusta offsets para sticky internos de Comparativos:
// - --cmp-head-h: altura real del bloque superior (filtros)
// - --cmp-picked-h: altura del rótulo azul (solo si está visible)
function cmpUpdateStickyVars(){
  const body = document.body;
  if (!body || body.dataset.page !== 'comparativos') return;

  const root = document.documentElement;
  const head = document.querySelector('.cmp-head');
  const pickedRow = document.querySelector('.cmp-picked-out-row');
  const badge1 = document.getElementById('cmpPickedName');
  const badge2 = document.getElementById('cmpPickedName2');

  // Altura del bloque superior (filtros)
  const headH = head ? head.getBoundingClientRect().height : 0;
  root.style.setProperty('--cmp-head-h', `${Math.max(0, Math.ceil(headH))}px`);

  // Altura del rótulo superior (si se usa)
  let pickedH = 0;
  const anyBadgeVisible = [badge1, badge2].some(b => !!(b && b.style.display !== 'none' && String(b.textContent || '').trim()));
  const pickedVisible = !!(pickedRow && getComputedStyle(pickedRow).display !== 'none');
  if (anyBadgeVisible && pickedVisible){
    pickedH = pickedRow.getBoundingClientRect().height;
  }
  root.style.setProperty('--cmp-picked-h', `${Math.max(0, Math.ceil(pickedH))}px`);

  // Apilar sticky de 2 filas del thead sin solaparse
  let thead1H = 0;
  const thead = document.getElementById('cmpThead');
  const tr1 = thead ? thead.querySelector('tr') : null;
  if (tr1){
    thead1H = tr1.getBoundingClientRect().height || 0;
  }
  root.style.setProperty('--cmp-thead1-h', `${Math.max(0, Math.ceil(thead1H))}px`);
}

function cmpSyncPickedName(){
  // Se eliminaron las "pills" superiores: mantener siempre ocultas
  const b1 = document.getElementById('cmpPickedName');
  const b2 = document.getElementById('cmpPickedName2');
  if (b1){ b1.textContent = ''; b1.style.display = 'none'; }
  if (b2){ b2.textContent = ''; b2.style.display = 'none'; }

  // Ocultar la fila (evita que deje una franja blanca sticky encima del thead)
  const row = document.querySelector('.cmp-picked-out-row');
  if (row) row.classList.remove('is-visible');

  cmpUpdateStickyVars();
}

// En tablas con table-layout: fixed, el navegador calcula los anchos usando
// <colgroup> (si existe) o la PRIMER fila. En Comparativos, la primera fila
// tiene colspans (cmp-group), por lo que los anchos definidos en la segunda
// fila (th.col-cmp / td.col-cmp) pueden NO impactar.
// Este helper fuerza anchos reales vía <colgroup> sin tocar el layout.
function cmpEnsureColgroup(tableEl, { colIdPx = 60, colCmpPx = 90, slotsPerEvaluado = 3 } = {}){
  if (!tableEl) return;
  let cg = tableEl.querySelector('colgroup');
  if (!cg){
    cg = document.createElement('colgroup');
    tableEl.prepend(cg);
  }

  const cols = [];
  // # (código item)
  cols.push(`<col style="width:${Number(colIdPx) || 60}px">`);
  // Item (flexible: toma el espacio restante)
  cols.push('<col>');
  // 3 cols por evaluado x 2 evaluados (siempre renderizamos 2 grupos)
  const n = (Number(slotsPerEvaluado) || 3) * 2;
  for (let i = 0; i < n; i++){
    cols.push(`<col style="width:${Number(colCmpPx) || 90}px">`);
  }

  cg.innerHTML = cols.join('');
}

function cmpGetColWidths(){
  // Permite controlar anchos desde CSS sin tocar el JS.
  // Valores esperados: --cmp-col-id / --cmp-col-cmp (en px).
  try{
    const cs = getComputedStyle(document.body || document.documentElement);
    const idW = parseInt(cs.getPropertyValue('--cmp-col-id'), 10);
    const cmpW = parseInt(cs.getPropertyValue('--cmp-col-cmp'), 10);
    return {
      colIdPx: Number.isFinite(idW) && idW > 0 ? idW : 60,
      colCmpPx: Number.isFinite(cmpW) && cmpW > 0 ? cmpW : 90,
    };
  }catch(_){
    return { colIdPx: 60, colCmpPx: 90 };
  }
}

async function cmpRender(){
  const msg = document.getElementById('cmpMsg');
  const s1 = document.getElementById('cmpEval1');
  const s2 = document.getElementById('cmpEval2');

  const evaluado1 = String(s1?.value || '').trim();
  const evaluado2 = String(s2?.value || '').trim();

  // reflejar selección en el header (badges)
  cmpSyncPickedName();

  const thead = document.getElementById('cmpThead');
  const tbody = document.getElementById('cmpTbody');
  const tableEl = document.querySelector('table.cmp-table');

  if (!evaluado1){
    if (msg) msg.textContent = 'Seleccioná un evaluado para ver el comparativo.';
    cmpRenderEmpty();
    if (tableEl) tableEl.classList.remove('has-eval2');
    return;
  }

  const { colIdPx, colCmpPx } = cmpGetColWidths();

  const supa = createClient();
  cmpSetState('Cargando...');

  const nameById = (id) => (cmpLegajoById.get(String(id)) || {}).nombre || '';

  const fullSections = [...R_RUBRICA, ...CP_RUBRICA];
  const evalUiFlat = cmpFlattenUi(R_RUBRICA);
  const cpUiFlat = cmpFlattenUi(CP_RUBRICA);

  const evalUiFlatOnly = evalUiFlat; // alias por claridad
  const cpUiFlatOnly = cpUiFlat;

  const evalIdxByCode = new Map(evalUiFlatOnly.map((x,i)=>[x.code,i]));
  const cpIdxByCode = new Map(cpUiFlatOnly.map((x,i)=>[x.code,i]));

  const SLOTS_PER_EVALUADO = 3;

  // Forzar anchos reales de columnas (evita que los colspans del header
  // hagan que el navegador distribuya el ancho “parejo” ignorando .col-cmp).
  cmpEnsureColgroup(tableEl, { colIdPx, colCmpPx, slotsPerEvaluado: SLOTS_PER_EVALUADO });

  // Siempre devolvemos 3 "slots" por evaluado (aunque falten evaluaciones),
  // para que el layout del body quede fijo: 3 cols Evaluado 1 + 3 cols Evaluado 2.
  const buildColsSlots = (evaluadoId) => {
    const id = String(evaluadoId || '').trim();
    if (!id){
      return Array.from({ length: SLOTS_PER_EVALUADO }, () => ({
        evaluadoId: '',
        evalId: '',
        evaluadorId: '',
        cab: null,
        placeholder: true,
      }));
    }

    const cabs = (cmpEvalCabsByEvaluado.get(id) || []).slice(0, SLOTS_PER_EVALUADO);
    return Array.from({ length: SLOTS_PER_EVALUADO }, (_, idx) => {
      const cab = cabs[idx] || null;
      const evalId = cab ? String(cab.eval_id || '').trim() : '';
      const evaluadorId = cab ? String(cab.evaluador_id || '').trim() : '';
      return {
        evaluadoId: id,
        evalId,
        evaluadorId,
        cab,
        placeholder: !evalId,
      };
    });
  };

  const cols1 = buildColsSlots(evaluado1);
  const cols2 = buildColsSlots(evaluado2);
  const allCols = [...cols1, ...cols2];
  const colCount = 2 + allCols.length;

  // Ids de evaluaciones reales (sin placeholders)
  const allEvalIds = allCols.map(c => c.evalId).filter(Boolean);

  // C.P. (1 por evaluado/año)
  const buildCpData = (evaluadoId) => {
    const id = String(evaluadoId || '').trim();
    if (!id) return null;
    const cpCab = cmpCpCabByEvaluado.get(id) || null;
    const cpEvalId = cpCab ? String(cpCab.eval_id || '').trim() : '';
    const eligible = cmpIsCpEligible(id);
    return { evaluadoId: id, eligible, cpEvalId, ans: { val: new Map(), punt: new Map() } };
  };

  const cpDataList = [buildCpData(evaluado1), buildCpData(evaluado2)].filter(Boolean);
  const cpByEvaluado = new Map(cpDataList.map(x => [String(x.evaluadoId), x]));
  const cpEvalIds = cpDataList.filter(x => x.eligible && x.cpEvalId).map(x => x.cpEvalId);

  // Cargar respuestas (Eval + CP)
  const evalAns = await cmpBatchLoadAnswers(supa, allEvalIds, { table: 'rrhh_eval_respuestas_calc' });
  const cpAnsMap = cpEvalIds.length
    ? await cmpBatchLoadAnswers(supa, cpEvalIds, { table: 'rrhh_cp_respuestas_calc' })
    : new Map();

  cpDataList.forEach(x => {
    if (x.eligible && x.cpEvalId){
      x.ans = cpAnsMap.get(x.cpEvalId) || { val: new Map(), punt: new Map() };
    }
  });

  function getEvalValor(evalId, uiIdx){
    if (!evalId) return '';
    const dbId = cmpEvalDbItemIds[uiIdx];
    if (dbId === undefined) return '';
    const cur = evalAns.get(String(evalId));
    return cur?.val?.get(dbId) || '';
  }
  function getEvalPunt(evalId, uiIdx){
    if (!evalId) return 0;
    const dbId = cmpEvalDbItemIds[uiIdx];
    if (dbId === undefined) return 0;
    const cur = evalAns.get(String(evalId));
    const p = cur?.punt?.get(dbId);
    return Number.isFinite(p) ? p : 0;
  }

  function getCpValor(evaluadoId, cpUiIdx){
    const d = cpByEvaluado.get(String(evaluadoId));
    if (!d || !d.eligible) return '';
    const dbId = cmpCpDbItemIds[cpUiIdx];
    if (dbId === undefined) return '';
    return d.ans.val.get(dbId) || '';
  }
  function getCpPunt(evaluadoId, cpUiIdx){
    const d = cpByEvaluado.get(String(evaluadoId));
    if (!d || !d.eligible) return 0;
    const dbId = cmpCpDbItemIds[cpUiIdx];
    if (dbId === undefined) return 0;
    const p = d.ans.punt.get(dbId);
    return Number.isFinite(p) ? p : 0;
  }

  // total por columna (Eval + CP)
  function totalForColumn(col){
    if (!col || !col.evalId) return null;

    let total = 0;
    for (let i=0; i<evalUiFlatOnly.length; i++) total += getEvalPunt(col.evalId, i);

    const cpData = cpByEvaluado.get(String(col.evaluadoId));
    if (!cpData || cpData.eligible === false){
      // no evalúa C.P.: suma máximo
      for (let i=0; i<cpUiFlatOnly.length; i++) total += (cmpCpMaxByIdx[i] || 0);
    } else {
      for (let i=0; i<cpUiFlatOnly.length; i++) total += getCpPunt(col.evaluadoId, i);
    }
    return total;
  }

  // header (siempre: 3 cols Eval 1 + 3 cols Eval 2, aunque estén vacías)
  // IMPORTANTE: el nombre en el header debe coincidir EXACTO con lo que se ve en el selector.
  const getSelLabel = (selectId, fallbackEvaluadoId) => {
    const sel = document.getElementById(selectId);
    const opt = sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0] : null;
    const label = opt ? cmpCleanName(opt.textContent || '') : '';
    // ignorar placeholders
    if (label && label !== 'Seleccionar...' && label !== '(Vacío)') return label;
    const full = nameById(fallbackEvaluadoId);
    return cmpCleanName(full) || full || '';
  };
  const safeGroup = (label) => {
    const t = String(label || '').trim();
    return t ? escapeHtml(t) : '&nbsp;';
  };

  const buildColHead = (col) => {
    if (!col || !col.evalId){
      return `<th class="col-cmp cmp-subhead"><span class="muted">&nbsp;</span></th>`;
    }
    const evName = cmpShortName(nameById(col.evaluadorId));
    const total = totalForColumn(col);
    const cls = cmpPuntajeClass(total);
    const val = (typeof total === 'number') ? cmpFmtAR(total) : '';
    return `<th class="col-cmp cmp-subhead">
      <div class="cmp-evhead">
        <div class="cmp-ev-name">${escapeHtml(evName || '')}</div>
        <div class="cmp-ev-score ${cls}">
          <span class="val">${escapeHtml(val)}</span>
        </div>
      </div>
    </th>`;
  };

  if (tableEl){
    if (evaluado2) tableEl.classList.add('has-eval2');
    else tableEl.classList.remove('has-eval2');
  }

  if (thead){
    thead.innerHTML = `
      <tr>
        <th class="col-id" rowspan="2">#</th>
        <th class="col-item" rowspan="2">Item</th>
        <th class="cmp-group cmp-group-e1" colspan="${SLOTS_PER_EVALUADO}">${safeGroup(getSelLabel('cmpEval1', evaluado1))}</th>
        <th class="cmp-group cmp-group-e2" colspan="${SLOTS_PER_EVALUADO}">${safeGroup(getSelLabel('cmpEval2', evaluado2))}</th>
      </tr>
      <tr>
        ${cols1.map(buildColHead).join('')}
        ${cols2.map(buildColHead).join('')}
      </tr>
    `;

    cmpUpdateStickyVars();
    requestAnimationFrame(cmpUpdateStickyVars);
  }

  // celdas valoración
  const buildValTag = (v) => {
    const vv = String(v || '').trim();
    if (!vv) return '';
    return `<span class="${resValorTagClass(vv)}">${escapeHtml(vv)}</span>`;
  };

  const buildCpTag = (v) => {
    const vv = String(v || '').trim();
    if (!vv) return '';
    return `<span class="${resValorTagClass(vv)}">${escapeHtml(vv)}</span>`;
  };

  const rowsHtml = [];
  fullSections.forEach(sec => {
    const isCpSec = normalizeText(sec.title || '').includes('compromiso') && normalizeText(sec.title || '').includes('presentismo');
    rowsHtml.push(`<tr class="r-sec-row"><td colspan="${colCount}">${escapeHtml(sec.title)}</td></tr>`);

    (sec.items || []).forEach(it => {
      const code = it.id;
      const evalIdx = evalIdxByCode.get(code);
      const cpIdx = cpIdxByCode.get(code);

      const cells = allCols.map(col => {
        // columnas placeholder (sin evaluación real): vacías siempre
        if (!col || !col.evalId) return '';

        if (!isCpSec){
          const v = (typeof evalIdx === 'number') ? getEvalValor(col.evalId, evalIdx) : '';
          return buildValTag(v);
        }

        // C.P. (solo si hay evaluación real en esa columna)
        const cpData = cpByEvaluado.get(String(col.evaluadoId));
        if (!cpData || cpData.eligible === false){
          return `<span class="cp-tag cp-tag-noeval">No se Evalua</span>`;
        }

        const v = (typeof cpIdx === 'number') ? getCpValor(col.evaluadoId, cpIdx) : '';
        const vv = String(v || '').trim();
        if (!vv || vv.toLowerCase() === 'falta'){
          return `<span class="cp-tag cp-tag-falta">Falta</span>`;
        }
        return buildCpTag(v);
      });

      rowsHtml.push(`
        <tr>
          <td class="col-id">${escapeHtml(code)}</td>
          <td class="col-item">${escapeHtml(it.label)}</td>
          ${cells.map(c => `<td class="col-cmp">${c}</td>`).join('')}
        </tr>
      `);
    });
  });

  if (tbody) tbody.innerHTML = rowsHtml.join('');
  if (msg) msg.textContent = '';
  cmpSetState('OK');
}

async function initComparativos(){

  const supa = createClient();

  // Recalcular offsets sticky si cambia el layout (responsive)
  window.addEventListener('resize', cmpUpdateStickyVars, { passive: true });

  // defaults
  cmpAnio = Number(document.getElementById('cmpAnio')?.value || 2026) || 2026;
  setText('cmpAnioLabel', cmpAnio);
  cmpSetState('Cargando...');

  // Wire (una sola vez)
  cmpWireSearch({ selectId: 'cmpEval1', inputId: 'cmpEval1Search', clearId: 'cmpEval1Clear' });
  cmpWireSearch({ selectId: 'cmpEval2', inputId: 'cmpEval2Search', clearId: 'cmpEval2Clear' });
  cmpWireSearch({ selectId: 'cmpEval3', inputId: 'cmpEval3Search', clearId: 'cmpEval3Clear' });

  ['cmpEval1','cmpEval2','cmpEval3'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    // En Comparativos: cuando hay selección, remarcar el selector y colorear (Eval 1 / Eval 2)
    const applySelClass = () => {
      const v = String(el.value || '').trim();
      const has = !!v;
      el.classList.toggle('has-selection', has);

      const wrap = el.closest('.filter');
      if (wrap){
        if (el.id === 'cmpEval1') wrap.classList.toggle('cmp-sel-e1', has);
        if (el.id === 'cmpEval2') wrap.classList.toggle('cmp-sel-e2', has);
      }
      if (el.id === 'cmpEval1') el.classList.toggle('cmp-sel-e1', has);
      if (el.id === 'cmpEval2') el.classList.toggle('cmp-sel-e2', has);

      // Recalcular offsets sticky
      cmpUpdateStickyVars();
    };

    // exponer para poder re-aplicar luego de recargar y restaurar valores
    try{ el._cmpApplySelClass = applySelClass; }catch(_){}

    applySelClass();

    el.addEventListener('change', () => {
      applySelClass();
      cmpRender();
    });
  });

  async function doReload(){
    try{
      cmpAnio = Number(document.getElementById('cmpAnio')?.value || cmpAnio) || cmpAnio;
      setText('cmpAnioLabel', cmpAnio);

      await cmpLoadLegajos(supa);
      await cmpLoadFlags(supa);
      await cmpLoadAllEvalCabs(supa);
      await cmpLoadCpCabMap(supa);
      await cmpLoadCpDbMeta(supa);
      cmpEvalDbItemIds = await cmpLoadDbItemIds(supa);

      cmpBuildPairs();

      // preservar selección
      const prev1 = String(document.getElementById('cmpEval1')?.value || '').trim();
      const prev2 = String(document.getElementById('cmpEval2')?.value || '').trim();
      const prev3 = String(document.getElementById('cmpEval3')?.value || '').trim();

      cmpFillAllSelects();

      const hasId = (id) => cmpPairs.some(p => String(p.value) === String(id));
      if (prev1 && hasId(prev1)) document.getElementById('cmpEval1').value = prev1;
      if (prev2 && hasId(prev2)) document.getElementById('cmpEval2').value = prev2;
      if (prev3 && hasId(prev3)) document.getElementById('cmpEval3').value = prev3;

      // Re-aplicar estilos de selección (clases + colores)
      ['cmpEval1','cmpEval2','cmpEval3'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        try{
          if (typeof el._cmpApplySelClass === 'function') el._cmpApplySelClass();
        }catch(_){}
      });

      cmpSyncPickedName();

      cmpSetState('OK');
      await cmpRender();
    }catch(err){
      console.error(err);
      cmpSetState('Error');
      const msg = document.getElementById('cmpMsg');
      if (msg) msg.textContent = `Error al cargar: ${fmtErr(err)}`;
      cmpRenderEmpty();
    }
  }

  document.getElementById('cmpAnio')?.addEventListener('change', () => doReload());

  // Imprimir / Descargar PDF (Comparativos)
  document.getElementById('cmpPrint')?.addEventListener('click', () => {
    cmpPrintCurrent();
  });

  // Init
  await doReload();
}
// =========================
// DASHBOARD
// =========================

let dAnio = 2026;
let dAll = []; // { id, nombre, sucursal, gerencia, sector, eval_id, eval_ui, cp_ui, completo, eval_updated, cp_updated }
let dPuntajeByEvaluado = new Map(); // evaluado_id -> total puntaje (Eval + C&P)

// Dashboard: gráfico por ítem (Resultados)
let dEvalItemsMeta = []; // [{ item_id, label }]
let dEvalAnswersByEvalId = new Map(); // eval_id -> [{item_id, valor}]
let dItemsChart = null; // Chart.js instance

// Dashboard: gráfico por ítem (C.P.)
let dCpItemsMeta = []; // [{ item_id, label }]
let dCpAnswersByEvalId = new Map(); // cp_eval_id -> [{item_id, valor}]
let dCpItemsChart = null; // Chart.js instance

let dLowEvalChart = null; // Chart.js instance (alertas Bajo Normal - Evaluaciones)
let dLowCpChart = null;   // Chart.js instance (alertas Bajo Normal - C.P.)


// Dashboard: datos base para recalcular tarjetas con filtros
let dLegajosAll = [];       // [{id,nombre,sucursal,gerencia,sector}]
let dAllSucursales = [];    // lista de sucursales para tabla (mostrar aunque no haya datos)
let dActiveSetAll = new Set(); // Set(legajo_id) activos
let dFlagsMap = new Map();  // legajo_id -> {des:boolean, cp:boolean}
let dAsigRowsAll = [];      // asignaciones activas del año (raw)
let dNoAsigDetail = [];     // [{nombre, gerencia}] detalle de empleados sin asignación (según filtros)
let dOkDetail = [];           // [{nombre, gerencia}] empleados con evaluación completa (según filtros)
let dCabByPairAll = new Map(); // key evaluador__evaluado -> cab row (eval)
let dCpCabByEvaluadoAll = new Map(); // key evaluado_id -> cab row (cp)


function dFmtPctInt(pct){
  const n = Number(pct);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n)}%`;
}

function dFmtAR(num){
  try{
    return Number(num).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }catch(_){
    return String(num);
  }
}

function dPuntajeClass(total){
  const t = typeof total === 'number' ? total : Number(total);
  if (!Number.isFinite(t)) return '';
  if (t <= 50) return 'puntaje-v-rojo';
  if (t <= 75) return 'puntaje-v-amarillo';
  if (t <= 80) return 'puntaje-v-verdeclaro';
  return 'puntaje-v-verdoscuro';
}



function dPuntajePillStyle(total){
  const t = typeof total === 'number' ? total : Number(total);
  if (!Number.isFinite(t)) return 'display:inline-block;min-width:90px;padding:6px 10px;border-radius:999px;font-weight:900;text-align:right;background:#e5e7eb;color:#111827;';
  // mismos rangos que Resultados
  if (t <= 50)   return 'display:inline-block;min-width:90px;padding:6px 10px;border-radius:999px;font-weight:900;text-align:right;background:#dc2626;color:#ffffff;';
  if (t <= 75)   return 'display:inline-block;min-width:90px;padding:6px 10px;border-radius:999px;font-weight:900;text-align:right;background:#facc15;color:#111827;';
  if (t <= 80)   return 'display:inline-block;min-width:90px;padding:6px 10px;border-radius:999px;font-weight:900;text-align:right;background:#86efac;color:#111827;';
  return          'display:inline-block;min-width:90px;padding:6px 10px;border-radius:999px;font-weight:900;text-align:right;background:#166534;color:#ffffff;';
}

function dIsElegEval(id){
  const f = dFlagsMap.get(String(id));
  return f ? (f.des !== false) : true;
}
function dIsElegCp(id){
  const f = dFlagsMap.get(String(id));
  return f ? (f.cp !== false) : true;
}

/**
 * Recalcula las tarjetas grandes (Activos/Elegibles/Asignaciones/Evaluaciones/Completas/Pendientes)
 * usando los filtros actuales (Gerencia/Sucursal/Estado).
 * Nota: el filtro Estado se aplica SOLO a la sección "Evaluaciones" (completas/pendientes).
 */
function dUpdateMetricCards({ fGer = '', fSuc = '', fEst = '' } = {}){
  // Universo de personas para tarjetas: legajos activos filtrados por gerencia/sucursal
  let scopeLegs = dLegajosAll;
  if (fGer) scopeLegs = scopeLegs.filter(l => (l.gerencia || '') === fGer);
  if (fSuc) scopeLegs = scopeLegs.filter(l => (l.sucursal || '') === fSuc);

  const scopeIds = new Set(scopeLegs.map(l => String(l.id)).filter(Boolean));
  const activos = scopeLegs.length;

  const scopeIdArr = Array.from(scopeIds);
  const elegEvalCount = scopeIdArr.filter(id => dIsElegEval(id)).length;
  const elegCpCount   = scopeIdArr.filter(id => dIsElegCp(id)).length;

  // Asignaciones: filtrar por evaluado dentro del universo (para que el dashboard represente esa población)
  const asigsScope = (dAsigRowsAll || []).filter(a => {
    const evaId = String(a.evaluado_id || '').trim();
    if (!evaId) return false;
    if (!scopeIds.has(evaId)) return false;
    // mismo criterio que listado: evaluado activo + elegible desempeño
    if (!dActiveSetAll.has(evaId)) return false;
    if (!dIsElegEval(evaId)) return false;
    return true;
  });

  const asigCount = asigsScope.length;
  const empleadosAEvaluar = new Set(asigsScope.map(a => String(a.evaluado_id || '').trim()).filter(Boolean));

  const sinAsig = Math.max(0, elegEvalCount - empleadosAEvaluar.size);

  
  // Detalle: empleados elegibles (desempeño) dentro del scope que NO tienen asignación
  dNoAsigDetail = (scopeLegs || [])
    .filter(l => {
      const id = String(l?.id || '').trim();
      if (!id) return false;
      if (!dIsElegEval(id)) return false;
      return !empleadosAEvaluar.has(id);
    })
    .map(l => ({
      nombre: String(l?.nombre || '').trim(),
      gerencia: String(l?.gerencia || '').trim(),
    }))
    .filter(r => r.nombre);
// Evaluaciones (progreso) en base a asignaciones scope
  const pairsScope = asigsScope
    .map(a => ({ evaluador_id: String(a.evaluador_id || '').trim(), evaluado_id: String(a.evaluado_id || '').trim() }))
    .filter(p => {
      if (!p.evaluador_id || !p.evaluado_id) return false;
      // evaluador también debe estar activo (aunque no esté en el filtro)
      if (!dActiveSetAll.has(p.evaluador_id)) return false;
      return true;
    });

  const evalTotal = pairsScope.length;
  let evalOk = 0;
  const okEvaluados = new Set();

  // Mismo criterio que "Resultados":
  // Completa = Evaluación completa + (C.P. completa o NO elegible)
  pairsScope.forEach(p => {
    const evaId = String(p.evaluado_id || '').trim();
    const key = `${p.evaluador_id}__${p.evaluado_id}`;
    const cab = dCabByPairAll.get(key);
    const eval_ui = cab ? leEstadoUiFromDb(cab.estado) : 'Pendiente';
    if (eval_ui !== 'Completa') return;

    const cpCab = dCpCabByEvaluadoAll.get(evaId);
    const cp_ui = cpCab ? leEstadoUiFromDb(cpCab.estado) : 'Pendiente';
    const cp_elig = dIsElegCp(evaId);

    if (cp_ui === 'Completa' || cp_elig === false){ evalOk += 1; okEvaluados.add(evaId); }
  });
  let evalPend = Math.max(0, evalTotal - evalOk);

  // Detalle: empleados dentro del scope que tienen Evaluación Completa (según criterio Eval + C.P.)
  dOkDetail = (scopeLegs || [])
    .filter(l => {
      const id = String(l?.id || '').trim();
      if (!id) return false;
      return okEvaluados.has(id);
    })
    .map(l => ({
      nombre: String(l?.nombre || '').trim(),
      gerencia: String(l?.gerencia || '').trim(),
    }))
    .filter(r => r.nombre);

  // Aplicar filtro Estado SOLO a las tarjetas de Evaluaciones
  let dispTotal = evalTotal, dispOk = evalOk, dispPend = evalPend;
  if (fEst === 'Completa'){
    dispTotal = evalOk;
    dispOk = evalOk;
    dispPend = 0;
  } else if (fEst === 'Pendiente'){
    dispTotal = evalPend;
    dispOk = 0;
    dispPend = evalPend;
  }

  // Pintar tarjetas
  setText('mActivos', activos);
  setText('mElegEval', elegEvalCount);
  setText('mElegEvalPct', dFmtPctInt(activos ? (elegEvalCount / activos) * 100 : 0));
  setText('mElegCp', elegCpCount);
  setText('mElegCpPct', dFmtPctInt(activos ? (elegCpCount / activos) * 100 : 0));

  setText('mAsig', asigCount);
  setText('mEmpEval', empleadosAEvaluar.size);
  setText('mEmpEvalPct', dFmtPctInt(elegEvalCount ? (empleadosAEvaluar.size / elegEvalCount) * 100 : 0));

  setText('mSinAsig', sinAsig);
  setText('mSinAsigPct', dFmtPctInt(elegEvalCount ? (sinAsig / elegEvalCount) * 100 : 0));

  setText('mEvalTotal', dispTotal);
  setText('mEvalOk', dispOk);
  setText('mEvalPend', dispPend);
  setText('mEvalOkPct', dFmtPctInt(dispTotal ? (dispOk / dispTotal) * 100 : 0));
  setText('mEvalPendPct', dFmtPctInt(dispTotal ? (dispPend / dispTotal) * 100 : 0));
}

async function dFetchSumByEvalIds(supa, table, evalIds){
  const out = new Map();
  const ids = Array.from(new Set((evalIds || []).filter(Boolean)));
  if (!ids.length) return out;

  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK){
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supa
      .from(table)
      .select('eval_id,puntaje')
      .in('eval_id', chunk)
      .limit(200000);
    if (error) throw error;

    (data || []).forEach(r => {
      const id = r?.eval_id;
      if (!id) return;
      const p = (typeof r.puntaje === 'number') ? r.puntaje : (r.puntaje != null ? Number(r.puntaje) : 0);
      const cur = out.get(id) || 0;
      out.set(id, cur + (Number.isFinite(p) ? p : 0));
    });
  }

  return out;
}


async function dFetchCpScoreByEvalIds(supa, evalIds){
  // C.P. guarda el puntaje por ítem como "score" en la tabla raw.
  // Usamos primero *_calc (puntaje) y, si no hay filas, hacemos fallback a raw (score).
  const out = await dFetchSumByEvalIds(supa, 'rrhh_cp_respuestas_calc', evalIds);

  const ids = Array.from(new Set((evalIds || []).filter(Boolean).map(v => String(v).trim()))).filter(Boolean);
  const missing = ids.filter(id => !out.has(id));
  if (!missing.length) return out;

  const CHUNK = 200;
  for (let i=0; i<missing.length; i+=CHUNK){
    const chunk = missing.slice(i, i+CHUNK);
    try{
      const { data, error } = await supa
        .from(T_CP_RESP)
        .select('eval_id,score')
        .in('eval_id', chunk)
        .limit(200000);
      if (error) throw error;

      (data || []).forEach(r => {
        const id = r?.eval_id;
        if (!id) return;
        const p = (typeof r.score === 'number') ? r.score : (r.score != null ? Number(r.score) : 0);
        const cur = out.get(id) || 0;
        out.set(id, cur + (Number.isFinite(p) ? p : 0));
      });
    }catch(e){
      console.error('Dashboard: no pude cargar rrhh_cp_respuestas (score fallback)', e);
    }
  }

  return out;
}

function dSetState(msg){
  setText('dState', msg);
}


function dShowNoAsigModal(show){
  const bd = document.getElementById('dNoAsigBackdrop');
  if (!bd) return;
  bd.classList.toggle('show', !!show);
  bd.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function dCloseNoAsigModal(){
  dShowNoAsigModal(false);
}

function dRenderNoAsigModal(){
  const tbody = document.getElementById('dNoAsigTbody');
  const empty = document.getElementById('dNoAsigEmpty');
  const sub = document.getElementById('dNoAsigSub');
  if (!tbody) return;

  const rows = (dNoAsigDetail || []).slice().sort((a,b) =>
    String(a.nombre||'').localeCompare(String(b.nombre||''), 'es', { sensitivity: 'base' })
  );

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.nombre || '—')}</td>
      <td>${escapeHtml(r.gerencia || '—')}</td>
    </tr>
  `).join('');

  const has = rows.length > 0;
  if (empty) empty.style.display = has ? 'none' : 'block';
  if (sub){
    sub.textContent = has
      ? `${rows.length} empleado(s) · Ordenado por Apellido y Nombre`
      : '—';
  }
}

function dOpenNoAsigModal(){
  dRenderNoAsigModal();
  dShowNoAsigModal(true);
}

function dPrintNoAsigModal(){
  // Imprime solo el listado usando un iframe oculto (evita popups en blanco / bloqueados)
  const title = 'Empleados sin asignación';
  const sub = document.getElementById('dNoAsigSub')?.textContent || '';
  const rows = (dNoAsigDetail || []).slice().sort((a,b) =>
    String(a.nombre||'').localeCompare(String(b.nombre||''), 'es', { sensitivity: 'base' })
  );

  const htmlRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.nombre || '—')}</td>
      <td>${escapeHtml(r.gerencia || '—')}</td>
    </tr>
  `).join('');

  const docHtml = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body{ font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; padding: 22px; color:#0f172a; }
    h1{ font-size: 18px; margin: 0 0 6px; }
    .sub{ color:#475569; margin: 0 0 14px; }
    table{ width:100%; border-collapse: collapse; table-layout: fixed; }
    th,td{ border:1px solid #e2e8f0; padding:10px 12px; text-align:left; vertical-align: top; }
    th{ background:#f1f5ff; font-weight: 800; }
    th:nth-child(1), td:nth-child(1){ width: 50%; }
    th:nth-child(2), td:nth-child(2){ width: 38%; }
    @media print { body{ padding: 0; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="sub">${escapeHtml(sub)}</div>
  <table>
    <thead>
      <tr><th>Apellido y Nombre</th><th>Gerencia</th></tr>
    </thead>
    <tbody>
      ${htmlRows || '<tr><td colspan="2">No hay empleados sin asignación para los filtros actuales.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;

  let frame = document.getElementById('rrhhPrintFrameNoAsig');
  if (!frame){
    frame = document.createElement('iframe');
    frame.id = 'rrhhPrintFrameNoAsig';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.opacity = '0';
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);
  }

  const fdoc = frame.contentDocument || frame.contentWindow?.document;
  if (!fdoc) return;

  fdoc.open();
  fdoc.write(docHtml);
  fdoc.close();

  // Dar un tick para que renderice antes de imprimir
  setTimeout(() => {
    try{
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }catch(_){
      // si algo falla, no rompemos la app
    }
  }, 50);
}


function dBindNoAsigModal(){
  const card = document.getElementById('dCardSinAsig');
  if (card){
    // Evitar tooltip nativo del navegador (por si quedó algún title en cache)
    card.removeAttribute('title');
    card.addEventListener('click', () => dOpenNoAsigModal());
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        dOpenNoAsigModal();
      }
    });
  }

  const bd = document.getElementById('dNoAsigBackdrop');
  const close1 = document.getElementById('dNoAsigClose');
  const close2 = document.getElementById('dNoAsigClose2');
  const printBtn = document.getElementById('dNoAsigPrint');

  close1?.addEventListener('click', dCloseNoAsigModal);
  close2?.addEventListener('click', dCloseNoAsigModal);
  printBtn?.addEventListener('click', dPrintNoAsigModal);

  // click fuera del modal -> cerrar
  bd?.addEventListener('click', (e) => {
    if (e.target === bd) dCloseNoAsigModal();
  });

  // ESC -> cerrar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){
      const isOpen = bd?.classList?.contains('show');
      if (isOpen) dCloseNoAsigModal();
    }
  });
}

// ===== Modal: Detalle de empleados con evaluación completa =====
function dShowOkModal(show){
  const bd = document.getElementById('dOkBackdrop');
  if (!bd) return;
  bd.classList.toggle('show', !!show);
  bd.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function dCloseOkModal(){
  dShowOkModal(false);
}

function dRenderOkModal(){
  const tbody = document.getElementById('dOkModalTbody');
  const empty = document.getElementById('dOkEmpty');
  const sub = document.getElementById('dOkSub');
  if (!tbody) return;

  const rows = (dOkDetail || []).slice().sort((a,b) =>
    String(a.nombre||'').localeCompare(String(b.nombre||''), 'es', { sensitivity: 'base' })
  );

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.nombre || '—')}</td>
      <td>${escapeHtml(r.gerencia || '—')}</td>
    </tr>
  `).join('');

  const has = rows.length > 0;
  if (empty) empty.style.display = has ? 'none' : 'block';
  if (sub){
    sub.textContent = has
      ? `${rows.length} empleado(s) · Ordenado por Apellido y Nombre`
      : '—';
  }
}

function dOpenOkModal(){
  dRenderOkModal();
  dShowOkModal(true);
}

function dPrintOkModal(){
  const title = 'Empleados con evaluación completa';
  const sub = document.getElementById('dOkSub')?.textContent || '';
  const rows = (dOkDetail || []).slice().sort((a,b) =>
    String(a.nombre||'').localeCompare(String(b.nombre||''), 'es', { sensitivity: 'base' })
  );

  const htmlRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.nombre || '—')}</td>
      <td>${escapeHtml(r.gerencia || '—')}</td>
    </tr>
  `).join('');

  const docHtml = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body{ font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; padding: 22px; color:#0f172a; }
    h1{ font-size: 18px; margin: 0 0 6px; }
    .sub{ color:#475569; margin: 0 0 14px; }
    table{ width:100%; border-collapse: collapse; table-layout: fixed; }
    th,td{ border:1px solid #e2e8f0; padding:10px 12px; text-align:left; vertical-align: top; }
    th{ background:#f1f5ff; font-weight: 800; }
    th:nth-child(1), td:nth-child(1){ width: 50%; }
    th:nth-child(2), td:nth-child(2){ width: 38%; }
    @media print { body{ padding: 0; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="sub">${escapeHtml(sub)}</div>
  <table>
    <thead>
      <tr><th>Apellido y Nombre</th><th>Gerencia</th></tr>
    </thead>
    <tbody>
      ${htmlRows || '<tr><td colspan="2">No hay empleados con evaluación completa para los filtros actuales.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;

  let frame = document.getElementById('rrhhPrintFrameOk');
  if (!frame){
    frame = document.createElement('iframe');
    frame.id = 'rrhhPrintFrameOk';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.opacity = '0';
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);
  }

  const fdoc = frame.contentDocument || frame.contentWindow?.document;
  if (!fdoc) return;

  fdoc.open();
  fdoc.write(docHtml);
  fdoc.close();

  setTimeout(() => {
    try{
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }catch(_){}
  }, 50);
}

function dBindOkModal(){
  const card = document.getElementById('dCardCompletas');
  if (card){
    // Evitar tooltip nativo del navegador (por si quedó algún title en cache)
    card.removeAttribute('title');
    card.addEventListener('click', () => dOpenOkModal());
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        dOpenOkModal();
      }
    });
  }

  const bd = document.getElementById('dOkBackdrop');
  const close1 = document.getElementById('dOkClose');
  const close2 = document.getElementById('dOkClose2');
  const printBtn = document.getElementById('dOkPrint');

  close1?.addEventListener('click', dCloseOkModal);
  close2?.addEventListener('click', dCloseOkModal);
  printBtn?.addEventListener('click', dPrintOkModal);

  bd?.addEventListener('click', (e) => {
    if (e.target === bd) dCloseOkModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){
      const isOpen = bd?.classList?.contains('show');
      if (isOpen) dCloseOkModal();
    }
  });
}

function dOverallEstado(row){
  return row?.completo ? 'Completa' : 'Pendiente';
}

function dBuildCabMapFromRows(rows){
  // rows: [{ eval_id, evaluado_id, estado, updated_at }]
  // Por cada evaluado nos quedamos con:
  // - preferencia por COMPLETA
  // - si empate, la mas nueva por updated_at
  const map = new Map();

  (rows || []).forEach(r => {
    const id = String(r.evaluado_id || '').trim();
    if (!id) return;

    const cur = {
      eval_id: r.eval_id,
      evaluado_id: r.evaluado_id,
      estado: r.estado,
      updated_at: r.updated_at,
    };

    const prev = map.get(id);
    if (!prev){
      map.set(id, cur);
      return;
    }

    const prevUi = leEstadoUiFromDb(prev.estado);
    const curUi  = leEstadoUiFromDb(cur.estado);

    if (prevUi !== 'Completa' && curUi === 'Completa'){
      map.set(id, cur);
      return;
    }

    if (prevUi === 'Completa' && curUi !== 'Completa'){
      return;
    }

    // Mismo "nivel" -> mas nuevo por updated_at
    const prevT = prev.updated_at ? new Date(prev.updated_at).getTime() : 0;
    const curT  = cur.updated_at ? new Date(cur.updated_at).getTime() : 0;
    if (curT >= prevT) map.set(id, cur);
  });

  return map;
}

function dGroupCount(rows, keyFn){
  const map = new Map();
  (rows || []).forEach(r => {
    const k = keyFn(r);
    if (!k) return;
    const cur = map.get(k) || { total: 0, ok: 0 };
    cur.total += 1;
    if (r.completo) cur.ok += 1;
    map.set(k, cur);
  });
  return map;
}

function dRenderBars(targetId, grouped){
  const el = document.getElementById(targetId);
  if (!el) return;

  const entries = Array.from(grouped.entries())
    .map(([k,v]) => {
      const pct = v.total ? (v.ok / v.total) * 100 : 0;
      return { k, ...v, pct };
    })
    .sort((a,b) => b.pct - a.pct || a.k.localeCompare(b.k, 'es'));

  if (!entries.length){
    el.innerHTML = '<div class="muted">Sin datos</div>';
    return;
  }

  el.innerHTML = entries.map(x => {
    const pctLabel = (Math.round(x.pct * 10) / 10).toString().replace('.', ',');
    return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(x.k)}</div>
        <div class="bar-track" aria-label="${escapeHtml(x.k)}">
          <div class="bar-fill" style="width:${Math.max(0, Math.min(100, x.pct))}%"></div>
        </div>
        <div class="bar-meta">
          <b>${x.ok}</b>/${x.total}
          <span class="bar-pct">${pctLabel}%</span>
        </div>
      </div>
    `;
  }).join('');
}

function dRenderCompletasTable(rows){
  const tbody = document.getElementById('dOkTbody');
  const avgEl = document.getElementById('mAvgPuntaje');
  if (!tbody) return;

  const ok = (rows || []).filter(r => r.completo);

  ok.sort((a,b) => (a.nombre || '').localeCompare((b.nombre || ''), 'es'));

  if (!ok.length){
    tbody.innerHTML = `<tr><td colspan="2" class="muted">No hay completas con los filtros actuales.</td></tr>`;
    if (avgEl){
      avgEl.textContent = '—';
      avgEl.removeAttribute('style');
    }
    return;
  }

  // Calcular promedio de puntaje total (Eval + C.P.) para las completas
  let sum = 0;
  let cnt = 0;
  ok.forEach(r => {
    const p = (typeof r.puntaje === 'number' && Number.isFinite(r.puntaje)) ? r.puntaje : (dPuntajeByEvaluado.get(String(r.id)) ?? 0);
    if (typeof p === 'number' && Number.isFinite(p)){
      sum += p;
      cnt += 1;
    }
  });
  const avg = cnt ? (sum / cnt) : 0;

  if (avgEl){
    // Estilo tipo "pill" con el mismo criterio de Resultados
    const st = dPuntajePillStyle(avg) + 'font-size:24px;line-height:1.1;padding:6px 10px;min-width:auto;';
    avgEl.innerHTML = `<span style="${st}">${escapeHtml(dFmtAR(avg))}</span>`;
  }

  tbody.innerHTML = ok.map(r => {
    const p = (typeof r.puntaje === 'number' && Number.isFinite(r.puntaje)) ? r.puntaje : (dPuntajeByEvaluado.get(String(r.id)) ?? 0);
    const st = dPuntajePillStyle(p);
    return `
      <tr>
        <td>${escapeHtml(r.nombre)}</td>
        <td class="td-score"><span style="${st}text-align:center;">${escapeHtml(dFmtAR(p))}</span></td>
      </tr>
    `;
  }).join('');


  // Reaplicar filtro de búsqueda local (Completas), si hay texto cargado
  dApplyCompletasSearchFilter();
}

function dNormText(s){
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dApplyCompletasSearchFilter(){
  const inp = document.getElementById('dOkSearch');
  const tbody = document.getElementById('dOkTbody');
  if (!tbody || !inp) return;

  const q = dNormText(inp.value);
  const rows = Array.from(tbody.querySelectorAll('tr'));

  // Si es el mensaje "No hay...", no lo ocultamos
  if (rows.length === 1){
    const only = rows[0];
    const td = only.querySelector('td[colspan]');
    if (td) return;
  }

  let visible = 0;
  rows.forEach(tr => {
    if (tr.id === 'dOkSearchEmptyRow') return;
    const nameCell = tr.querySelector('td');
    const name = nameCell ? dNormText(nameCell.textContent) : '';
    const show = !q || name.includes(q);
    tr.style.display = show ? '' : 'none';
    if (show) visible += 1;
  });

  const emptyId = 'dOkSearchEmptyRow';
  let emptyRow = document.getElementById(emptyId);
  if (!visible && q){
    if (!emptyRow){
      emptyRow = document.createElement('tr');
      emptyRow.id = emptyId;
      emptyRow.innerHTML = `<td colspan="2" class="muted">Sin resultados para “${escapeHtml(inp.value)}”.</td>`;
      tbody.appendChild(emptyRow);
    }else{
      emptyRow.style.display = '';
      emptyRow.querySelector('td').innerHTML = `Sin resultados para “${escapeHtml(inp.value)}”.`;
    }
  }else if (emptyRow){
    emptyRow.remove();
  }
}



function dPuntajePillStyleMuted(){
  return 'display:inline-block;padding:6px 12px;border-radius:999px;font-weight:900;min-width:84px;text-align:right;background:#eef1f6;color:#334155;';
}

function dRenderAvgByGrupo(rows, field, tbodyId){
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  const groups = new Map();

  // Inicializar con todos los grupos del universo (aunque no tengan completas)
  if (field === 'sucursal' && Array.isArray(dAllSucursales) && dAllSucursales.length){
    dAllSucursales.forEach(s => {
      const k = String(s || '—');
      if (!groups.has(k)) groups.set(k, { sum: 0, cnt: 0 });
    });
  } else {
    (rows || []).forEach(r => {
      const k = String(r?.[field] || '—');
      if (!groups.has(k)) groups.set(k, { sum: 0, cnt: 0 });
    });
  }

  // Acumular solo completas (mismo criterio que Completas)
  (rows || []).forEach(r => {
    if (!r || !r.completo) return;
    const k = String(r?.[field] || '—');
    const g = groups.get(k) || { sum: 0, cnt: 0 };
    const p = (typeof r.puntaje === 'number' && Number.isFinite(r.puntaje)) ? r.puntaje : (dPuntajeByEvaluado.get(String(r.id)) ?? 0);
    if (typeof p === 'number' && Number.isFinite(p)){
      g.sum += p;
      g.cnt += 1;
    }
    groups.set(k, g);
  });

  const entries = Array.from(groups.entries())
    .map(([k,v]) => ({ k, ...v, avg: v.cnt ? (v.sum / v.cnt) : null }))
    .sort((a,b) => a.k.localeCompare(b.k, 'es'));

  if (!entries.length){
    tbody.innerHTML = `<tr><td colspan="2" class="muted">Sin datos</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(e => {
    const st = (e.avg == null) ? dPuntajePillStyleMuted() : dPuntajePillStyle(e.avg);
    const val = (e.avg == null) ? '—' : dFmtAR(e.avg);
    return `
      <tr>
        <td>${escapeHtml(e.k)}</td>
        <td class="td-score"><span style="${st}text-align:center;">${escapeHtml(val)}</span></td>
      </tr>
    `;
  }).join('');
}



function dFlattenRubricaCodes(rubrica){
  // Devuelve lista de códigos en el orden UI (1.1, 1.2, ...)
  const out = [];
  try{
    (rubrica || []).forEach(sec => {
      (sec.items || []).forEach(it => {
        if (it && it.id) out.push(String(it.id));
      });
    });
  }catch(_){ /* noop */ }
  return out;
}

async function dLoadEvalItemsMeta(supa){
  // Lee rrhh_eval_items(activo=true) ordenado y arma etiquetas compatibles con Resultados
  const meta = [];
  try{
    const { data, error } = await supa
      .from(T_EVAL_ITEMS)
      .select('item_id,item_text,puntaje_indiv,activo')
      .eq('activo', true)
      .order('item_id', { ascending: true })
      .limit(500);
    if (error) throw error;

    const db = (data || []).map(r => ({
      item_id: r.item_id,
      text: String(r.item_text || '').trim(),
      max: (r.puntaje_indiv == null ? null : Number(r.puntaje_indiv))
    }));

    const uiCodes = dFlattenRubricaCodes(R_RUBRICA);
    const sameLen = uiCodes.length && uiCodes.length === db.length;

    db.forEach((r, idx) => {
      const code = sameLen ? uiCodes[idx] : '';
      meta.push({ item_id: r.item_id, label: `${code ? code + ' ' : ''}${r.text || '—'}`.trim(), max: (typeof r.max === 'number' && !Number.isNaN(r.max)) ? r.max : null });
    });
  }catch(e){
    console.error('Dashboard: no pude cargar rrhh_eval_items', e);
  }
  return meta;
}

async function dLoadEvalAnswersCache(supa, evalIds){
  const out = new Map();
  const ids = Array.from(new Set((evalIds || []).filter(Boolean)));
  if (!ids.length) return out;

  const CHUNK = 500;
  for (let i=0; i<ids.length; i+=CHUNK){
    const chunk = ids.slice(i, i+CHUNK);
    try{
      const { data, error } = await supa
        .from('rrhh_eval_respuestas_calc')
        .select('eval_id,item_id,valor')
        .in('eval_id', chunk)
        .limit(20000);
      if (error) throw error;
      (data || []).forEach(r => {
        const eid = String(r.eval_id || '').trim();
        if (!eid) return;
        const arr = out.get(eid) || [];
        arr.push({ item_id: r.item_id, valor: resNormalizeValor(r.valor) });
        out.set(eid, arr);
      });
    }catch(e){
      console.error('Dashboard: no pude cargar rrhh_eval_respuestas_calc', e);
    }
  }
  return out;
}


async function dLoadCpItemsMeta(supa){
  // Lee rrhh_cp_items(activo=true) ordenado y arma etiquetas compatibles con C.P.
  const meta = [];
  try{
    const { data, error } = await supa
      .from(T_CP_ITEMS)
      .select('item_id,item_text,puntaje_indiv,activo')
      .eq('activo', true)
      .order('item_id', { ascending: true })
      .limit(500);
    if (error) throw error;

    const db = (data || []).map(r => ({
      item_id: r.item_id,
      text: String(r.item_text || '').trim(),
      max: (r.puntaje_indiv == null ? null : Number(r.puntaje_indiv))
    }));

    const uiCodes = dFlattenRubricaCodes(CP_RUBRICA);
    const sameLen = uiCodes.length && uiCodes.length === db.length;

    db.forEach((r, idx) => {
      const code = sameLen ? uiCodes[idx] : '';
      meta.push({ item_id: r.item_id, label: `${code ? code + ' ' : ''}${r.text || '—'}`.trim(), max: (typeof r.max === 'number' && !Number.isNaN(r.max)) ? r.max : null });
    });
  }catch(e){
    console.error('Dashboard: no pude cargar rrhh_cp_items', e);
  }
  return meta;
}

async function dLoadCpAnswersCache(supa, evalIds){
  // Devuelve Map(eval_id -> [{item_id, valor}]) usando primero la tabla *_calc y
  // haciendo fallback a la tabla raw si faltan filas (caso: respuestas cargadas sin calc).
  const out = new Map();
  const ids = Array.from(new Set((evalIds || []).filter(Boolean).map(v => String(v).trim()))).filter(Boolean);
  if (!ids.length) return out;

  const CHUNK = 500;
  for (let i=0; i<ids.length; i+=CHUNK){
    const chunk = ids.slice(i, i+CHUNK);
    let present = new Set();

    // 1) Intento principal: calc
    try{
      const { data, error } = await supa
        .from('rrhh_cp_respuestas_calc')
        .select('eval_id,item_id,valor')
        .in('eval_id', chunk)
        .limit(20000);
      if (error) throw error;

      (data || []).forEach(r => {
        const eid = String(r.eval_id || '').trim();
        if (!eid) return;
        present.add(eid);
        const arr = out.get(eid) || [];
        arr.push({ item_id: r.item_id, valor: resNormalizeValor(r.valor) });
        out.set(eid, arr);
      });
    }catch(e){
      console.error('Dashboard: no pude cargar rrhh_cp_respuestas_calc', e);
    }

    // 2) Fallback: raw (solo los eval_id que no trajeron filas en calc)
    const missing = chunk.filter(id => !present.has(String(id).trim()));
    if (!missing.length) continue;

    try{
      const { data, error } = await supa
        .from(T_CP_RESP)
        .select('eval_id,item_id,valor')
        .in('eval_id', missing)
        .limit(20000);
      if (error) throw error;

      (data || []).forEach(r => {
        const eid = String(r.eval_id || '').trim();
        if (!eid) return;
        const arr = out.get(eid) || [];
        arr.push({ item_id: r.item_id, valor: resNormalizeValor(r.valor) });
        out.set(eid, arr);
      });
    }catch(e){
      console.error('Dashboard: no pude cargar rrhh_cp_respuestas (fallback)', e);
    }
  }
  return out;
}


const dStackLabelsPlugin = {
  id: 'dStackLabelsPlugin',
  afterDatasetsDraw(chart){
    const { ctx } = chart;
    if (!ctx) return;
    ctx.save();
    ctx.font = '800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metas = chart.getSortedVisibleDatasetMetas();
    metas.forEach(meta => {
      meta.data.forEach((bar, idx) => {
        const v = chart.data.datasets[meta.index]?.data?.[idx];
        if (!v || v <= 0) return;
        const props = bar.getProps(['x','y','base','height','width'], true);
        const x0 = Math.min(props.base, props.x);
        const x1 = Math.max(props.base, props.x);
        const w = x1 - x0;
        if (w < 18) return; // si es muy finito, no dibujamos
        const x = x0 + w/2;
        const y = props.y;
        ctx.fillStyle = '#0f172a';
        // si el dataset es rojo/verde oscuro, ponemos blanco
        const bg = String(chart.data.datasets[meta.index]?.backgroundColor || '');
        if (bg.includes('e11d48') || bg.includes('166534') || bg.includes('14532d')) ctx.fillStyle = '#ffffff';
        ctx.fillText(String(v), x, y);
      });
    });
    ctx.restore();
  }
};

function dRenderItemsChart(rows){
  const canvas = document.getElementById('dItemsChart');
  const empty = document.getElementById('dItemsChartEmpty');
  const metaEl = document.getElementById('dItemsChartMeta');
  if (!canvas || !window.Chart) return;

  // Evaluaciones consideradas: 
  // - si la fila trae múltiples evaluaciones (eval_ids_all), las incluimos todas
  // - sino usamos eval_id
  // y luego filtramos a las que tengan al menos 1 respuesta.
  const evalIds = Array.from(new Set(
    (Array.isArray(rows) ? rows : [])
      .flatMap(r => Array.isArray(r?.eval_ids_all) && r.eval_ids_all.length
        ? r.eval_ids_all
        : [r?.eval_id]
      )
      .map(x => String(x || '').trim())
      .filter(Boolean)
  ));

  const usable = evalIds.filter(eid => (dEvalAnswersByEvalId.get(eid) || []).length > 0);

  if (metaEl){
    metaEl.textContent = usable.length ? `Evaluaciones con respuestas: ${usable.length}` : '—';
  }

  if (!usable.length){
    if (empty) empty.style.display = 'block';
    if (dItemsChart){ dItemsChart.destroy(); dItemsChart = null; }
    return;
  }
  if (empty) empty.style.display = 'none';

  const CAT = ['Bajo Normal','Normal','Muy Bien','Excelente'];
  const colors = {
    'Bajo Normal': '#e11d48',
    'Normal': '#fde047',
    'Muy Bien': '#f59e0b',
    'Excelente': '#166534'
  };

  // Agregado item_id -> categoria -> conteo
  const byItem = new Map();
  usable.forEach(eid => {
    const ans = dEvalAnswersByEvalId.get(eid) || [];
    ans.forEach(a => {
      const itemId = a.item_id;
      if (itemId == null) return;
      const v = resNormalizeValor(a.valor);
      if (!CAT.includes(v)) return;
      const m = byItem.get(itemId) || { 'Bajo Normal':0, 'Normal':0, 'Muy Bien':0, 'Excelente':0 };
      m[v] += 1;
      byItem.set(itemId, m);
    });
  });

  // Eje Y en el orden de rrhh_eval_items
  const labels = (dEvalItemsMeta || []).map(x => x.label);
  const itemIds = (dEvalItemsMeta || []).map(x => x.item_id);

  const datasets = CAT.map(cat => ({
    label: cat,
    data: itemIds.map(id => (byItem.get(id)?.[cat] || 0)),
    backgroundColor: colors[cat],
    borderWidth: 0,
    barPercentage: 0.82,
    categoryPercentage: 0.84
  }));

  const cfg = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          displayColors: false,
          padding: 12,
          bodySpacing: 6,
          titleSpacing: 6,
          footerSpacing: 6,
          boxPadding: 6,
          maxWidth: 520,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed?.x ?? 0;
              return `${ctx.dataset.label}: ${v}`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { precision: 0 } },
        y: { stacked: true }
      }
    },
    plugins: [dStackLabelsPlugin]
  };

  if (dItemsChart){ dItemsChart.destroy(); dItemsChart = null; }
  dItemsChart = new Chart(canvas, cfg);
}


function dRenderCpItemsChart(rows){
  const canvas = document.getElementById('dCpItemsChart');
  const empty = document.getElementById('dCpItemsChartEmpty');
  const metaEl = document.getElementById('dCpItemsChartMeta');
  if (!canvas || !window.Chart) return;

  const CAT = ['Bajo Normal','Normal','Muy Bien','Excelente'];
  const colors = {
    'Bajo Normal': '#e11d48',
    'Normal': '#fde047',
    'Muy Bien': '#f59e0b',
    'Excelente': '#166534'
  };

  const rowsArr = Array.isArray(rows) ? rows : [];


  // Universo del gráfico C.P.: solo los que están 'Completos' (Eval completa + (C.P. completa o NO elegible))
  const scope = rowsArr.filter(r => r && r.completo);

  // Auto-Excelente: para quienes NO son elegibles para C.P. (se toma Excelente en todo)
  const autoExcelRows = scope.filter(r => r && r.cp_elig === false);
  const autoN = autoExcelRows.length;

  // C.P. consideradas: solo elegibles con cp_eval_id y con al menos 1 respuesta
  const cpEvalIds = Array.from(new Set(
    scope
      .filter(r => r && r.cp_elig !== false)
      .map(r => String(r.cp_eval_id || '').trim())
      .filter(Boolean)
  ));
  const usable = cpEvalIds.filter(eid => (dCpAnswersByEvalId.get(eid) || []).length > 0);

  if (metaEl){
    const aTxt = autoN ? ` · Auto-Excelente: ${autoN}` : '';
    metaEl.textContent = usable.length ? `C.P. con respuestas: ${usable.length}${aTxt}` : (autoN ? `Auto-Excelente: ${autoN}` : '—');
  }

  if (!usable.length && !autoN){
    if (empty) empty.style.display = 'block';
    if (dCpItemsChart){ dCpItemsChart.destroy(); dCpItemsChart = null; }
    return;
  }
  if (empty) empty.style.display = 'none';

  // Agregado item_id -> categoria -> conteo
  const byItem = new Map();

  // 1) Desde respuestas reales de C.P.
  usable.forEach(eid => {
    const ans = dCpAnswersByEvalId.get(eid) || [];
    ans.forEach(a => {
      const itemId = a.item_id;
      if (itemId == null) return;
      const v = resNormalizeValor(a.valor);
      if (!CAT.includes(v)) return;
      const m = byItem.get(itemId) || { 'Bajo Normal':0, 'Normal':0, 'Muy Bien':0, 'Excelente':0 };
      m[v] += 1;
      byItem.set(itemId, m);
    });
  });

  // 2) Auto-Excelente para NO elegibles (1 por persona y por ítem)
  if (autoN){
    (dCpItemsMeta || []).forEach(it => {
      const itemId = it.item_id;
      if (itemId == null) return;
      const m = byItem.get(itemId) || { 'Bajo Normal':0, 'Normal':0, 'Muy Bien':0, 'Excelente':0 };
      m['Excelente'] += autoN;
      byItem.set(itemId, m);
    });
  }

  // Eje Y en el orden de rrhh_cp_items
  const labels = (dCpItemsMeta || []).map(x => x.label);
  const itemIds = (dCpItemsMeta || []).map(x => x.item_id);

  const datasets = CAT.map(cat => ({
    label: cat,
    data: itemIds.map(id => (byItem.get(id)?.[cat] || 0)),
    backgroundColor: colors[cat],
    borderWidth: 0,
    barPercentage: 0.82,
    categoryPercentage: 0.84
  }));

  const cfg = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed?.x ?? 0;
              return `${ctx.dataset.label}: ${v}`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { precision: 0 } },
        y: { stacked: true }
      }
    },
    plugins: [dStackLabelsPlugin]
  };

  if (dCpItemsChart){ dCpItemsChart.destroy(); dCpItemsChart = null; }
  dCpItemsChart = new Chart(canvas, cfg);
}


function dRenderLowEvalChart(rows){
  const canvas = document.getElementById('dLowEvalChart');
  const empty = document.getElementById('dLowEvalEmpty');
  const metaEl = document.getElementById('dLowEvalMeta');
  if (!canvas || !window.Chart) return;

  const stripItemPrefix = (label) => {
    // Quita prefijos tipo "3.2 " o "5 " al inicio para achicar el texto.
    return String(label || '').replace(/^\s*\d+(?:\.\d+)?\s*/, '').trim();
  };

  // Reutiliza el cache dEvalAnswersByEvalId, y calcula solo "Bajo Normal"
  const CAT = ['Bajo Normal','Normal','Muy Bien','Excelente'];

  const evalIds = Array.from(new Set(
    (Array.isArray(rows) ? rows : [])
      .flatMap(r => Array.isArray(r?.eval_ids_all) && r.eval_ids_all.length
        ? r.eval_ids_all
        : [r?.eval_id]
      )
      .map(x => String(x || '').trim())
      .filter(Boolean)
  ));

  const usable = evalIds.filter(eid => (dEvalAnswersByEvalId.get(eid) || []).length > 0);

  const items = Array.isArray(dEvalItemsMeta) ? dEvalItemsMeta : [];
  const nItems = items.length || 1;
  const weightPctDefault = 1 / nItems;

  const byItem = new Map(); // item_id -> { bajo, total }
  usable.forEach(eid => {
    const ans = dEvalAnswersByEvalId.get(eid) || [];
    ans.forEach(a => {
      const itemId = a.item_id;
      if (itemId == null) return;
      const v = resNormalizeValor(a.valor);
      if (!CAT.includes(v)) return;
      const m = byItem.get(itemId) || { bajo: 0, total: 0 };
      m.total += 1;
      if (v === 'Bajo Normal') m.bajo += 1;
      byItem.set(itemId, m);
    });
  });

  const rowsData = items.map(it => {
    const c = byItem.get(it.item_id) || { bajo: 0, total: 0 };
    const rate = c.total ? (c.bajo / c.total) : 0;
    const weightPct = weightPctDefault;
    const impact = rate * weightPct * 100;
    return { label: it.label, impact, bajo: c.bajo, total: c.total, weightPct };
  }).filter(x => x.bajo > 0);

  rowsData.sort((a,b) => (b.impact - a.impact));
  const top = rowsData.slice(0, 10);

  if (metaEl){
    const wTxt = (Math.round(weightPctDefault * 1000) / 10).toString().replace('.', ',');
    metaEl.textContent = top.length ? `Top ${top.length} · Peso por ítem: ${wTxt}%` : '—';
  }

  if (!top.length){
    if (empty) empty.style.display = 'block';
    if (dLowEvalChart){ dLowEvalChart.destroy(); dLowEvalChart = null; }
    return;
  }
  if (empty) empty.style.display = 'none';

  const labels = top.map(x => stripItemPrefix(x.label));
  const data = top.map(x => Math.round(x.impact * 100) / 100);

  const barColors = ['#7f1d1d','#991b1b','#b91c1c','#dc2626','#ea580c','#f97316','#f59e0b','#fbbf24','#fdba74','#fed7aa'];

  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Impacto ponderado (%)',
        data,
        backgroundColor: data.map((_, i) => barColors[i % barColors.length]),
        borderWidth: 0,
        barPercentage: 0.82,
        categoryPercentage: 0.84
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          titleSpacing: 0,
          titleMarginBottom: 0,
          callbacks: {
            title: () => '',
            label: (ctx) => {
              const i = ctx.dataIndex;
              const it = top[i];
              const rate = it.total ? (it.bajo / it.total) * 100 : 0;
              const rateTxt = (Math.round(rate * 10) / 10).toString().replace('.', ',');
              const wTxt = (Math.round(it.weightPct * 1000) / 10).toString().replace('.', ',');
              const impTxt = (Math.round(it.impact * 100) / 100).toString().replace('.', ',');
              return `${it.bajo}/${it.total} (${rateTxt}%) · Peso: ${wTxt}% · Impacto: ${impTxt}%`;
            }
          }
        }
      },
      layout: { padding: { left: 18, right: 8, top: 0, bottom: 0 } },
      scales: {
        x: {
          ticks: {
            callback: (v) => String(v).replace('.', ',')
          }
        },
        y: { ticks: { autoSkip: false, padding: 6, font: { size: 12 } } }
      }
    }
  };

  if (dLowEvalChart){ dLowEvalChart.destroy(); dLowEvalChart = null; }
  dLowEvalChart = new Chart(canvas, cfg);
}

function dRenderLowCpChart(rows){
  const canvas = document.getElementById('dLowCpChart');
  const empty = document.getElementById('dLowCpEmpty');
  const metaEl = document.getElementById('dLowCpMeta');
  if (!canvas || !window.Chart) return;

  const stripItemPrefix = (label) => {
    // Quita prefijos tipo "5.1 " o "5 " al inicio para achicar el texto.
    return String(label || '').replace(/^\s*\d+(?:\.\d+)?\s*/, '').trim();
  };

  const CAT = ['Bajo Normal','Normal','Muy Bien','Excelente'];
  const rowsArr = Array.isArray(rows) ? rows : [];

  // Misma lógica de universo que el gráfico C.P. por ítem:
  // solo filas "completas" (Eval completa + (C.P. completa o NO elegible))
  const scope = rowsArr.filter(r => r && r.completo);

  const autoExcelRows = scope.filter(r => r && r.cp_elig === false);
  const autoN = autoExcelRows.length;

  const cpEvalIds = Array.from(new Set(
    scope
      .filter(r => r && r.cp_elig !== false)
      .map(r => String(r.cp_eval_id || '').trim())
      .filter(Boolean)
  ));
  const usable = cpEvalIds.filter(eid => (dCpAnswersByEvalId.get(eid) || []).length > 0);

  const items = Array.isArray(dCpItemsMeta) ? dCpItemsMeta : [];
  const nItems = items.length || 1;

  const sumMax = items.reduce((acc, it) => {
    const v = (typeof it.max === 'number' && !Number.isNaN(it.max)) ? it.max : 0;
    return acc + v;
  }, 0);

  const weightPctFallback = 1 / nItems;

  const byItem = new Map(); // item_id -> { bajo, total }

  // Para tooltip: mapear eval_id de C.P. -> nombre del evaluado
  const cpEvalIdToNombre = new Map();
  scope.forEach(r => {
    if (!r || r.cp_elig === false) return;
    const eid = String(r.cp_eval_id || '').trim();
    if (!eid) return;
    const nom = String(r.nombre || '').trim();
    if (!nom) return;
    if (!cpEvalIdToNombre.has(eid)) cpEvalIdToNombre.set(eid, nom);
  });

  const bajoNamesByItem = new Map(); // item_id -> Set(nombres)

  usable.forEach(eid => {
    const ans = dCpAnswersByEvalId.get(eid) || [];
    const nom = cpEvalIdToNombre.get(String(eid).trim()) || '';
    ans.forEach(a => {
      const itemId = a.item_id;
      if (itemId == null) return;
      const v = resNormalizeValor(a.valor);
      if (!CAT.includes(v)) return;
      const m = byItem.get(itemId) || { bajo: 0, total: 0 };
      m.total += 1;
      if (v === 'Bajo Normal'){
        m.bajo += 1;
        if (nom){
          const set = bajoNamesByItem.get(itemId) || new Set();
          set.add(nom);
          bajoNamesByItem.set(itemId, set);
        }
      }
      byItem.set(itemId, m);
    });
  });

  // Auto-Excelente (NO elegibles): suman al total, nunca a "Bajo Normal"
  if (autoN){
    items.forEach(it => {
      const itemId = it.item_id;
      if (itemId == null) return;
      const m = byItem.get(itemId) || { bajo: 0, total: 0 };
      m.total += autoN;
      byItem.set(itemId, m);
    });
  }

  const rowsData = items.map(it => {
    const c = byItem.get(it.item_id) || { bajo: 0, total: 0 };
    const rate = c.total ? (c.bajo / c.total) : 0;

    const hasMax = (typeof it.max === 'number' && !Number.isNaN(it.max)) && sumMax > 0;
    const weightPct = hasMax ? (it.max / sumMax) : weightPctFallback;

    const impact = rate * weightPct * 100;
    return { item_id: it.item_id, label: it.label, impact, bajo: c.bajo, total: c.total, weightPct, max: it.max };
  });

  // Si no hay ningún "Bajo Normal", mostramos el mensaje vacío
  const totalBajo = rowsData.reduce((acc, x) => acc + (x.bajo || 0), 0);

  // Ordenar por impacto para que la torta sea más "legible"
  const ordered = rowsData.slice().sort((a,b) => (b.impact - a.impact));

  if (metaEl){
    const autoTxt = autoN ? ` · Auto-Excelente: ${autoN}` : '';
    // Son 5 ítems fijos, por eso no usamos "Top N" acá
    metaEl.textContent = ordered.length ? `Ítems: ${ordered.length}${autoTxt}` : (autoTxt ? `—${autoTxt}` : '—');
  }

  if (!ordered.length || totalBajo === 0){
    if (empty) empty.style.display = 'block';
    if (dLowCpChart){ dLowCpChart.destroy(); dLowCpChart = null; }
    return;
  }
  if (empty) empty.style.display = 'none';

  const labelsRaw = ordered.map(x => x.label);
  const labels = labelsRaw.map(stripItemPrefix);
  const data = ordered.map(x => Math.round((x.impact || 0) * 100) / 100);

  // Paleta por intensidad (máximo = rojo/naranja oscuro)
  // ordered ya viene ordenado por mayor impacto.
  const pieColors = ['#7f1d1d', '#b91c1c', '#ea580c', '#f59e0b', '#fdba74'];

  const cfg = {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        label: 'Impacto ponderado (%)',
        data,
        backgroundColor: labels.map((_, i) => pieColors[i % pieColors.length]),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          padding: 12,
          bodySpacing: 6,
          titleSpacing: 6,
          footerSpacing: 6,
          boxPadding: 6,
          maxWidth: 520,
          callbacks: {
            title: (items) => {
              if (!items || !items.length) return '';
              const i = items[0].dataIndex;
              return labels[i] || '';
            },
            label: (ctx) => {
              const i = ctx.dataIndex;
              const it = ordered[i];
              const rate = it.total ? (it.bajo / it.total) * 100 : 0;
              const rateTxt = (Math.round(rate * 10) / 10).toString().replace('.', ',');
              const wTxt = (Math.round((it.weightPct || 0) * 1000) / 10).toString().replace('.', ',');
              const impTxt = (Math.round((it.impact || 0) * 100) / 100).toString().replace('.', ',');
              return `${it.bajo}/${it.total} (${rateTxt}%) · Peso: ${wTxt}% · Impacto: ${impTxt}%`;
            },
            afterBody: (items) => {
              if (!items || !items.length) return [];
              const i = items[0].dataIndex;
              const itemId = ordered[i]?.item_id;
              const set = (itemId != null) ? (bajoNamesByItem.get(itemId) || new Set()) : new Set();
              const names = Array.from(set.values()).sort((a,b) => a.localeCompare(b, 'es'));
              if (!names.length) return [];

              // Limitar para que no explote el tooltip
              const limit = 25;
              const shown = names.slice(0, limit);
              const rest = names.length - shown.length;

              const lines = ['Evaluados:'];
              const perLine = 1;
              for (let k = 0; k < shown.length; k += perLine){
                lines.push('  ' + shown.slice(k, k + perLine).join(', '));
              }
              if (rest > 0) lines.push(`  (+${rest} más)`);
              return lines;
            }
          }
        }
      },
      layout: { padding: { left: 0, right: 0, top: 0, bottom: 0 } }
    }
  };

  if (dLowCpChart){ dLowCpChart.destroy(); dLowCpChart = null; }
  dLowCpChart = new Chart(canvas, cfg);
}
function dApplyAndRender(){
  const fGer = document.getElementById('dGerencia')?.value || '';
  const fSuc = document.getElementById('dSucursal')?.value || '';
  const fEst = document.getElementById('dEstado')?.value || ''; // Completa | Pendiente | ''

  let rows = dAll;
  // Tarjetas grandes: recalcular con filtros
  dUpdateMetricCards({ fGer, fSuc, fEst });

  if (fGer) rows = rows.filter(r => (r.gerencia || '') === fGer);
  if (fSuc) rows = rows.filter(r => (r.sucursal || '') === fSuc);
  if (fEst) rows = rows.filter(r => dOverallEstado(r) === fEst);

  // KPIs
  const total = rows.length;
  const evalOk = rows.filter(r => r.eval_ui === 'Completa').length;
  const cpOk = rows.filter(r => r.cp_ui === 'Completa').length;
  const allOk = rows.filter(r => r.completo).length;
  const pctAll = total ? (allOk / total) * 100 : 0;
  const pctLabel = (Math.round(pctAll * 10) / 10).toString().replace('.', ',');

  setText('dTotal', total);
  setText('dEvalOk', evalOk);
  setText('dEvalPend', Math.max(0, total - evalOk));
  setText('dCpOk', cpOk);
  setText('dCpPend', Math.max(0, total - cpOk));
  setText('dAllOk', allOk);
  setText('dAllPct', `${pctLabel}%`);

  // KPIs (tarjetas)
  setText('kpiTotal', total);
  setText('kpiEvalOk', evalOk);
  setText('kpiEvalPend', Math.max(0, total - evalOk));
  setText('kpiCpOk', cpOk);
  setText('kpiCpPend', Math.max(0, total - cpOk));
  setText('kpiAllOk', allOk);

  // Charts
  dRenderBars('dBarsSucursal', dGroupCount(rows, r => r.sucursal || '—'));
  dRenderBars('dBarsGerencia', dGroupCount(rows, r => r.gerencia || '—'));

  // Chart por ítem (Resultados)
  dRenderItemsChart(rows);
  dRenderCpItemsChart(rows);

  // Alertas (solo 'Bajo Normal' ponderado)
  dRenderLowEvalChart(rows);
  dRenderLowCpChart(rows);

  // Tabla completas
  dRenderCompletasTable(rows);
  dRenderAvgByGrupo(rows, 'gerencia', 'dGerAvgTbody');
  dRenderAvgByGrupo(rows, 'sucursal', 'dSucAvgTbody');
}

async function initDashboard(){
  const supa = createClient();

  dAnio = Number(document.getElementById('dAnio')?.value || 2026) || 2026;
  setText('dAnioLabel', dAnio);
  // Navegación rápida a secciones (Graficos =>)
  const gotoSel = document.getElementById('dGoto');
  if (gotoSel && !gotoSel.dataset.bound){
    gotoSel.dataset.bound = '1';
    gotoSel.addEventListener('change', () => {
      const v = String(gotoSel.value || '');
      if (!v) return;
      const el = document.getElementById(v);
      if (el){
        // El header es sticky, así que scrollIntoView deja el título “tapado”.
        const header = document.querySelector('header');
        const headerH = header ? header.getBoundingClientRect().height : 0;
        const extra = 12; // pequeño aire arriba
        const y = window.scrollY + el.getBoundingClientRect().top - (headerH + extra);
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
      gotoSel.value = '';
    });
  }

  // Búsqueda local dentro de la tabla "Completas"
  const okSearch = document.getElementById('dOkSearch');
  if (okSearch && !okSearch.dataset.bound){
    okSearch.dataset.bound = '1';
    okSearch.addEventListener('input', () => dApplyCompletasSearchFilter());
    okSearch.addEventListener('search', () => dApplyCompletasSearchFilter());
  }

  const doReload = async () => {
    dSetState('Cargando...');

    // 1) Asignaciones (para métricas + universo de reportes)
    const { data: asigs, error: errAs } = await supa
      .from(T_ASIG)
      .select('anio,evaluador_id,evaluado_id,activo')
      .eq('anio', dAnio)
      .eq('activo', true)
      .limit(20000);
    if (errAs) throw errAs;

    const asigRows = Array.isArray(asigs) ? asigs : [];
    dAsigRowsAll = asigRows;
    const evaluadosAsignados = new Set(asigRows.map(r => String(r.evaluado_id || '').trim()).filter(Boolean));
    const asigCount = asigRows.length;
    const empleadosAEvaluar = new Set(asigRows.map(r => String(r.evaluado_id || '').trim()).filter(Boolean));

    // 2) Legajos (para sucursal/gerencia/nombre)
    const { data: legs, error: errLeg } = await supa
      .from(T_LEGAJOS)
      .select('"ID","Nombre Completo","Sucursal","Gerencia","Sector","Baja"')
      .eq('Baja', 'Activo')
      .limit(5000);
    if (errLeg) throw errLeg;

    const legajos = (legs || []).map(r => ({
      id: r['ID'],
      nombre: String(r['Nombre Completo'] || '—').replace(/\s+/g, ' ').trim(),
      sucursal: r['Sucursal'] || '',
      gerencia: r['Gerencia'] || '',
      sector: r['Sector'] || ''
    }));
    dLegajosAll = legajos;
    // Lista completa de sucursales (para mostrar aunque no haya completas)
    dAllSucursales = Array.from(new Set((legajos || []).map(l => String(l.sucursal || '—').trim() || '—')))
      .filter(Boolean)
      .sort((a,b) => a.localeCompare(b, 'es'));

    // 2b) Elegibilidad (flags)
    const activos = legajos.length;
    const activeIds = legajos.map(l => String(l.id)).filter(Boolean);
    const activeSet = new Set(activeIds);
    dActiveSetAll = activeSet;

    let flagsMap = new Map(); // legajo_id -> {des,cp}
    try{
      if (activeIds.length){
        const { data: fData, error: fErr } = await supa
          .from(T_FLAGS)
          .select('legajo_id,es_evaluable_desempeno,es_evaluable_cp')
          .in('legajo_id', activeIds)
          .limit(20000);
        if (fErr) throw fErr;
        (fData || []).forEach(f => {
          flagsMap.set(String(f.legajo_id), {
            des: (typeof f.es_evaluable_desempeno === 'boolean') ? f.es_evaluable_desempeno : true,
            cp:  (typeof f.es_evaluable_cp === 'boolean') ? f.es_evaluable_cp : true,
          });
        });
      }
    }catch(e){
      console.error(e);
      flagsMap = new Map();
    }

        dFlagsMap = flagsMap;

    const isElegEval = (id) => {
      const f = flagsMap.get(String(id));
      return f ? (f.des !== false) : true; // si falta flag, asumimos true
    };
    const isElegCp = (id) => {
      const f = flagsMap.get(String(id));
      return f ? (f.cp !== false) : true;
    };

    const elegEvalCount = activeIds.filter(id => isElegEval(id)).length;
    const elegCpCount = activeIds.filter(id => isElegCp(id)).length;

    // Métricas (tarjetas)
    setText('mActivos', activos);
    setText('mElegEval', elegEvalCount);
    setText('mElegEvalPct', dFmtPctInt(activos ? (elegEvalCount / activos) * 100 : 0));
    setText('mElegCp', elegCpCount);
    setText('mElegCpPct', dFmtPctInt(activos ? (elegCpCount / activos) * 100 : 0));

    setText('mAsig', asigCount);
    setText('mEmpEval', empleadosAEvaluar.size);
    setText('mEmpEvalPct', dFmtPctInt(elegEvalCount ? (empleadosAEvaluar.size / elegEvalCount) * 100 : 0));
    const sinAsig = Math.max(0, elegEvalCount - empleadosAEvaluar.size);
    setText('mSinAsig', sinAsig);
    setText('mSinAsigPct', dFmtPctInt(elegEvalCount ? (sinAsig / elegEvalCount) * 100 : 0));

    const base = evaluadosAsignados.size
      ? legajos.filter(l => evaluadosAsignados.has(String(l.id)))
      : legajos;

    // 3) Cabeceras Evaluaciones + CP (estado por evaluado)
    const { data: evalCab, error: errEC } = await supa
      .from(T_EVAL_CAB)
      .select('eval_id,anio,evaluador_id,evaluado_id,estado,created_at,updated_at')
      .eq('anio', dAnio)
      .limit(20000);
    if (errEC) throw errEC;

    const { data: cpCab, error: errCC } = await supa
      .from(T_CP_CAB)
      .select('eval_id,anio,evaluador_id,evaluado_id,estado,created_at,updated_at')
      .eq('anio', dAnio)
      .limit(20000);
    if (errCC) throw errCC;

    // --- C.P.: (1 por evaluado) preferimos Completa y la mas nueva ---
    const cpMap   = dBuildCabMapFromRows((cpCab || []).map(r => ({
      eval_id: r.eval_id,
      evaluado_id: r.evaluado_id,
      estado: r.estado,
      updated_at: r.updated_at,
    })));
    // Guardar mapa para recalcular tarjetas con filtros (C.P.)
    dCpCabByEvaluadoAll = cpMap;

    // --- Evaluaciones: puede haber MÚLTIPLES por evaluado (por evaluador) ---
    // Construimos:
    // - cabByPair: estado/ids por par evaluador__evaluado
    // - evalInfoByEvaluado: total/ok por evaluado, lista de eval_ids (una por evaluador)

    // map por par evaluador-evaluado para estado (si hay varias filas para el mismo par,
    // preferimos la Completa; si empate, la mas nueva por updated_at)
    const cabByPair = new Map();
    (evalCab || []).forEach(r => {
      const evalId = String(r.evaluador_id || '').trim();
      const evaId  = String(r.evaluado_id || '').trim();
      if (!evalId || !evaId) return;
      const key = `${evalId}__${evaId}`;

      const prev = cabByPair.get(key);
      if (!prev){ cabByPair.set(key, r); return; }

      const prevUi = leEstadoUiFromDb(prev.estado);
      const curUi  = leEstadoUiFromDb(r.estado);

      if (prevUi !== 'Completa' && curUi === 'Completa'){
        cabByPair.set(key, r);
        return;
      }
      if (prevUi === 'Completa' && curUi !== 'Completa'){
        return;
      }

      const prevT = prev.updated_at ? new Date(prev.updated_at).getTime() : 0;
      const curT  = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      if (curT >= prevT) cabByPair.set(key, r);
    });

    // Guardar para recalcular tarjetas con filtros (Eval)
    dCabByPairAll = cabByPair;

    // Universo = asignaciones activas del año, filtradas por Activos + elegibilidad desempeño
    // (mismo criterio que Listado Evaluaciones)
    const pairs = asigRows
      .map(a => ({ evaluador_id: a.evaluador_id, evaluado_id: a.evaluado_id }))
      .filter(p => {
        const evalId = String(p.evaluador_id || '').trim();
        const evaId  = String(p.evaluado_id || '').trim();
        if (!evalId || !evaId) return false;
        if (!activeSet.has(evalId)) return false;
        if (!activeSet.has(evaId)) return false;
        if (!isElegEval(evaId)) return false;
        return true;
      });

    // info por evaluado: total/ok y lista de eval_ids
    const evalInfoByEvaluado = new Map();
    pairs.forEach(p => {
      const evaId = String(p.evaluado_id || '').trim();
      const key = `${String(p.evaluador_id || '').trim()}__${evaId}`;
      const cab = cabByPair.get(key);
      const ui = cab ? leEstadoUiFromDb(cab.estado) : 'Pendiente';

      const cur = evalInfoByEvaluado.get(evaId) || {
        total: 0,
        ok: 0,
        eval_ids_all: [],
        rep_eval_id: '',
        rep_updated: ''
      };

      cur.total += 1;
      if (ui === 'Completa') cur.ok += 1;

      // Guardamos el eval_id (uno por evaluador). Sirve para promediar y para los gráficos.
      if (cab?.eval_id){
        const eid = String(cab.eval_id);
        cur.eval_ids_all.push(eid);

        // evaluacion representativa = la mas nueva por updated_at
        const curT = cur.rep_updated ? new Date(cur.rep_updated).getTime() : 0;
        const cabT = cab.updated_at ? new Date(cab.updated_at).getTime() : 0;
        if (!cur.rep_eval_id || cabT >= curT){
          cur.rep_eval_id = eid;
          cur.rep_updated = cab.updated_at || cur.rep_updated;
        }
      }

      evalInfoByEvaluado.set(evaId, cur);
    });

    // Helpers por evaluado
    const getEvalUiByEvaluado = (evaId) => {
      const x = evalInfoByEvaluado.get(String(evaId || '').trim());
      if (!x || !x.total) return 'Pendiente';
      return (x.ok === x.total) ? 'Completa' : 'Pendiente';
    };

    const getEvalIdsByEvaluado = (evaId) => {
      const x = evalInfoByEvaluado.get(String(evaId || '').trim());
      const arr = (x && Array.isArray(x.eval_ids_all)) ? x.eval_ids_all : [];
      // dedup por las dudas
      return Array.from(new Set(arr.map(v => String(v || '').trim()).filter(Boolean)));
    };

    const getEvalRepByEvaluado = (evaId) => {
      const x = evalInfoByEvaluado.get(String(evaId || '').trim());
      return {
        eval_id: x?.rep_eval_id || '',
        updated_at: x?.rep_updated || ''
      };
    };

    // 3b) Puntajes (completas: Eval completa + (C.P. completa o NO elegible))
    // Para NO elegibles de C.P. se asume "Excelente" en todos los ítems => suma de puntaje_indiv de rrhh_cp_items(activo=true)
    let cpMaxTotal = 0;
    try{
      const { data: cpMaxRows, error: errCpMax } = await supa
        .from(T_CP_ITEMS)
        .select('puntaje_indiv,activo')
        .eq('activo', true)
        .limit(5000);
      if (errCpMax) throw errCpMax;
      cpMaxTotal = (cpMaxRows || []).reduce((acc, r) => {
        const v = (typeof r.puntaje_indiv === 'number')
          ? r.puntaje_indiv
          : (r.puntaje_indiv != null ? Number(r.puntaje_indiv) : 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);
    }catch(e){
      console.error('Dashboard: no pude leer puntaje_indiv de C.P.', e);
      cpMaxTotal = 0;
    }

    const evalIdsNeed = [];
    const cpIdsNeed = [];

    // Pre-carga de respuestas de C.P. (calc + fallback raw) para validar completitud
    const cpEvalIdsAll = Array.from(new Set(
      base.map(l => {
        const evaId = String(l.id || '').trim();
        const c = cpMap.get(evaId);
        return c?.eval_id ? String(c.eval_id).trim() : '';
      }).filter(Boolean)
    ));
    const cpAnsCache = await dLoadCpAnswersCache(supa, cpEvalIdsAll);

    base.forEach(l => {
      const evaId = String(l.id || '').trim();
      const c = cpMap.get(evaId);

      const eval_ui = getEvalUiByEvaluado(evaId);
      const cp_ui = leEstadoUiFromDb(c?.estado);
      const cp_elig = isElegCp(evaId);

      const cp_has = (cp_elig === false) || (
        cp_ui === 'Completa' &&
        c?.eval_id &&
        ((cpAnsCache.get(String(c.eval_id).trim()) || []).length > 0)
      );

      // Completa = (TODAS las evaluaciones asignadas completas) + (C.P. con respuestas o NO elegible)
      const completa = (eval_ui === 'Completa') && (cp_elig === false || cp_has);

      if (completa){
        getEvalIdsByEvaluado(evaId).forEach(id => evalIdsNeed.push(id));
        if (cp_elig !== false && cp_has && c?.eval_id) cpIdsNeed.push(c.eval_id);
      }
    });

    const evalSumById = await dFetchSumByEvalIds(supa, 'rrhh_eval_respuestas_calc', evalIdsNeed);
    const cpSumById   = await dFetchCpScoreByEvalIds(supa, cpIdsNeed);
    dPuntajeByEvaluado = new Map();

    dAll = base.map(l => {
      const evaId = String(l.id || '').trim();
      const c = cpMap.get(evaId);

      const eval_ui = getEvalUiByEvaluado(evaId);
      const rep = getEvalRepByEvaluado(evaId);

      const cp_ui = leEstadoUiFromDb(c?.estado);
      const eval_elig = isElegEval(evaId);
      const cp_elig = isElegCp(evaId);

      const eval_ids_all = getEvalIdsByEvaluado(evaId);

      const cp_has = (cp_elig === false) || (
        cp_ui === 'Completa' &&
        c?.eval_id &&
        ((cpAnsCache.get(String(c.eval_id).trim()) || []).length > 0)
      );

      const completo = (eval_ui === 'Completa') && (cp_elig === false || cp_has);

      let puntaje = null;
      if (completo){
        // Si hay más de una evaluación, promediamos (sumar y promediar solo en esos casos)
        const n = eval_ids_all.length;
        const sumEval = eval_ids_all.reduce((acc, id) => acc + (evalSumById.get(id) || 0), 0);
        const evalAvg = n ? (sumEval / n) : 0;

        let cpScore = 0;
        if (cp_elig === false){
          cpScore = cpMaxTotal;
        } else if (cp_has){
          cpScore = c?.eval_id ? (cpSumById.get(c.eval_id) || 0) : 0;
        }

        puntaje = evalAvg + cpScore;
        dPuntajeByEvaluado.set(evaId, puntaje);
      }

      return {
        ...l,
        puntaje,
        // eval_id representativo (más nuevo) para compatibilidad con UI/gráficos
        eval_id: rep.eval_id || '',
        eval_ids_all,
        cp_eval_id: c?.eval_id || '',
        eval_elig,
        cp_elig,
        eval_ui,
        cp_ui,
        completo,
        eval_updated: rep.updated_at || '',
        cp_updated: c?.updated_at || ''
      };
    });

    // 3b-extra) Datos para el gráfico por ítem (Resultados)
    dEvalItemsMeta = await dLoadEvalItemsMeta(supa);
    const evalIdsForChart = Array.from(new Set(
      dAll
        .flatMap(r => Array.isArray(r?.eval_ids_all) && r.eval_ids_all.length ? r.eval_ids_all : [r?.eval_id])
        .map(x => String(x || '').trim())
        .filter(Boolean)
    ));
    dEvalAnswersByEvalId = await dLoadEvalAnswersCache(supa, evalIdsForChart);

    // 3b-extra) Datos para el gráfico por ítem (C.P.)
    dCpItemsMeta = await dLoadCpItemsMeta(supa);
    const cpEvalIdsForChart = Array.from(new Set(dAll.map(r => String(r.cp_eval_id || '').trim()).filter(Boolean)));
    dCpAnswersByEvalId = await dLoadCpAnswersCache(supa, cpEvalIdsForChart);


    // 3c) Progreso Evaluaciones (como en Listado Evaluaciones)
    const evalTotalPairs = pairs.length;

    let evalOkPairs = 0;
    pairs.forEach(p => {
      const key = `${String(p.evaluador_id || '').trim()}__${String(p.evaluado_id || '').trim()}`;
      const cab = cabByPair.get(key);
      const ui = cab ? leEstadoUiFromDb(cab.estado) : 'Pendiente';
      if (ui === 'Completa') evalOkPairs += 1;
    });

    const evalPendPairs = Math.max(0, evalTotalPairs - evalOkPairs);
    setText('mEvalTotal', evalTotalPairs);
    setText('mEvalOk', evalOkPairs);
    setText('mEvalPend', evalPendPairs);
    setText('mEvalOkPct', dFmtPctInt(evalTotalPairs ? (evalOkPairs / evalTotalPairs) * 100 : 0));
    setText('mEvalPendPct', dFmtPctInt(evalTotalPairs ? (evalPendPairs / evalTotalPairs) * 100 : 0));

    // 4) Filtros superiores
    fillSelect(document.getElementById('dGerencia'), uniqSorted(dAll.map(r => r.gerencia).filter(Boolean)), { includeAllLabel: 'Todas' });
    fillSelect(document.getElementById('dSucursal'), uniqSorted(dAll.map(r => r.sucursal).filter(Boolean)), { includeAllLabel: 'Todas' });

    dSetState('OK');
    dApplyAndRender();
  };

  // Eventos
  document.getElementById('dReload')?.addEventListener('click', doReload);
  document.getElementById('dPrint')?.addEventListener('click', () => window.print());

  document.getElementById('dAnio')?.addEventListener('change', () => {
    dAnio = Number(document.getElementById('dAnio')?.value || 2026) || 2026;
    setText('dAnioLabel', dAnio);
    doReload();
  });
  dBindNoAsigModal();
  dBindOkModal();

  ['dGerencia','dSucursal','dEstado'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', dApplyAndRender);
  });

  // Init
  doReload();
}


// =========================
// BOOT
// =========================

document.addEventListener('DOMContentLoaded', async () => {
  markActiveNav();
  ensureBackToTop();

  try{
    const page = String(getPage() || '').toLowerCase();
    const file = getFile();

    // Compat: si cambia el data-page en el HTML, nos guiamos por el nombre del archivo.
    const isInicio = page === 'inicio' || file === 'inicio.html';
    const isAsignaciones = page === 'asignaciones' || file === 'asignaciones.html';
    const isListado = page === 'listado' || page === 'listado_asignaciones' || file === 'listado_asignaciones.html';
    const isEvalRealizar = page === 'realizar' || page === 'evaluaciones' || file === 'evaluaciones.html';
    const isListadoEvaluaciones = page === 'listado_evaluaciones' || file === 'listado_evaluaciones.html';

    const isFlags = page === 'flags' || file === 'flags.html';

    const isCP = page === 'cp' || file === 'compromiso_presentismo.html';

    const isResultados = page === 'resultados' || file === 'resultados.html';

    const isComparativos = page === 'comparativos' || file === 'comparativos.html';

    const isDashboard = page === 'dashboard' || file === 'dashboard.html';

    if (isInicio) await initInicio();
    if (isFlags) await initFlags();
    if (isAsignaciones) await initEvaluaciones();
    if (isListado) await initListado();
    if (isListadoEvaluaciones) await initListadoEvaluaciones();
    if (isCP) await initCompromisoPresentismo();
    if (isResultados) await initResultados();
    if (isComparativos) await initComparativos();
    if (isDashboard) await initDashboard();
    if (isEvalRealizar) {
      // Si tu Evaluaciones "realizar" se implementa en otro init, acá lo enchufamos.
      // (si no existe todavía, no rompe)
      if (typeof initRealizar === 'function') await initRealizar();
    }
  }catch(err){
    console.error(err);
    // Mensaje minimo en UI si existe el pill de estado
    const page = String(getPage() || '').toLowerCase();
    const file = getFile();
    if (page === 'evaluaciones' || page === 'asignaciones' || file === 'asignaciones.html') setSaveState('Error');
    if (page === 'listado' || page === 'listado_asignaciones' || file === 'listado_asignaciones.html') setText('lState', 'Error');
    if (page === 'listado_evaluaciones' || file === 'listado_evaluaciones.html') setText('leState', 'Error');
    if (page === 'dashboard' || file === 'dashboard.html') setText('dState', 'Error');
  }
});
