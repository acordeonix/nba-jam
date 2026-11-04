import { crearStore } from './store.js';
import * as API from './api.js';
import * as M from './metrics.js';
import { lineas, mini, barras, PALETA } from './charts.js';
import { vDecisiones, DECISIONES_DEFAULT, alertas, perfilDe } from './decisiones.js';
import { leerPlan, capacidad } from './plan.js';
import { vRanking, eventosRanking } from './ranking.js';

// ---------------- Estado ----------------
const PREDETERMINADO = () => ({
  version: 1,
  ajustes: { tdKey: '', avKey: '', bxToken: '', serieCetes: API.SERIES_BANXICO.cetes28, cetesManual: 7, enPesos: true, horas: 12 },
  lista: [
    { id: 'VOO', simbolo: 'VOO', nombre: 'Vanguard S&P 500 ETF', mercado: 'US', fuente: 'td' },
    { id: 'QQQ', simbolo: 'QQQ', nombre: 'Invesco QQQ (Nasdaq 100)', mercado: 'US', fuente: 'td' },
    { id: 'EWW', simbolo: 'EWW', nombre: 'iShares MSCI Mexico ETF', mercado: 'US', fuente: 'td' },
  ],
  practica: { inicial: 50000, ops: [] },
  decisiones: DECISIONES_DEFAULT(),
});

const store = crearStore();
let E = PREDETERMINADO();
const series = {};        // id -> {serie, moneda, fuente, actualizado, error}
let mercado = { cetes: [], fix: [], actualizado: 0, error: null };
let vista = 'resumen', seleccion = null, rango = 365 * 3, comparar = new Set(), ordenarPor = 'r1a';
const CETES_ID = 'CETES';
let lecturaPlan = null;
const cap = () => capacidad(lecturaPlan, E.decisiones.inicio);
async function cargarPlan() { lecturaPlan = await leerPlan(store); render(); }

// ---------------- Utilidades ----------------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, dec = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dec)}%`);
const pctS = (v, dec = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(dec)}%`);
const dinero = (v, mon = 'MXN', dec = 2) => (v == null || !Number.isFinite(v) ? '—' : `${mon === 'USD' ? 'US$' : '$'}${v.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`);
const cls = (v) => (v == null ? '' : v >= 0 ? 'sube' : 'baja');
const hoy = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);
const fechaLarga = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const meses = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 86400000)) : null);

function aviso(msg, tipo = 'info', ms = 4500) {
  const a = document.createElement('div'); a.className = `toast ${tipo}`; a.textContent = msg;
  $('#toasts').append(a); setTimeout(() => a.remove(), ms);
}
let guardarT;
function guardar() { clearTimeout(guardarT); guardarT = setTimeout(() => store.save(E).catch((e) => aviso('No se pudo guardar: ' + e.message, 'error')), 400); }

// Serie "efectiva" (en pesos si así se configuró) para cálculos
function serieDe(id) {
  if (id === CETES_ID) return { serie: indiceCetes(), moneda: 'MXN', nombre: 'CETES 28 días', fuente: mercado.cetes.length ? 'Banxico' : 'tasa manual' };
  const s = series[id]; if (!s?.serie?.length) return null;
  if (E.ajustes.enPesos && s.moneda === 'USD' && mercado.fix.length) return { ...s, serie: M.aPesos(s.serie, mercado.fix), moneda: 'MXN', convertida: true };
  return s;
}
function tasasCetes() {
  if (mercado.cetes.length) return mercado.cetes;
  // Respaldo: tasa manual constante en los últimos 10 años (semanal)
  const out = []; const fin = Date.now();
  for (let t = fin - 3653 * 86400000; t <= fin; t += 7 * 86400000) out.push({ d: new Date(t).toISOString().slice(0, 10), c: Number(E.ajustes.cetesManual) || 0 });
  return out;
}
function indiceCetes() { return M.indiceCetes(tasasCetes(), hoy()).map((p) => ({ d: p.d, c: p.c * 100 })); }
const activos = () => [...E.lista, { id: CETES_ID, simbolo: 'CETES 28', nombre: 'CETES a 28 días (referencia sin riesgo de mercado)', mercado: 'MX', fuente: 'bx' }];
const nombreDe = (id) => activos().find((a) => a.id === id)?.simbolo || id;

// ---------------- Datos ----------------
async function cargarMercado(forzar = false) {
  const c = await store.loadSerie('_mercado').catch(() => null);
  if (c) mercado = { cetes: c.cetes || [], fix: c.fix || [], actualizado: c.actualizado || 0 };
  const viejo = Date.now() - (mercado.actualizado || 0) > E.ajustes.horas * 3600000;
  if (!E.ajustes.bxToken || (!forzar && !viejo && mercado.cetes.length)) return;
  try {
    const idC = E.ajustes.serieCetes || API.SERIES_BANXICO.cetes28;
    const r = await API.banxico([idC, API.SERIES_BANXICO.fix], E.ajustes.bxToken);
    mercado = { cetes: r[idC] || [], fix: r[API.SERIES_BANXICO.fix] || [], actualizado: Date.now(), error: null };
    if (!mercado.cetes.length) throw new API.ErrorDatos('Banxico no regresó la serie de CETES; revisa el ID en Ajustes.');
    await store.saveSerie('_mercado', { serie: [], cetes: mercado.cetes, fix: mercado.fix, actualizado: mercado.actualizado });
  } catch (e) {
    mercado.error = e.message;
    aviso(`Banxico: ${e.message} Uso la tasa manual de CETES.`, 'error', 7000);
  }
}

async function cargarActivo(a, forzar = false) {
  if (!series[a.id]) {
    const c = await store.loadSerie(a.id).catch(() => null);
    if (c?.serie?.length) series[a.id] = c;
  }
  const s = series[a.id];
  if (a.fuente === 'csv') return; // solo se actualiza volviendo a importar
  const viejo = !s || Date.now() - (s.actualizado || 0) > E.ajustes.horas * 3600000;
  if (!forzar && !viejo) return;
  try {
    const r = a.fuente === 'av' ? await API.alphaSerie(a.simbolo, E.ajustes.avKey) : await API.twelveSerie(a.simbolo, E.ajustes.tdKey);
    series[a.id] = { ...r, actualizado: Date.now(), error: null };
    await store.saveSerie(a.id, series[a.id]);
  } catch (e) {
    series[a.id] = { ...(s || { serie: [] }), error: e.message };
    if (e.tipo !== 'llave') aviso(`${a.simbolo}: ${e.message}`, 'error', 6000);
  }
}

async function actualizarTodo(forzar = false) {
  $('#btnActualizar').disabled = true;
  const pend = E.lista.filter((a) => a.fuente !== 'csv');
  let n = 0; estado(`Actualizando… 0/${pend.length}`);
  await cargarMercado(forzar);
  for (const a of E.lista) {
    await cargarActivo(a, forzar);
    if (a.fuente !== 'csv') estado(`Actualizando… ${++n}/${pend.length}`);
    render();
  }
  estado(''); $('#btnActualizar').disabled = false; render();
}
function estado(t) { $('#estado').textContent = t; }

// ---------------- Vistas ----------------
const VISTAS = {
  resumen: 'Resumen', decisiones: 'Decisiones', ranking: 'Ranking', detalle: 'Detalle', comparar: 'Comparar', simulador: 'Simulador', practica: 'Práctica', aprende: 'Aprende', ajustes: 'Ajustes',
};

function render() {
  $('#tabs').innerHTML = Object.entries(VISTAS).map(([k, v]) => `<button data-vista="${k}" class="${k === vista ? 'activa' : ''}">${v}</button>`).join('');
  const main = $('#vista');
  ({ ranking: (m) => vRanking(m, ctx()), decisiones: (m) => vDecisiones(m, ctx()), resumen: vResumen, detalle: vDetalle, comparar: vComparar, simulador: vSimulador, practica: vPractica, aprende: vAprende, ajustes: vAjustes })[vista](main);
}

function ctx() {
  return { E, activos, serieDe, tasasCetes, portafolio, nombreDe, guardar, render, M, cap, lecturaPlan: () => lecturaPlan, store,
    refrescar: () => { if (vista === 'ranking') render(); },
    aPesos: (serie, moneda) => (E.ajustes.enPesos && moneda === 'USD' && mercado.fix.length ? M.aPesos(serie, mercado.fix) : serie),
    seriePropia: (sim) => { const a = E.lista.find((x) => x.simbolo === sim && x.fuente === 'td'); return a ? series[a.id] : null; },
    agregarDesdeRanking: async (a, datos) => {
      const id = a.simbolo.replace(/[^\w.-]/g, '_');
      if (datos?.serie?.length && !series[id]) { series[id] = { ...datos, fuente: 'Twelve Data', nombre: a.simbolo }; store.saveSerie(id, series[id]).catch(() => {}); }
      await agregar(a, !datos?.serie?.length); aviso(`${a.nombre} se agregó a tu lista.`);
    },
  };
}

function sinLlaves() {
  if (E.ajustes.tdKey || E.ajustes.avKey) return '';
  return `<div class="banner">Para traer precios automáticos agrega tu llave gratuita de Twelve Data en <a href="#" data-ir="ajustes">Ajustes</a>. Toma 2 minutos.</div>`;
}

function vResumen(main) {
  const ct = M.resumen(indiceCetes(), tasasCetes());
  const cards = E.lista.map((a) => {
    const s = serieDe(a.id); const r = s ? M.resumen(s.serie, tasasCetes()) : null;
    const err = series[a.id]?.error;
    return `<article class="card activo" data-abrir="${esc(a.id)}">
      <header><div><b>${esc(a.simbolo)}</b> <span class="chip">${a.mercado === 'BMV' ? 'BMV' : 'EE.UU.'}</span></div>
        <div class="precio">${r ? dinero(r.precio, s.moneda) : '—'}</div></header>
      <p class="nombre">${esc(a.nombre || '')}</p>
      ${r ? `${mini(M.recortar(s.serie, 365), (r.r1a ?? 0) >= 0)}
      <dl class="kpis">
        <div><dt>Hoy</dt><dd class="${cls(r.r1d)}">${pct(r.r1d, 2)}</dd></div>
        <div><dt>1 año</dt><dd class="${cls(r.r1a)}">${pct(r.r1a)}</dd></div>
        <div><dt>3 años/año</dt><dd class="${cls(r.r3a)}">${pct(r.r3a)}</dd></div>
        <div><dt>Caída máx.</dt><dd class="baja">${pctS(r.ddMax, 0)}</dd></div>
      </dl>` : `<p class="vacio">${esc(err || 'Sin datos todavía.')}</p>`}
      ${r && r.vsCetes1a != null ? `<footer class="${cls(r.vsCetes1a)}">${r.vsCetes1a >= 0 ? 'Le ganó a' : 'Quedó debajo de'} CETES por ${pctS(Math.abs(r.vsCetes1a))} en 12 meses</footer>` : ''}
    </article>`;
  }).join('');
  const nAl = alertas(ctx(), perfilDe(E.decisiones.perfil)).filter((x) => x.lvl !== 'info').length;
  const dias = Math.ceil((Date.parse(E.decisiones.inicio + 'T00:00:00Z') - Date.now()) / 86400000);
  main.innerHTML = `${sinLlaves()}
    <div class="banner enlace" data-ir="decisiones">${dias > 0 ? `Faltan <b>${dias} días</b> para tu inicio con dinero real.` : 'Ya estás en tu etapa con dinero real.'} ${nAl ? `Tienes <b>${nAl}</b> alertas para revisar.` : ''} <a href="#" data-ir="decisiones">Ver Decisiones →</a></div>
    <section class="referencia">
      <div><span class="eti">CETES 28 días hoy</span><b>${pctS((tasasCetes().at(-1)?.c || 0) / 100, 2)}</b><small>${mercado.cetes.length ? 'Banxico, ' + fechaLarga(mercado.cetes.at(-1).d) : 'tasa manual (Ajustes)'}</small></div>
      <div><span class="eti">Dólar FIX</span><b>${mercado.fix.length ? '$' + mercado.fix.at(-1).c.toFixed(4) : '—'}</b><small>${mercado.fix.length ? fechaLarga(mercado.fix.at(-1).d) : 'requiere token Banxico'}</small></div>
      <div><span class="eti">CETES últimos 12 meses</span><b class="sube">${pct(ct?.r1a)}</b><small>la vara para medir todo lo demás</small></div>
      <div><span class="eti">Moneda de análisis</span><b>${E.ajustes.enPesos && mercado.fix.length ? 'Pesos' : 'Moneda original'}</b><small>${E.ajustes.enPesos && mercado.fix.length ? 'incluye el efecto del tipo de cambio' : ''}</small></div>
    </section>
    <div class="grid">${cards}
      <article class="card agregar" id="cardAgregar"><button class="btn" data-accion="nuevo">+ Agregar acción o ETF</button><p>Busca en EE.UU. (Twelve Data), BMV (Alpha Vantage) o importa un CSV.</p></article>
    </div>
    <p class="nota">Los ejemplos iniciales (VOO, QQQ, EWW) son para aprender a leer los datos, no recomendaciones. Rendimientos pasados no garantizan los futuros.</p>`;
}

function interpretacion(r, s) {
  const out = [];
  if (r.r3a != null) out.push(`En los últimos 3 años creció en promedio <b>${pct(r.r3a)}</b> por año${r.cetes1a != null ? `; CETES pagó alrededor de <b>${pctS(M.tasaPromedio(tasasCetes(), 365 * 3))}</b> anual en el mismo periodo` : ''}.`);
  if (r.vol != null) out.push(`Su volatilidad es de <b>${pctS(r.vol, 0)}</b> anual: en un año típico su precio puede moverse ese porcentaje hacia arriba o hacia abajo de su tendencia.`);
  if (r.ddMax != null) {
    const dur = meses(r.ddIni, r.ddFin), rec = meses(r.ddFin, r.ddRecup);
    out.push(`Su peor caída en el historial cargado fue de <b>${pctS(r.ddMax, 0)}</b> (de ${fechaLarga(r.ddIni)} a ${fechaLarga(r.ddFin)}, ${dur} meses)${r.ddRecup ? ` y tardó ${rec} meses en recuperarse` : ' y todavía no recupera ese máximo'}.`);
  }
  if (r.positivos != null) out.push(`Subió en <b>${pctS(r.positivos, 0)}</b> de los meses.`);
  if (s.convertida) out.push('Los cálculos están en pesos: incluyen lo que ganaste o perdiste por el tipo de cambio.');
  return out.map((t) => `<li>${t}</li>`).join('');
}

function vDetalle(main) {
  const lista = activos();
  if (!seleccion || !lista.find((a) => a.id === seleccion)) seleccion = lista[0]?.id;
  const a = lista.find((x) => x.id === seleccion); const s = serieDe(seleccion);
  const opciones = lista.map((x) => `<option value="${esc(x.id)}" ${x.id === seleccion ? 'selected' : ''}>${esc(x.simbolo)}</option>`).join('');
  const rangos = [[365, '1A'], [365 * 3, '3A'], [365 * 5, '5A'], [0, 'Todo']].map(([d, l]) => `<button data-rango="${d}" class="${d === rango ? 'activa' : ''}">${l}</button>`).join('');
  if (!s) { main.innerHTML = `<div class="barra"><select id="selActivo">${opciones}</select>${a.id !== CETES_ID ? `<button class="btn sec" data-quitar="${esc(a.id)}">Quitar</button>` : ''}</div><p class="vacio">${esc(series[seleccion]?.error || 'Sin datos todavía. Presiona "Actualizar precios".')}</p>`; return; }
  const r = M.resumen(s.serie, tasasCetes());
  const visible = M.recortar(s.serie, rango);
  const cetesB = seleccion !== CETES_ID ? M.base100(indiceCetes(), visible[0].d) : [];
  const anios = M.anuales(s.serie).slice(-8);
  main.innerHTML = `
    <div class="barra"><select id="selActivo">${opciones}</select><div class="seg">${rangos}</div>
      ${a.id !== CETES_ID ? `<button class="btn sec" data-quitar="${esc(a.id)}">Quitar</button>` : ''}</div>
    <h2>${esc(a.simbolo)} <small>${esc(a.nombre || '')}</small></h2>
    <p class="meta">${dinero(r.precio, s.moneda)} · cierre ${fechaLarga(r.fecha)} · ${esc(s.fuente || '')}${s.convertida ? ' · convertido a pesos con FIX' : ''}</p>
    <div class="card"><h3>Precio</h3><div id="gPrecio"></div></div>
    <dl class="metricas">
      ${[['1 mes', r.r1m], ['3 meses', r.r3m], ['En el año', r.ytd], ['1 año', r.r1a], ['3 años (anual)', r.r3a], ['5 años (anual)', r.r5a]].map(([l, v]) => `<div><dt>${l}</dt><dd class="${cls(v)}">${pct(v)}</dd></div>`).join('')}
      <div><dt>Volatilidad anual</dt><dd>${pctS(r.vol, 0)}</dd></div>
      <div><dt>Caída máxima (historial)</dt><dd class="baja">${pctS(r.ddMax, 0)}</dd></div>
      <div><dt>Debajo de su máximo</dt><dd class="${r.ddActual < -0.001 ? 'baja' : ''}">${pctS(r.ddActual, 1)}</dd></div>
      <div><dt>vs CETES (12 m)</dt><dd class="${cls(r.vsCetes1a)}">${pct(r.vsCetes1a)}</dd></div>
      <div><dt>Eficiencia</dt><dd>${r.eficiencia == null ? '—' : r.eficiencia.toFixed(2)}</dd></div>
      <div><dt>Meses positivos</dt><dd>${pctS(r.positivos, 0)}</dd></div>
    </dl>
    <div class="card"><h3>Cómo leerlo</h3><ul class="lectura">${interpretacion(r, s)}</ul></div>
    <div class="dos">
      ${seleccion !== CETES_ID ? `<div class="card"><h3>Contra CETES (base 100)</h3><div id="gVs"></div></div>` : ''}
      <div class="card"><h3>Caídas desde su máximo</h3><div id="gDD"></div></div>
    </div>
    <div class="card"><h3>Rendimiento por año</h3><div id="gAnios"></div><p class="nota">El último año está incompleto (barra clara).</p></div>`;
  const fmtP = (v) => (s.moneda === 'USD' ? 'US$' : '$') + v.toLocaleString('es-MX', { maximumFractionDigits: v < 100 ? 2 : 0 });
  lineas($('#gPrecio'), [{ nombre: a.simbolo, datos: visible, area: true, color: 'var(--s1)' }], { formatoY: fmtP, alto: 280 });
  if (seleccion !== CETES_ID) lineas($('#gVs'), [{ nombre: a.simbolo, datos: M.base100(visible, visible[0].d) }, { nombre: 'CETES 28', datos: cetesB, color: 'var(--cetes)', punteada: true }], { formatoY: (v) => v.toFixed(0), linea0: 100 });
  lineas($('#gDD'), [{ nombre: 'Caída', datos: M.drawdowns(visible).curva, area: true, color: 'var(--baja)' }], { formatoY: (v) => `${(v * 100).toFixed(0)}%`, linea0: 0, alto: 200 });
  barras($('#gAnios'), anios.map((x) => ({ l: x.a, v: x.r, parcial: x.parcial })), (v) => `${(v * 100).toFixed(0)}%`);
}

const COLS = [
  ['r1a', '1 año', 'desc', pct], ['r3a', '3 años/año', 'desc', pct], ['r5a', '5 años/año', 'desc', pct],
  ['vol', 'Volatilidad', 'asc', (v) => pctS(v, 0)], ['ddMax', 'Caída máx.', 'desc', (v) => pctS(v, 0)],
  ['eficiencia', 'Eficiencia', 'desc', (v) => (v == null ? '—' : v.toFixed(2))],
];
function vComparar(main) {
  const lista = activos();
  if (!comparar.size) lista.forEach((a) => comparar.add(a.id));
  const filas = lista.map((a) => { const s = serieDe(a.id); return { a, s, r: s ? M.resumen(s.serie, tasasCetes()) : null }; }).filter((x) => x.r);
  const col = COLS.find((c) => c[0] === ordenarPor) || COLS[0];
  filas.sort((x, y) => { const vx = x.r[col[0]], vy = y.r[col[0]]; if (vx == null) return 1; if (vy == null) return -1; return col[2] === 'asc' ? vx - vy : vy - vx; });
  const rangos = [[365, '1A'], [365 * 3, '3A'], [365 * 5, '5A']].map(([d, l]) => `<button data-rango="${d}" class="${d === rango ? 'activa' : ''}">${l}</button>`).join('');
  main.innerHTML = `
    <div class="barra"><div class="checks">${lista.map((a) => `<label><input type="checkbox" data-comp="${esc(a.id)}" ${comparar.has(a.id) ? 'checked' : ''}> ${esc(a.simbolo)}</label>`).join('')}</div><div class="seg">${rangos}</div></div>
    <div class="card"><h3>Si hubieras puesto $100 al inicio del periodo</h3><div id="gComp"></div></div>
    <div class="card tabla"><h3>Tabla comparativa <small>toca un encabezado para ordenar</small></h3>
      <div class="scroll"><table><thead><tr><th>Activo</th>${COLS.map((c) => `<th data-orden="${c[0]}" class="${c[0] === ordenarPor ? 'ord' : ''}">${c[1]}${c[0] === ordenarPor ? (c[2] === 'asc' ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(({ a, r }) => `<tr class="${a.id === CETES_ID ? 'cetes' : ''}"><td><a href="#" data-abrir="${esc(a.id)}">${esc(a.simbolo)}</a></td>${COLS.map((c) => `<td class="${['r1a', 'r3a', 'r5a'].includes(c[0]) ? cls(r[c[0]]) : ''}">${c[3](r[c[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="nota"><b>Eficiencia</b> = rendimiento extra sobre CETES ÷ volatilidad. Más alto significa que el activo pagó más por cada unidad de susto. Es una foto del pasado; sirve para comparar, no para predecir.</p>
    </div>`;
  const sel = filas.filter((f) => comparar.has(f.a.id));
  const desde = sel.length ? sel.map((f) => M.recortar(f.s.serie, rango)[0]?.d).filter(Boolean).sort().at(-1) : null;
  lineas($('#gComp'), sel.map((f, i) => ({ nombre: f.a.simbolo, datos: M.base100(f.s.serie, desde), color: f.a.id === CETES_ID ? 'var(--cetes)' : PALETA[i % PALETA.length], punteada: f.a.id === CETES_ID })), { formatoY: (v) => v.toFixed(0), linea0: 100, alto: 300 });
}

let sim = { id: null, mensual: 2000, inicial: 0, anios: 5 };
function vSimulador(main) {
  const lista = activos().filter((a) => a.id !== CETES_ID);
  if (!sim.id || !lista.find((a) => a.id === sim.id)) sim.id = lista[0]?.id;
  const s = sim.id ? serieDe(sim.id) : null;
  main.innerHTML = `
    <div class="card"><h3>¿Cuánto tendrías hoy si hubieras ahorrado cada mes?</h3>
      <form id="fSim" class="form fila">
        <label>Activo<select name="id">${lista.map((a) => `<option value="${esc(a.id)}" ${a.id === sim.id ? 'selected' : ''}>${esc(a.simbolo)}</option>`).join('')}</select></label>
        <label>Cada mes ($)<input name="mensual" type="number" min="0" step="100" value="${sim.mensual}"></label>
        <label>Inicial ($)<input name="inicial" type="number" min="0" step="500" value="${sim.inicial}"></label>
        <label>Años atrás<select name="anios">${[1, 2, 3, 5].map((n) => `<option ${n === sim.anios ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </form>
      <div id="simRes"></div><div id="gSim"></div>
      <p class="nota">Simula comprar el primer día de cada mes al precio de cierre, sin comisiones ni impuestos. Es lo que habría pasado, no lo que va a pasar.</p>
    </div>`;
  if (!s) { $('#simRes').innerHTML = '<p class="vacio">Sin datos para este activo.</p>'; return; }
  const tramo = M.recortar(s.serie, sim.anios * 365);
  const rA = M.simularAportaciones(tramo, sim.mensual, sim.inicial);
  const rC = M.simularAportaciones(M.recortar(indiceCetes(), sim.anios * 365).filter((p) => p.d >= tramo[0].d), sim.mensual, sim.inicial);
  const falta = (Date.parse(tramo.at(-1).d) - Date.parse(tramo[0].d)) / 86400000 < sim.anios * 365 - 20;
  $('#simRes').innerHTML = `${falta ? `<p class="banner">Solo hay datos desde ${fechaLarga(tramo[0].d)}.</p>` : ''}
    <div class="resultados">
      <div><span class="eti">Aportaste</span><b>${dinero(rA.aportado, 'MXN', 0)}</b></div>
      <div><span class="eti">${esc(nombreDe(sim.id))} valdría</span><b class="${cls(rA.ganancia)}">${dinero(rA.final, 'MXN', 0)}</b><small class="${cls(rA.ganancia)}">${pct(rA.ganancia / rA.aportado)}</small></div>
      <div><span class="eti">En CETES tendrías</span><b>${rC ? dinero(rC.final, 'MXN', 0) : '—'}</b><small>${rC ? pct(rC.ganancia / rC.aportado) : ''}</small></div>
      <div><span class="eti">Diferencia</span><b class="${cls(rC ? rA.final - rC.final : null)}">${rC ? dinero(rA.final - rC.final, 'MXN', 0) : '—'}</b></div>
    </div>`;
  lineas($('#gSim'), [
    { nombre: nombreDe(sim.id), datos: rA.curva.map((p) => ({ d: p.d, c: p.valor })), color: 'var(--s1)' },
    rC && { nombre: 'CETES', datos: rC.curva.map((p) => ({ d: p.d, c: p.valor })), color: 'var(--cetes)', punteada: true },
    { nombre: 'Lo aportado', datos: rA.curva.map((p) => ({ d: p.d, c: p.aportado })), color: 'var(--tenue)' },
  ].filter(Boolean), { formatoY: (v) => '$' + (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)), alto: 280 });
}

// ---------------- Práctica (portafolio simulado) ----------------
function precioHoy(id) { const s = serieDe(id); return s?.serie.at(-1)?.c ?? null; }
function portafolio() {
  const p = E.practica; let efectivo = Number(p.inicial) || 0; const pos = {};
  const ops = [...p.ops].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  for (const o of ops) {
    const x = (pos[o.activo] ||= { cant: 0, costo: 0 });
    const monto = o.cantidad * o.precio;
    if (o.tipo === 'compra') { efectivo -= monto; x.cant += o.cantidad; x.costo += monto; }
    else { const prom = x.cant ? x.costo / x.cant : 0; efectivo += monto; x.costo -= prom * o.cantidad; x.cant -= o.cantidad; }
  }
  const filas = Object.entries(pos).filter(([, x]) => x.cant > 1e-9).map(([id, x]) => {
    const pr = precioHoy(id); const valor = pr != null ? pr * x.cant : null;
    return { id, ...x, precio: pr, valor, gan: valor != null ? valor - x.costo : null };
  });
  const invertido = filas.reduce((a, f) => a + (f.valor ?? f.costo), 0);
  return { efectivo, filas, total: efectivo + invertido, inicial: Number(p.inicial) || 0 };
}
function vPractica(main) {
  const P = portafolio(); const lista = activos();
  const gan = P.total - P.inicial;
  main.innerHTML = `
    <div class="banner">Dinero de práctica: registra compras y ventas como si invirtieras de verdad y mira cómo se habrían comportado. Ningún movimiento sale a un broker.</div>
    <div class="resultados">
      <div><span class="eti">Capital inicial</span><b>${dinero(P.inicial, 'MXN', 0)}</b></div>
      <div><span class="eti">Valor hoy</span><b>${dinero(P.total, 'MXN', 0)}</b><small class="${cls(gan)}">${pct(P.inicial ? gan / P.inicial : 0)}</small></div>
      <div><span class="eti">Efectivo disponible</span><b>${dinero(P.efectivo, 'MXN', 0)}</b></div>
    </div>
    <div class="dos">
      <div class="card"><h3>Registrar operación</h3>
        <form id="fOp" class="form">
          <label>Activo<select name="activo">${lista.map((a) => `<option value="${esc(a.id)}">${esc(a.simbolo)}</option>`).join('')}</select></label>
          <div class="fila"><label>Tipo<select name="tipo"><option value="compra">Compra</option><option value="venta">Venta</option></select></label>
          <label>Fecha<input name="fecha" type="date" value="${hoy()}" max="${hoy()}"></label></div>
          <div class="fila"><label>Monto en pesos<input name="monto" type="number" min="0" step="100" placeholder="ej. 5000"></label>
          <label>o cantidad de títulos<input name="cantidad" type="number" min="0" step="any"></label></div>
          <label>¿Por qué? (tu motivo)<input name="motivo" placeholder="ej. aportación mensual del plan; bajó 15% y sigo creyendo en la empresa"></label>
          <p class="nota">Se usa el precio de cierre de esa fecha${E.ajustes.enPesos ? ', en pesos' : ''}. En CETES, 1 título = $100 al inicio de la serie.</p>
          <button class="btn">Registrar</button>
        </form>
        <label class="mini-form">Capital inicial de práctica <input id="inpInicial" type="number" min="0" step="1000" value="${P.inicial}"></label>
      </div>
      <div class="card"><h3>Posiciones</h3>
        ${P.filas.length ? `<div class="scroll"><table><thead><tr><th>Activo</th><th>Títulos</th><th>Costo</th><th>Valor</th><th>Ganancia</th></tr></thead><tbody>
        ${P.filas.map((f) => `<tr><td>${esc(nombreDe(f.id))}</td><td>${f.cant.toLocaleString('es-MX', { maximumFractionDigits: 4 })}</td><td>${dinero(f.costo, 'MXN', 0)}</td><td>${dinero(f.valor, 'MXN', 0)}</td><td class="${cls(f.gan)}">${dinero(f.gan, 'MXN', 0)} <small>${pct(f.costo ? f.gan / f.costo : 0)}</small></td></tr>`).join('')}
        </tbody></table></div>
        <div class="reparto">${P.filas.map((f, i) => `<span style="flex:${Math.max(f.valor || 0, 0)};background:${PALETA[i % PALETA.length]}" title="${esc(nombreDe(f.id))}"></span>`).join('')}${P.efectivo > 0 ? `<span style="flex:${P.efectivo}" class="efe" title="Efectivo"></span>` : ''}</div>
        <p class="nota">${P.filas.map((f) => `${esc(nombreDe(f.id))} ${pctS((f.valor || 0) / P.total, 0)}`).join(' · ')}${P.efectivo > 0 ? ` · efectivo ${pctS(P.efectivo / P.total, 0)}` : ''}</p>` : '<p class="vacio">Aún no hay operaciones.</p>'}
      </div>
    </div>
    <div class="card"><h3>Historial</h3>${E.practica.ops.length ? `<div class="scroll"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Activo</th><th>Títulos</th><th>Precio</th><th>Monto</th><th>Motivo</th><th></th></tr></thead><tbody>
      ${[...E.practica.ops].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).map((o) => `<tr><td>${fechaLarga(o.fecha)}</td><td>${o.tipo}</td><td>${esc(nombreDe(o.activo))}</td><td>${o.cantidad.toLocaleString('es-MX', { maximumFractionDigits: 4 })}</td><td>${dinero(o.precio)}</td><td>${dinero(o.cantidad * o.precio, 'MXN', 0)}</td><td class="motivo">${esc(o.motivo || '—')}</td><td><button class="x" data-borrarop="${o.id}" title="Borrar">×</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="vacio">—</p>'}</div>`;
}

function vAprende(main) {
  const t = [
    ['Rendimiento', 'Cuánto subió o bajó el precio en un periodo. El "anual" de 3 o 5 años es el promedio compuesto por año, para comparar periodos de distinta duración.'],
    ['CETES', 'Deuda del gobierno de México a corto plazo. Su precio no cae como el de una acción, por eso sirve de vara: si algo arriesgado no le gana a CETES con el tiempo, no compensó el riesgo.'],
    ['Volatilidad', 'Qué tanto se mueve el precio. 15% significa que en un año normal el precio puede alejarse ±15% de su tendencia; 40% es una montaña rusa.'],
    ['Caída máxima', 'La peor baja desde un máximo hasta un mínimo. Pregúntate si aguantarías ver tu dinero así sin vender.'],
    ['ETF', 'Un fondo que se compra como una acción y contiene muchas empresas. VOO = las 500 grandes de EE.UU.; QQQ = 100 tecnológicas del Nasdaq; EWW o NAFTRAC = empresas mexicanas.'],
    ['Diversificar', 'Repartir en varios activos que no se mueven igual, para que una caída no se lleve todo.'],
    ['Tipo de cambio', 'Si compras algo en dólares desde México (por ejemplo vía SIC), tu rendimiento en pesos incluye si el dólar subió o bajó.'],
    ['Horizonte', 'El tiempo que puedes dejar el dinero sin tocarlo. Para dinero que necesitas pronto (fondo de emergencia, enganche) importan más la liquidez y la estabilidad que el rendimiento.'],
    ['Costos', 'Comisiones, ISR sobre ganancias y dividendos y el spread reducen tu rendimiento real. El simulador no los incluye.'],
  ];
  main.innerHTML = `<div class="grid aprende">${t.map(([a, b]) => `<article class="card"><h3>${a}</h3><p>${b}</p></article>`).join('')}</div>
    <p class="nota">Esta app muestra datos históricos para que compares y decidas tú. No es asesoría financiera; para una decisión importante conviene consultar a un asesor registrado ante la CNBV.</p>`;
}

function vAjustes(main) {
  const A = E.ajustes;
  main.innerHTML = `
    <div class="dos">
      <div class="card"><h3>Llaves de datos (gratis)</h3>
        <form id="fAjustes" class="form">
          <label>Twelve Data — acciones y ETFs de EE.UU. <a href="https://twelvedata.com/register" target="_blank" rel="noopener">crear cuenta</a>
            <input name="tdKey" value="${esc(A.tdKey)}" autocomplete="off" placeholder="API key"></label>
          <label>Alpha Vantage — BMV (25 consultas/día) <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener">pedir llave</a>
            <input name="avKey" value="${esc(A.avKey)}" autocomplete="off" placeholder="API key"></label>
          <label>Banxico SIE — CETES y dólar FIX <a href="https://www.banxico.org.mx/SieAPIRest/service/v1/token" target="_blank" rel="noopener">pedir token</a>
            <input name="bxToken" value="${esc(A.bxToken)}" autocomplete="off" placeholder="token"></label>
          <div class="fila"><label>Serie de CETES (Banxico)<input name="serieCetes" value="${esc(A.serieCetes)}"></label>
          <label>CETES manual (% anual)<input name="cetesManual" type="number" step="0.01" value="${A.cetesManual}"></label></div>
          <div class="fila"><label>Actualizar cada (horas)<input name="horas" type="number" min="1" value="${A.horas}"></label>
          <label class="check"><input type="checkbox" name="enPesos" ${A.enPesos ? 'checked' : ''}> Analizar activos en dólares convertidos a pesos</label></div>
          <button class="btn">Guardar</button>
        </form>
        <p class="nota">Las llaves se guardan solo en tu cuenta (Firestore), no en GitHub. La tasa manual se usa si Banxico no responde.</p>
        ${mercado.error ? `<p class="banner error">Último error de Banxico: ${esc(mercado.error)}</p>` : ''}
      </div>
      <div class="card"><h3>Apariencia</h3>
        <label class="mini-form">Tema <select id="selTema">${[['matriz', 'Matriz (negro y verde)'], ['claro', 'Claro'], ['oscuro', 'Oscuro'], ['auto', 'Automático (según tu equipo)']].map(([v, l]) => `<option value="${v}" ${(document.documentElement.dataset.theme || 'matriz') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="mini-form"><input type="checkbox" id="chkLluvia" ${window.lluviaActiva?.() ? 'checked' : ''}> Lluvia de caracteres de fondo (solo en tema Matriz)</label>
        <p class="nota">Se guarda en este dispositivo.</p>
      </div>
      <div class="card"><h3>Respaldo</h3>
        <p>Descarga tu lista, ajustes y operaciones de práctica (sin precios).</p>
        <div class="fila"><button class="btn sec" data-accion="exportar">Descargar JSON</button>
        <label class="btn sec">Restaurar JSON<input type="file" accept=".json" id="inpRestaurar" hidden></label></div>
        <h3>Caché de precios</h3>
        <p>${Object.keys(series).length} activos guardados. ${store.modo === 'firebase' ? 'Se sincroniza entre tu celular y computadora.' : 'Modo local: solo en este navegador.'}</p>
        <button class="btn sec" data-accion="forzar">Volver a descargar todo</button>
      </div>
    </div>`;
}

// ---------------- Agregar activo ----------------
function dialogoAgregar() {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog" class="form" id="fNuevo">
    <h3>Agregar a tu lista</h3>
    <div class="seg" id="segMercado"><button type="button" data-m="US" class="activa">EE.UU.</button><button type="button" data-m="BMV">BMV</button><button type="button" data-m="CSV">Importar CSV</button></div>
    <div id="pasoMercado"></div>
    <div class="fila fin"><button class="btn sec" value="cancelar" formnovalidate>Cancelar</button></div>
  </form>`;
  const paso = (m) => {
    d.querySelectorAll('#segMercado button').forEach((b) => b.classList.toggle('activa', b.dataset.m === m));
    $('#pasoMercado').innerHTML = m === 'US' ? `
      <label>Símbolo (ticker)<input id="nSim" placeholder="ej. VOO, AAPL, MSFT" autocomplete="off"></label>
      <label>Nombre (opcional)<input id="nNom" placeholder="cómo lo quieres ver"></label>
      <button type="button" class="btn" data-agregar="US">Agregar</button>
      <p class="nota">Muchas acciones de EE.UU. se compran en pesos desde México vía el SIC (GBM, Hapi, Bursanet…).</p>` : m === 'BMV' ? `
      <label>Buscar empresa<div class="fila"><input id="nBus" placeholder="ej. Walmex, Femsa, Naftrac"><button type="button" class="btn sec" data-buscar>Buscar</button></div></label>
      <div id="resBus"></div>
      <p class="nota">Usa Alpha Vantage (25 consultas al día) y trae precios semanales ajustados por dividendos. Si no encuentra una emisora, usa "Importar CSV".</p>` : `
      <label>Símbolo<input id="nSim" placeholder="ej. WALMEX"></label>
      <label>Moneda<select id="nMon"><option>MXN</option><option>USD</option></select></label>
      <label>Archivo CSV<input id="nCsv" type="file" accept=".csv,.txt"></label>
      <button type="button" class="btn" data-agregar="CSV">Importar</button>
      <p class="nota">Descarga el histórico desde Yahoo Finance (pestaña "Historical data") o Investing.com. Se leen las columnas de fecha y cierre.</p>`;
  };
  paso('US');
  d.onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.m) return paso(b.dataset.m);
    if (b.dataset.buscar != null) {
      $('#resBus').innerHTML = '<p class="nota">Buscando…</p>';
      try {
        const r = await API.alphaBuscar($('#nBus').value.trim(), E.ajustes.avKey);
        $('#resBus').innerHTML = r.length ? `<ul class="resultados-busqueda">${r.map((x) => `<li><button type="button" data-elegir="${esc(x.simbolo)}" data-nombre="${esc(x.nombre)}" data-moneda="${esc(x.moneda)}"><b>${esc(x.simbolo)}</b> ${esc(x.nombre)} <small>${esc(x.region)} · ${esc(x.moneda)}</small></button></li>`).join('')}</ul>` : '<p class="vacio">Sin resultados.</p>';
      } catch (e) { $('#resBus').innerHTML = `<p class="banner error">${esc(e.message)}</p>`; }
      return;
    }
    if (b.dataset.elegir) { await agregar({ simbolo: b.dataset.elegir, nombre: b.dataset.nombre, mercado: b.dataset.moneda === 'MXN' ? 'BMV' : 'US', fuente: 'av' }); d.close(); return; }
    if (b.dataset.agregar === 'US') {
      const s = $('#nSim').value.trim().toUpperCase(); if (!s) return;
      await agregar({ simbolo: s, nombre: $('#nNom').value.trim() || s, mercado: 'US', fuente: 'td' }); d.close(); return;
    }
    if (b.dataset.agregar === 'CSV') {
      const s = $('#nSim').value.trim().toUpperCase(); const f = $('#nCsv').files[0];
      if (!s || !f) return aviso('Pon el símbolo y elige el archivo.', 'error');
      try {
        const serie = API.leerCSV(await f.text());
        const a = await agregar({ simbolo: s, nombre: s, mercado: $('#nMon').value === 'MXN' ? 'BMV' : 'US', fuente: 'csv' }, false);
        series[a.id] = { serie, moneda: $('#nMon').value, fuente: `CSV (${f.name})`, actualizado: Date.now() };
        await store.saveSerie(a.id, series[a.id]);
        aviso(`${s}: ${serie.length} precios importados.`); d.close(); render();
      } catch (e) { aviso(e.message, 'error'); }
    }
  };
  d.showModal();
}

async function agregar(a, descargar = true) {
  const id = a.simbolo.replace(/[^\w.-]/g, '_');
  const ex = E.lista.find((x) => x.id === id);
  if (ex) { aviso(`${a.simbolo} ya está en tu lista.`); return ex; }
  const nuevo = { id, ...a }; E.lista.push(nuevo); guardar(); render();
  if (descargar) { estado(`Descargando ${a.simbolo}…`); await cargarActivo(nuevo, true); estado(''); render(); }
  return nuevo;
}

// ---------------- Eventos ----------------
document.addEventListener('click', async (ev) => {
  if (vista === 'ranking' && eventosRanking(ev, ctx()) !== false) return;
  const b = ev.target.closest('[data-vista],[data-abrir],[data-ir],[data-rango],[data-orden],[data-quitar],[data-accion],[data-borrarop]');
  if (!b || b.closest('#dlg')) return;
  if (b.tagName === 'A') ev.preventDefault();
  if (b.dataset.vista) { vista = b.dataset.vista; render(); window.scrollTo(0, 0); }
  else if (b.dataset.ir) { vista = b.dataset.ir; render(); }
  else if (b.dataset.abrir) { seleccion = b.dataset.abrir; vista = 'detalle'; render(); window.scrollTo(0, 0); }
  else if (b.dataset.rango) { rango = Number(b.dataset.rango); render(); }
  else if (b.dataset.orden) { ordenarPor = b.dataset.orden; render(); }
  else if (b.dataset.quitar) {
    if (!confirm(`¿Quitar ${b.dataset.quitar} de tu lista?`)) return;
    E.lista = E.lista.filter((a) => a.id !== b.dataset.quitar); delete series[b.dataset.quitar];
    store.deleteSerie(b.dataset.quitar).catch(() => {}); guardar(); vista = 'resumen'; render();
  } else if (b.dataset.borrarop) {
    E.practica.ops = E.practica.ops.filter((o) => o.id !== b.dataset.borrarop); guardar(); render();
  } else if (b.dataset.accion === 'nuevo') dialogoAgregar();
  else if (b.dataset.accion === 'exportar') {
    const blob = new Blob([JSON.stringify({ ...E, ajustes: { ...E.ajustes, tdKey: '', avKey: '', bxToken: '' } }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `inversiones_${hoy()}.json`; a.click();
  } else if (b.dataset.accion === 'forzar') actualizarTodo(true);
  else if (b.dataset.accion === 'releerPlan') { lecturaPlan = null; render(); cargarPlan(); }
  else if (b.dataset.accion === 'simularCap') {
    const c = cap(); const ap = !E.decisiones.perfil.experiencia || E.decisiones.perfil.experiencia === 'nada';
    sim.mensual = Math.round((c.mensualF2 * (E.decisiones.pctBolsa ?? 20) / 100) / (ap ? 2 : 1) / 100) * 100; sim.anios = 5; vista = 'simulador'; render(); window.scrollTo(0, 0);
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (vista === 'ranking' && eventosRanking(ev, ctx())) return;
  if (t.id === 'selActivo') { seleccion = t.value; render(); }
  else if (t.dataset.comp) { t.checked ? comparar.add(t.dataset.comp) : comparar.delete(t.dataset.comp); render(); }
  else if (t.closest('#fSim')) { const f = new FormData(t.form); sim = { id: f.get('id'), mensual: +f.get('mensual') || 0, inicial: +f.get('inicial') || 0, anios: +f.get('anios') }; render(); }
  else if (t.id === 'selTema') { try { localStorage.setItem('inv_tema', t.value); } catch {} document.documentElement.dataset.theme = t.value; window.lluviaRefrescar?.(); render(); }
  else if (t.id === 'chkLluvia') { try { localStorage.setItem('inv_lluvia', t.checked ? '1' : '0'); } catch {} window.lluviaRefrescar?.(); }
  else if (t.id === 'inpInicial') { E.practica.inicial = Number(t.value) || 0; guardar(); render(); }
  else if (t.id === 'inpRestaurar' && t.files[0]) {
    try {
      const j = JSON.parse(await t.files[0].text());
      if (!Array.isArray(j.lista)) throw new Error('Archivo no válido.');
      E = { ...PREDETERMINADO(), ...j, ajustes: { ...E.ajustes, ...j.ajustes, tdKey: E.ajustes.tdKey, avKey: E.ajustes.avKey, bxToken: E.ajustes.bxToken } };
      guardar(); aviso('Respaldo restaurado.'); actualizarTodo();
    } catch (e) { aviso(e.message, 'error'); }
  }
});

document.addEventListener('submit', async (ev) => {
  const f = ev.target;
  if (f.id === 'fAjustes') {
    ev.preventDefault(); const d = new FormData(f); const antes = { ...E.ajustes };
    E.ajustes = { ...E.ajustes, tdKey: d.get('tdKey').trim(), avKey: d.get('avKey').trim(), bxToken: d.get('bxToken').trim(), serieCetes: d.get('serieCetes').trim() || API.SERIES_BANXICO.cetes28, cetesManual: Number(d.get('cetesManual')) || 0, horas: Math.max(1, Number(d.get('horas')) || 12), enPesos: d.get('enPesos') === 'on' };
    guardar(); aviso('Ajustes guardados.');
    const cambioLlaves = ['tdKey', 'avKey', 'bxToken', 'serieCetes'].some((k) => antes[k] !== E.ajustes[k]);
    if (cambioLlaves) actualizarTodo(true); else render();
  } else if (f.id === 'fOp') {
    ev.preventDefault(); const d = new FormData(f);
    const id = d.get('activo'); const s = serieDe(id);
    if (!s) return aviso('Ese activo no tiene precios todavía.', 'error');
    const p = M.precioEn(s.serie, Date.parse(d.get('fecha') + 'T00:00:00Z'));
    if (!p) return aviso('No hay precio para esa fecha.', 'error');
    let cant = Number(d.get('cantidad')) || 0; const monto = Number(d.get('monto')) || 0;
    if (!cant && monto) cant = monto / p.c;
    if (!(cant > 0)) return aviso('Pon un monto o una cantidad.', 'error');
    const P = portafolio();
    if (d.get('tipo') === 'compra' && cant * p.c > P.efectivo + 0.01) return aviso(`No te alcanza: tienes ${dinero(P.efectivo, 'MXN', 0)} de efectivo de práctica.`, 'error');
    const tienes = P.filas.find((x) => x.id === id)?.cant || 0;
    if (d.get('tipo') === 'venta' && cant > tienes + 1e-9) return aviso(`Solo tienes ${tienes.toFixed(4)} títulos.`, 'error');
    E.practica.ops.push({ id: uid(), fecha: p.d, activo: id, tipo: d.get('tipo'), cantidad: cant, precio: p.c, motivo: (d.get('motivo') || '').trim() });
    guardar(); aviso(`${d.get('tipo') === 'compra' ? 'Compra' : 'Venta'} registrada: ${cant.toFixed(4)} de ${nombreDe(id)} a ${dinero(p.c)} (${fechaLarga(p.d)}).`); render();
  }
});

let anchoPrevio = innerWidth;
addEventListener('resize', () => { if (Math.abs(innerWidth - anchoPrevio) > 40) { anchoPrevio = innerWidth; render(); } });

// ---------------- Inicio ----------------
async function iniciar(user) {
  if (!user) { $('#login').hidden = false; $('#app').hidden = true; return; }
  $('#login').hidden = true; $('#app').hidden = false;
  if (store.modo !== 'local') $('#usuario').textContent = user.email;
  try {
    const d = await store.load();
    if (d) E = { ...PREDETERMINADO(), ...d, ajustes: { ...PREDETERMINADO().ajustes, ...d.ajustes }, practica: { ...PREDETERMINADO().practica, ...d.practica }, decisiones: { ...DECISIONES_DEFAULT(), ...d.decisiones } };
    else await store.save(E);
  } catch (e) { aviso('No se pudieron leer tus datos: ' + e.message, 'error', 8000); }
  render();
  cargarPlan();
  actualizarTodo();
}

$('#btnLogin').onclick = () => store.signIn().catch((e) => { $('#loginError').textContent = e.message; });
$('#btnSalir').onclick = () => store.signOut();
$('#btnActualizar').onclick = () => actualizarTodo(true);
store.init(iniciar, (m) => { $('#loginError').textContent = m; }).catch((e) => { $('#loginError').textContent = 'Error al iniciar: ' + e.message; });
if (store.modo === 'local') { $('#modo').textContent = 'modo local'; $('#usuario').hidden = true; $('#btnSalir').hidden = true; }
