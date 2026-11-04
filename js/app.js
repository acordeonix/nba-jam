import { calcularTodo, mIdx, mKey, CATEGORIAS, REGLAS_BASE, categorizar, catById, cierreMes, historialCierres } from './engine.js';
import { crearStore, KEYS, mensajeAuth } from './store.js';
import { money, money2, pct, int, mes, mesLargo, dia, esc, hoyISO, uid, getPath, setPath } from './format.js';
import { SECCIONES_DATOS, CAMPOS_METAS, CAMPOS_SUENOS, CAMPOS_RETIRO, CONSEJOS_BASE, datosEjemplo } from './schema.js';

const store = crearStore();
const HOY = new URLSearchParams(location.search).get('hoy') || hoyISO();
let state = null, R = null, charts = [], semSel = null, saveTimer = null, filtroPend = 'todos';

const VIEWS = [
  { id: 'inicio', t: 'Inicio', g: 'sem' }, { id: 'semana', t: 'Semana', g: 'sem' }, { id: 'tarjetas', t: 'Tarjetas y cargos', g: 'sem' }, { id: 'suscripciones', t: 'Suscripciones', g: 'sem' },
  { id: 'cierre', t: 'Cierre del mes', g: 'mes' }, { id: 'simulador', t: 'Simulador y balance', g: 'mes' }, { id: 'plan', t: 'Plan y línea de tiempo', g: 'mes' }, { id: 'seguimiento', t: 'Plan vs real', g: 'mes' },
  { id: 'presupuesto', t: 'Presupuesto', g: 'mes' }, { id: 'pendientes', t: 'Pendientes', g: 'mes' },
  { id: 'metas', t: 'Casa y auto', g: 'fut' }, { id: 'suenos', t: 'Sueños', g: 'fut' }, { id: 'retiro', t: 'Retiro', g: 'fut' }, { id: 'escenarios', t: 'Escenarios', g: 'fut' },
  { id: 'datos', t: 'Datos y respaldo', g: 'cfg' },
];
const GRUPOS = { sem: 'Cada semana', mes: 'Cada mes', fut: 'Tu futuro', cfg: 'Configuración' };
const PAL = {
  dark: { navy: '#7FB2F0', blue: '#4A86C5', green: '#5CC86A', red: '#FF7A6E', orange: '#F5A04A', light: '#9FB7D9', gray: '#8A93A0', purple: '#C08AE8' },
  matriz: { navy: '#00FF66', blue: '#33D6FF', green: '#7DFF9E', red: '#FF5A4E', orange: '#F2D14A', light: '#B8FF5C', gray: '#1FA24C', purple: '#FF9DF0' },
  light: { navy: '#1F3A5F', blue: '#3C6E9F', green: '#2E7D32', red: '#C0392B', orange: '#E67E22', light: '#8FAADC', gray: '#8A8F98', purple: '#7B3FA0' },
};
const tema = () => { const t = document.documentElement.dataset.theme; return t === 'light' || t === 'matriz' ? t : 'dark'; };
let C = PAL[tema()];

// ---------------- utilidades de UI ----------------
const $ = (s) => document.querySelector(s);
function setStatus(t, cls = '') { const el = $('#sync'); if (el) { el.textContent = t; el.className = 'sync ' + cls; } }
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600); }
const kpi = (label, value, sub = '', tone = '') => `<div class="kpi ${tone}"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ''}</div>`;
const badge = (txt, tone) => `<span class="badge ${tone}">${esc(txt)}</span>`;
const card = (titulo, body, extra = '') => `<section class="card ${extra}">${titulo ? `<h3>${titulo}</h3>` : ''}${body}</section>`;
const tabla = (heads, rows, cls = '') => `<div class="tw"><table class="${cls}"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const tr = (cells, cls = '') => `<tr class="${cls}">${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;

function inputFor(path, type, value, extra = {}) {
  const attrs = `data-path="${path}" data-type="${type}" ${extra.ph !== undefined ? `placeholder="${esc(extra.ph)}"` : ''}`;
  if (type === 'month') return `<input type="month" ${attrs} value="${esc(value || '')}">`;
  if (type === 'date') return `<input type="date" ${attrs} value="${esc(value || '')}">`;
  if (type === 'text') return `<input type="text" ${attrs} value="${esc(value ?? '')}">`;
  if (type === 'sino') return `<select ${attrs}><option value="1" ${Number(value) === 1 ? 'selected' : ''}>Sí</option><option value="0" ${Number(value) !== 1 ? 'selected' : ''}>No</option></select>`;
  if (type === 'select') return `<select ${attrs}>${(extra.opts || []).map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const isPct = type === 'pct' || type === 'pct2';
  const v = value === null || value === undefined || value === '' ? '' : (isPct ? +(Number(value) * 100).toFixed(4) : value);
  return `<div class="num ${isPct ? 'is-pct' : (type.startsWith('money') ? 'is-money' : '')}"><input type="number" step="any" inputmode="decimal" ${attrs} value="${esc(v)}"></div>`;
}
function formGrid(campos, base = 'datos') {
  return `<div class="form">${campos.map(([p, l, t, help, opts]) => `<label class="f"><span>${l}</span>${inputFor(`${base}.${p}`, t, getPath(state[base], p), { opts })}${help ? `<small>${help}</small>` : ''}</label>`).join('')}</div>`;
}
function parseVal(type, raw) {
  if (['month', 'date', 'text'].includes(type)) return raw === '' ? null : raw;
  if (type === 'sino' || type === 'int' || type === 'select') return raw === '' ? null : Number(raw);
  if (raw === '' || raw === null) return null;
  const n = Number(raw); if (isNaN(n)) return null;
  return type === 'pct' || type === 'pct2' ? n / 100 : n;
}

// ---------------- gráficas ----------------
function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }
function mkChart(id, cfg) {
  const el = document.getElementById(id); if (!el || !window.Chart) return;
  const t = tema(), dark = t !== 'light';
  const grid = t === 'matriz' ? 'rgba(0,255,102,.12)' : dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)', txt = t === 'matriz' ? '#33ff77' : dark ? '#cfd6df' : '#4a5563';
  window.Chart.defaults.font.family = t === 'matriz' ? '"Share Tech Mono", ui-monospace, Consolas, monospace' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y ?? c.parsed)}` } } },
    scales: cfg.type === 'doughnut' ? {} : { x: { ticks: { color: txt }, grid: { color: grid } }, y: { ticks: { color: txt, callback: (v) => money(v) }, grid: { color: grid } } } }, cfg.options || {});
  charts.push(new window.Chart(el, cfg));
}
const ds = (label, data, color, o = {}) => Object.assign({ label, data, borderColor: color, backgroundColor: color + '33', tension: 0.25, pointRadius: 2, borderWidth: 2, spanGaps: false }, o);
const canvas = (id, h = 260) => `<div class="chart" style="height:${h}px"><canvas id="${id}"></canvas></div>`;

// ---------------- vistas ----------------
const V = {};

V.inicio = () => {
  const P = R.P, h = P.hitos, TJ = R.TJ, B = R.SIM.balance;
  const deudaReal = TJ.reduce((s, t) => s + (t.ultimoSaldo ?? t.saldoInicial), 0);
  const ultA = [...R.SEM].reverse().find((s) => s.saldoAhorroEf !== null);
  const ahorroReal = ultA ? ultA.saldoAhorroEf : P.X.colchonInicial;
  const sa = P.semaforoAcordeonix;
  const sems = [
    ['Deuda de tarjetas (real)', money(deudaReal), deudaReal <= 0 ? ['Libre', 'ok'] : (deudaReal <= P.X.deudaTotal ? ['Bajando', 'ok'] : ['Subió', 'bad'])],
    ['Ahorro real (último)', money(ahorroReal), ahorroReal >= P.X.metaFondo ? ['Colchón completo', 'ok'] : [`${pct(ahorroReal / P.X.metaFondo)} de la meta`, 'warn']],
    [`Balance de ${mes(B.mes)}`, money(B.balance), B.balance >= B.ideal ? ['Vas bien', 'ok'] : (B.balance >= B.minimo ? ['Justo', 'warn'] : ['No alcanza', 'bad'])],
    ['Regreso a Acordeonix', mes(state.datos.acordeonix.mesRegreso), sa.listo ? ['LISTO', 'ok'] : ['AÚN NO', 'bad']],
    ['Casa meta lista en', mes(R.MT.casaLista), [state.datos.metas.usarCredito === 2 ? 'Crédito completo' : 'Crédito prudente', 'neutral']],
  ];
  const html = `
  <div class="kpis">
    ${kpi('Deuda real de tarjetas', money(deudaReal), `inicial ${money(P.X.deudaTotal)}`, deudaReal > P.X.deudaTotal ? 'bad' : '')}
    ${kpi('Patrimonio neto hoy', money(h.patrimonioHoy), '', h.patrimonioHoy < 0 ? 'bad' : 'ok')}
    ${kpi('Libre de tarjetas', mes(h.libreTarjetas), 'según el plan')}
    ${kpi('Fondo de emergencia completo', mes(h.fondoCompleto), `meta ${money(P.X.metaFondo)}`)}
    ${kpi('Patrimonio al final del plan', money(h.patrimonioFinal), mes(P.filas[P.filas.length - 1].mes), 'ok')}
    ${kpi('Casa meta lista', mes(R.MT.casaLista), `hoy podrías comprar ${money(R.MT.hoyCasa)}`)}
  </div>
  <div class="grid2">
    ${card('Semáforos', `<div class="sems">${sems.map(([l, v, [t, tone]]) => `<div class="sem"><span>${l}</span><b>${v}</b>${badge(t, tone)}</div>`).join('')}</div>`)}
    ${card('Rutina del viernes (10 min)', `<ol class="rutina"><li><a href="#semana">Semana</a>: ingreso, gastos y saldo de cada tarjeta.</li><li><a href="#tarjetas">Tarjetas</a>: anota cargos nuevos si hubo.</li><li>Revisa aquí los semáforos.</li><li>Fin de mes: <a href="#simulador">balance mensual</a>.</li></ol>
      <p class="muted">Esta semana te toca apartar <b>${money(R.SEM.find((s) => s.fecha <= HOY && s.fecha > addD(HOY, -7))?.ahorroSug ?? R.pres.f1.colchon)}</b> de ahorro y mandar <b>${money(R.SEM.find((s) => s.fecha <= HOY && s.fecha > addD(HOY, -7))?.tarjetasSug ?? 0)}</b> a tarjetas.</p>`)}
  </div>
  <div class="grid2">
    ${card('Patrimonio neto: del déficit al superávit', canvas('c-patr'))}
    ${card('Tarjetas, terreno y ahorro', canvas('c-deuda'))}
  </div>
  <div class="grid2">
    ${card('Ahorro acumulado: emergencia + reinversión', canvas('c-ahorro'))}
    ${card('¿A dónde va tu sueldo? (Fase 1, mensual)', canvas('c-pie'))}
  </div>`;
  return { html, after: () => {
    const pts = P.puntos, labs = pts.map((p) => dia(p.fecha));
    mkChart('c-patr', { type: 'line', data: { labels: labs, datasets: [ds('Patrimonio neto', pts.map((p) => p.patrimonio), C.navy, { borderWidth: 3 }), ds('Sin Acordeonix', pts.map((p) => p.sinAcordeonix), C.light, { borderDash: [4, 4], pointRadius: 0 }), ds('Cero', pts.map(() => 0), C.red, { borderDash: [6, 4], pointRadius: 0, borderWidth: 1 })] } });
    mkChart('c-deuda', { type: 'line', data: { labels: labs, datasets: [ds('Tarjetas', pts.map((p) => p.deuda), C.red), ds('Terreno', pts.map((p) => p.terreno), C.orange), ds('Préstamo NU', pts.map((p) => p.prestamo), C.purple), ds('Ahorro', pts.map((p) => p.ahorro), C.green)] } });
    mkChart('c-ahorro', { type: 'bar', data: { labels: P.filas.map((r) => mes(r.mes)), datasets: [ds('Fondo de emergencia', P.filas.map((r) => r.fondoEmergencia), C.blue, { backgroundColor: C.blue }), ds('Reinversión Acordeonix', P.filas.map((r) => r.reinversion), C.red, { backgroundColor: C.red })] }, options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => money(v) } } } } });
    const f = R.pres.f1, k = 52 / 12;
    const parts = [['Casa (Jazmín)', f.jazmin], ['Gasolina', f.gasolina], ['Renta', f.renta], ['Escuela', f.escuela], ['Otros', f.otros], ['Colchón', f.colchon], ['Temporada', f.estacionales], ['Autos', R.pres.autosW], ['Préstamo NU', R.pres.prestamoW], ['Suscripciones', R.pres.subsW], ['Tarjetas', Math.max(0, f.plan)]];
    mkChart('c-pie', { type: 'doughnut', data: { labels: parts.map((p) => p[0]), datasets: [{ data: parts.map((p) => p[1] * k), borderColor: tema() === 'matriz' ? '#000' : tema() === 'dark' ? '#161b22' : '#fff', backgroundColor: tema() === 'matriz' ? ['#00FF66', '#33D6FF', '#F2D14A', '#B8FF5C', '#FF9DF0', '#7DFF9E', '#00A845', '#2BB8A0', '#FF5A4E', '#1FA24C', '#C8FFD8'] : tema() === 'dark' ? ['#4A86C5', '#7FB2F0', '#9FB7D9', '#5DB8B6', '#F5A04A', '#5CC86A', '#D4C35A', '#C08AE8', '#C77B7B', '#8A93A0', '#FF7A6E'] : ['#1F3A5F', '#3C6E9F', '#8FAADC', '#5DA5A4', '#E67E22', '#2E7D32', '#B5A642', '#7B3FA0', '#A05252', '#8A8F98', '#C0392B'] }] }, options: { plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } } } } });
  } };
};
const addD = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

V.semana = () => {
  const S = R.SEM;
  if (!semSel) { const cur = [...S].reverse().find((s) => s.fecha <= HOY); semSel = (cur || S[0]).fecha; }
  const i = S.findIndex((s) => s.fecha === semSel), s = S[i];
  const cortos = state.datos.deudas.map((d) => d.nombre.replace('Tarjeta ', ''));
  const f = (field, label, type = 'money', ph) => `<label class="f"><span>${label}</span>${inputSem(field, type, getPath(s, field), ph)}</label>`;
  const hist = S.filter((x) => x.tiene || x.deudaReal !== null);
  const html = `
  <div class="weeknav"><button class="btn" data-action="semPrev" ${i <= 0 ? 'disabled' : ''}>◀</button>
    <select data-action="semSel">${S.map((x) => `<option value="${x.fecha}" ${x.fecha === semSel ? 'selected' : ''}>Semana del ${dia(x.fecha)}${x.tiene ? ' ✓' : ''}</option>`).join('')}</select>
    <button class="btn" data-action="semNext" ${i >= S.length - 1 ? 'disabled' : ''}>▶</button> ${badge(s.fase, s.fase.startsWith('1') ? 'warn' : 'ok')}</div>
  <div class="grid2">
    ${card('1 · Ingreso y gastos de la semana', `<div class="form">
      ${f('ingreso', 'Ingreso (nómina + extras)')}${f('jazmin', 'Jazmín (casa)')}${f('gasolina', 'Gasolina')}${f('renta', 'Renta')}${f('escuela', 'Escuela Ivana')}
      ${f('otros', 'Otros (familia)')}${f('estacionales', 'Temporada / imprevistos')}${f('terreno', 'Pago terreno')}
      ${f('tarjetas', 'Pagos a tarjetas + préstamo', 'money', `sugerido ${Math.round(s.tarjetasSug)}`)}${f('ahorro', 'Ahorro apartado', 'money', `sugerido ${Math.round(s.ahorroSug)}`)}
      <label class="f full"><span>Notas</span>${inputSem('notas', 'text', s.notas)}</label></div>`)}
    <div>
    ${card('2 · Saldo de cada tarjeta (de tu app)', `<div class="form">${cortos.map((c) => f(`saldos.${c}`, c)).join('')}
      <label class="f"><span>Saldo de tu ahorro (colchón)</span>${inputSem('saldoAhorro', 'money', s.saldoAhorro, s.saldoAhorroEf !== null ? `estimado ${Math.round(s.saldoAhorroEf)}` : '')}</label></div>`)}
    ${card('Resultado de la semana', `<div class="mini">
      <div><span>Sugerido ahorrar</span><b>${money(s.ahorroSug)}</b></div><div><span>Sugerido a tarjetas + préstamo</span><b>${money(s.tarjetasSug)}</b></div>
      <div><span>Sobrante en cuenta</span><b class="${s.sobrante < 0 ? 'neg' : ''}">${money(s.sobrante)}</b></div><div><span>Saldo en cuenta al final</span><b class="${s.saldoCuenta < 0 ? 'neg' : ''}">${money(s.saldoCuenta)}</b></div>
      <div><span>Cargos nuevos a tarjeta</span><b class="${s.cargosSemana > 0 ? 'neg' : ''}">${money(s.cargosSemana)}</b></div><div><span>Deuda total real</span><b>${money(s.deudaReal)}</b></div></div>
      <p class="muted">Si dejas vacíos "pagos a tarjetas" y "ahorro", se toman los sugeridos al capturar el ingreso. Renta y escuela van completas en la semana que las pagas.</p>`)}
    </div>
  </div>
  ${card('Semanas capturadas', tabla(['Semana', 'Ingreso', 'Gastos', 'Tarjetas', 'Ahorro', 'Sobrante', 'Saldo cuenta', 'Deuda real', 'Ahorro real'],
    hist.map((x) => tr([`<a href="#semana" data-action="goSem" data-fecha="${x.fecha}">${dia(x.fecha)}</a>`, money(x.ingreso), money(['jazmin', 'gasolina', 'renta', 'escuela', 'otros', 'estacionales', 'terreno'].reduce((a, c) => a + (Number(x[c]) || 0), 0)),
      money(x.tarjetasEf), money(x.ahorroEf), money(x.sobrante), money(x.saldoCuenta), money(x.deudaReal), money(x.saldoAhorroEf)])), 'num'))}`;
  return { html };
};
function inputSem(field, type, value, ph) {
  const v = value === null || value === undefined ? '' : value;
  if (type === 'text') return `<input type="text" data-sem="${semSel}" data-field="${field}" value="${esc(v)}">`;
  return `<div class="num is-money"><input type="number" step="any" inputmode="decimal" data-sem="${semSel}" data-field="${field}" value="${esc(v)}" ${ph ? `placeholder="${esc(ph)}"` : ''}></div>`;
}

V.tarjetas = () => {
  const TJ = R.TJ, tarjetas = state.datos.deudas.map((d) => d.nombre);
  const cargos = [...state.cargos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const html = `
  <div class="kpis">${TJ.map((t) => kpi(t.nombre, money(t.ultimoSaldo ?? t.saldoInicial), `${t.fechaSaldo ? 'al ' + dia(t.fechaSaldo) : 'saldo inicial'} · paga en ${t.dias ?? '—'} días${t.proximaFecha ? ' (' + dia(t.proximaFecha) + ')' : ''}`, t.dias !== null && t.dias <= 5 ? 'bad' : '')).join('')}</div>
  ${card('Resumen por tarjeta', tabla(['Tarjeta', 'Saldo inicial', 'Cargos nuevos', 'Último saldo real', 'Fecha', 'Mínimo', 'Corte', 'Límite', 'Próximo pago', 'Días'],
    TJ.map((t) => tr([t.nombre, money(t.saldoInicial), money(t.cargos), money(t.ultimoSaldo), dia(t.fechaSaldo), money(t.minimo), int(t.corte), int(t.limite), dia(t.proximaFecha), t.dias === null ? '—' : `<b class="${t.dias <= 5 ? 'neg' : ''}">${t.dias}</b>`])), 'num'),
    '')}
  ${card('Agregar cargo nuevo', `<div class="form inline">
    <label class="f"><span>Fecha</span><input type="date" id="nc-fecha" value="${HOY}"></label>
    <label class="f"><span>Tarjeta</span><select id="nc-tarjeta">${tarjetas.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
    <label class="f"><span>Concepto</span><input type="text" id="nc-concepto" placeholder="Ej. Spotify"></label>
    <label class="f"><span>Tipo</span><select id="nc-tipo"><option>Compra</option><option>Suscripción</option><option>Comisión / interés</option><option>Otro</option></select></label>
    <label class="f"><span>Monto</span><div class="num is-money"><input type="number" step="any" id="nc-monto"></div></label>
    <button class="btn primary" data-action="addCargo">Agregar</button></div>
    <p class="muted">Se suma a la deuda del plan en su mes. Si lo pagaste con "otros", pon el monto en 0.</p>`)}
  ${card(`Cargos nuevos (${cargos.length})`, tabla(['Fecha', 'Tarjeta', 'Concepto', 'Tipo', 'Monto', ''], cargos.map((c) => tr([
    `<input type="date" data-col="cargos" data-id="${c.id}" data-field="fecha" value="${esc(c.fecha)}">`,
    `<select data-col="cargos" data-id="${c.id}" data-field="tarjeta">${tarjetas.map((t) => `<option ${t === c.tarjeta ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`,
    `<input type="text" data-col="cargos" data-id="${c.id}" data-field="concepto" value="${esc(c.concepto)}">`,
    `<select data-col="cargos" data-id="${c.id}" data-field="tipo">${['Compra', 'Suscripción', 'Comisión / interés', 'Otro'].map((t) => `<option ${t === c.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>`,
    `<div class="num is-money"><input type="number" step="any" data-col="cargos" data-id="${c.id}" data-field="monto" data-type="money" value="${esc(c.monto)}"></div>`,
    `<button class="btn ghost" data-action="del" data-col="cargos" data-id="${c.id}" title="Borrar">✕</button>`])), 'edit'))}`;
  return { html };
};

V.suscripciones = () => {
  const SR = R.SR, subs = state.suscripciones;
  const medios = [...state.datos.deudas.map((d) => d.nombre), 'Débito / efectivo'];
  const html = `<div class="kpis">${kpi('Gasto mensual activo', money(SR.mensual), `${money(SR.anual)} al año`)}${kpi('Ahorro si cancelas las marcadas', money(SR.ahorroMarcadas), `${money(SR.ahorroMarcadas * 12)} al año`, 'ok')}${kpi('Ya cancelaste', money(SR.yaCanceladas), 'al mes')}${kpi('Activas en tarjeta', money(SR.enTarjeta), 'al mes')}</div>
  ${card('Tus suscripciones', tabla(['Servicio', 'Se cobra en', 'Monto mensual', 'Día', 'Decisión', 'Cancelada el', 'Estado', ''], subs.map((s) => {
    const estado = s.cancelada ? 'Cancelada' : 'Activa';
    const b = (f, t, v, o) => t === 'sel' ? `<select data-col="suscripciones" data-id="${s.id}" data-field="${f}">${o.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` :
      `<input type="${t}" data-col="suscripciones" data-id="${s.id}" data-field="${f}" ${t === 'number' ? 'step="any" data-type="money"' : ''} value="${esc(v ?? '')}">`;
    return tr([b('servicio', 'text', s.servicio), b('medio', 'sel', s.medio, medios), `<div class="num is-money">${b('monto', 'number', s.monto)}</div>`, b('dia', 'number', s.dia),
      b('decision', 'sel', s.decision, ['Conservar', 'Cancelar', 'Revisar']), b('cancelada', 'date', s.cancelada),
      badge(estado, estado === 'Cancelada' ? 'ok' : (s.decision === 'Cancelar' ? 'bad' : 'neutral')), `<button class="btn ghost" data-action="del" data-col="suscripciones" data-id="${s.id}">✕</button>`]);
  }), 'edit') + `<button class="btn" data-action="addSub">+ Agregar suscripción</button>
  <p class="muted">Las activas se descuentan del plan desde el próximo mes. Las de este mes anótalas como cargo en Tarjetas.</p>`)}`;
  return { html };
};

V.simulador = () => {
  const A = R.SIM.afford, B = R.SIM.balance, D = state.datos;
  const filasB = [['INGRESOS'], ['nomina', 'Nómina (promedio al mes)', 'Ingreso'], ['bonoFondo', 'Bono y fondo de ahorro (repartidos)', 'Ingreso'], ['acordeonix', 'Acordeonix (tu parte)', 'Ingreso'], ['otroIngreso', 'Otro ingreso extra', 'Ingreso'],
    ['GASTOS'], ['casa', 'Casa: Jazmín (servicios, mandado, su gasolina)', 'Necesidad'], ['gasolina', 'Tu gasolina', 'Necesidad'], ['renta', 'Renta', 'Necesidad'], ['escuela', 'Escuela Ivana', 'Necesidad'],
    ['autos', 'Los autos (seguro, refrendo, mantenimiento)', 'Necesidad'], ['terreno', 'Terreno', 'Necesidad'], ['prestamo', 'Préstamo NU', 'Necesidad'], ['temporada', 'Gastos de temporada (promedio)', 'Necesidad'],
    ['otros', 'Otros (familia)', 'Estilo de vida'], ['suscripciones', 'Suscripciones', 'Estilo de vida'], ['vacaciones', 'Vacaciones (fondo)', 'Estilo de vida']];
  const escB = (state.ui && state.ui.escenarioBalance) || {};
  const tone = A.veredicto.startsWith('SÍ') ? 'ok' : (A.veredicto.startsWith('NO') ? 'bad' : 'warn');
  const toneB = B.veredicto.startsWith('VAS') ? 'ok' : (B.veredicto.startsWith('NO') ? 'bad' : 'warn');
  const html = `<div class="grid2">
  ${card('¿Me lo puedo permitir?', `<div class="form">
     <label class="f"><span>Monto del gasto</span>${inputFor('datos.simulador.monto', 'money', D.simulador.monto)}</label>
     <label class="f"><span>¿Cómo lo pagarías?</span>${inputFor('datos.simulador.forma', 'select', D.simulador.forma, { opts: [["De mi 'otros'", "De mi 'otros'"], ['Con tarjeta', 'Con tarjeta'], ['Del ahorro', 'Del ahorro']] })}</label>
     <label class="f"><span>Mes del gasto</span>${inputFor('datos.simulador.mes', 'month', D.simulador.mes || HOY.slice(0, 7))}</label></div>
     <div class="verdict ${tone}">${esc(A.veredicto)}</div>
     <div class="mini"><div><span>Fase ese mes</span><b>${esc(A.fase)}</b></div><div><span>Tu 'otros' del mes</span><b>${money(A.otrosMes)}</b></div><div><span>'Otros' por semana</span><b>${money(A.otrosSem)}</b></div>
     <div><span>% de tu 'otros' del mes</span><b>${pct(A.pct)}</b></div><div><span>Días que retrasa tu plan</span><b>${int(A.dias)}</b></div><div><span>Interés si lo pagas con tarjeta</span><b>${money(A.interes)}</b></div></div>`)}
  ${card('Lista de espera (regla de 48 horas)', tabla(['Lo que quiero', 'Precio', 'Lo quise el', 'Decidir desde', '¿Lo sigo queriendo?', 'Decisión', ''], (state.listaEspera || []).map((x, k) => tr([
      `<input type="text" data-lista="listaEspera" data-k="${k}" data-field="cosa" value="${esc(x.cosa)}">`, `<div class="num is-money"><input type="number" step="any" data-lista="listaEspera" data-k="${k}" data-field="precio" data-type="money" value="${esc(x.precio ?? '')}"></div>`,
      `<input type="date" data-lista="listaEspera" data-k="${k}" data-field="fecha" value="${esc(x.fecha || '')}">`, x.fecha ? dia(addD(x.fecha, 2)) : '—',
      `<select data-lista="listaEspera" data-k="${k}" data-field="sigo"><option></option>${['Sí', 'No'].map((o) => `<option ${o === x.sigo ? 'selected' : ''}>${o}</option>`).join('')}</select>`,
      `<select data-lista="listaEspera" data-k="${k}" data-field="decision"><option></option>${['Comprar', 'Esperar al siguiente mes', 'No comprar'].map((o) => `<option ${o === x.decision ? 'selected' : ''}>${o}</option>`).join('')}</select>`,
      `<button class="btn ghost" data-action="delLista" data-lista="listaEspera" data-k="${k}">✕</button>`])), 'edit') +
    `<button class="btn" data-action="addEspera">+ Agregar</button><p class="muted">Ahorro por no comprar: <b>${money((state.listaEspera || []).filter((x) => x.decision === 'No comprar').reduce((a, x) => a + (Number(x.precio) || 0), 0))}</b></p>`)}
  </div>
  ${card('Balance mensual: ¿cuánto te debe quedar libre cada mes?', `<div class="form inline"><label class="f"><span>Mes a revisar</span><input type="month" data-ui="mesBalance" value="${esc(B.mes)}"></label><div>${badge(B.fase, B.fase.startsWith('1') ? 'warn' : 'ok')}</div>
    <button class="btn ghost" data-action="limpiarEscenario">Limpiar mi escenario</button></div>
    ${tabla(['Concepto', 'Según tu plan', 'Tu escenario (escribe aquí)', 'Usado', 'Tipo'], filasB.map((f) => f.length === 1 ? `<tr class="sec"><td colspan="5">${f[0]}</td></tr>` :
      tr([f[1], money(B.plan[f[0]]), `<div class="num is-money"><input type="number" step="any" data-esc="${f[0]}" value="${esc(escB[f[0]] ?? '')}"></div>`, `<b>${money(B.usado[f[0]])}</b>`, `<span class="muted">${f[2]}</span>`])).concat([
      tr(['<b>Total ingresos</b>', '', '', `<b>${money(B.ingresos)}</b>`, '']), tr(['<b>Total gastos</b>', '', '', `<b>${money(B.gastos)}</b>`, '']),
      tr(['<b>BALANCE MENSUAL</b>', '', '', `<b class="big ${B.balance < 0 ? 'neg' : ''}">${money(B.balance)}</b>`, pct(B.pctAhorro)], 'total')]), 'num edit')}
    <div class="mini"><div><span>Mínimo indispensable</span><b>${money(B.minimo)}</b></div><div><span>Balance ideal (20%)</span><b>${money(B.ideal)}</b></div><div><span>Diferencia contra el ideal</span><b class="${B.diferencia < 0 ? 'neg' : 'pos'}">${money(B.diferencia)}</b></div></div>
    <div class="verdict ${toneB}">${esc(B.veredicto)}</div>
    ${tabla(['Regla 50/30/20', 'Lo tuyo al mes', '% de tus ingresos', 'Ideal', '¿Cómo vas?'], [
      tr(['Necesidades', money(B.necesidades), pct(B.pctNecesidades), '50% o menos', badge(B.pctNecesidades <= 0.5 ? 'Bien' : 'Revisar', B.pctNecesidades <= 0.5 ? 'ok' : 'bad')]),
      tr(['Estilo de vida', money(B.estilo), pct(B.pctEstilo), '30% o menos', badge(B.pctEstilo <= 0.3 ? 'Bien' : 'Revisar', B.pctEstilo <= 0.3 ? 'ok' : 'bad')]),
      tr(['Ahorro y deudas', money(B.balance), pct(B.pctAhorro), '20% o más', badge(B.pctAhorro >= 0.2 ? 'Bien' : 'Revisar', B.pctAhorro >= 0.2 ? 'ok' : 'bad')])], 'num')}`)}`;
  return { html };
};

V.plan = () => {
  const P = R.P, h = P.hitos, sa = P.semaforoAcordeonix;
  const html = `<div class="kpis">${kpi('Patrimonio neto hoy', money(h.patrimonioHoy), '', 'bad')}${kpi('Libre de tarjetas', mes(h.libreTarjetas))}${kpi('Superávit desde', mes(h.superavit), 'patrimonio > 0', 'ok')}
    ${kpi('Fondo de emergencia completo', mes(h.fondoCompleto))}${kpi('Terreno pagado', mes(h.terrenoPagado))}${kpi('Mejora total', money(h.mejora), 'en el periodo del plan', 'ok')}</div>
  <div class="grid2">${card('Patrimonio neto', canvas('c-patr2'))}${card('Ingreso, gasto y pago a deudas por mes', canvas('c-flujo'))}</div>
  ${card(`Semáforo de regreso a Acordeonix (${mes(state.datos.acordeonix.mesRegreso)}) ${badge(sa.listo ? 'LISTO' : 'AÚN NO', sa.listo ? 'ok' : 'bad')}`, `<div class="mini">
    <div><span>1. Tarjetas en $0</span><b>${sa.tarjetasCero ? 'Sí' : 'No'}</b></div><div><span>2. Fondo de emergencia completo</span><b>${sa.fondoCompleto ? 'Sí' : 'No'}</b></div>
    <div><span>3. Inversión ≤ 50% del fondo de reinversión</span><b>${sa.inversionOk ? 'Sí' : 'No'}</b></div><div><span>Fondo de reinversión disponible</span><b>${money(sa.reinversionDisponible)}</b></div></div>
    <p class="muted">Se ajusta en <a href="#datos">Datos › Regreso a Acordeonix</a>. Intereses que pagarás en el plan: <b>${money(P.interesTotal)}</b>.</p>`)}
  ${card('Plan mes a mes', tabla(['Mes', 'Fase', 'Ingresos', 'Gastos', 'Disponible', 'A deudas', 'Ahorro del mes', 'Ahorro acumulado', 'Fondo emergencia', 'Reinversión', 'Tarjetas', 'Terreno', 'Préstamo', 'Patrimonio'],
    P.filas.map((r) => tr([mes(r.mes), `<span class="fase f${r.fase[0]}">${r.fase}</span>`, money(r.ingresoTotal), money(r.gastoTotal), money(r.disponible), money(r.pagadoDeudas), money(r.ahorroMes), money(r.ahorroAcum), money(r.fondoEmergencia), money(r.reinversion), money(r.deudaCierre), money(r.terrenoSaldo), money(r.prestamoSaldo), `<b class="${r.patrimonio < 0 ? 'neg' : 'pos'}">${money(r.patrimonio)}</b>`])), 'num sticky'))}
  ${card('Calendario de pago por tarjeta', tabla(['Mes', ...state.datos.deudas.map((d) => d.nombre.replace('Tarjeta ', '') + ' (pago / saldo)'), 'Pago total', 'Intereses'],
    P.filas.filter((r) => r.deudaInicio > 0.5).map((r) => tr([mes(r.mes), ...r.tarjetas.map((t) => `${money(t.pago)} / <b>${money(t.final)}</b>`), money(r.pagadoDeudas), money(r.interes)])), 'num'))}`;
  return { html, after: () => {
    const pts = P.puntos;
    mkChart('c-patr2', { type: 'line', data: { labels: pts.map((p) => dia(p.fecha)), datasets: [ds('Patrimonio neto', pts.map((p) => p.patrimonio), C.navy, { borderWidth: 3 }), ds('Sin Acordeonix', pts.map((p) => p.sinAcordeonix), C.light, { borderDash: [4, 4] }), ds('Cero', pts.map(() => 0), C.red, { borderDash: [6, 4], pointRadius: 0, borderWidth: 1 })] } });
    mkChart('c-flujo', { type: 'bar', data: { labels: P.filas.map((r) => mes(r.mes)), datasets: [ds('Ingreso', P.filas.map((r) => r.ingresoTotal), C.navy, { backgroundColor: C.navy }), ds('Gasto', P.filas.map((r) => r.gastoTotal), C.orange, { backgroundColor: C.orange }), ds('Pago a deudas', P.filas.map((r) => r.pagadoDeudas), C.red, { backgroundColor: C.red })] } });
  } };
};

V.seguimiento = () => {
  const SG = R.SG;
  const html = `${card('Plan vs real', canvas('c-seg', 280))}
  ${card('Mes a mes', tabla(['Mes', 'Semanas', 'Ingreso plan / real', 'Gastos plan / real', 'Otros plan / real', 'Pagos plan / real', 'Ahorro mes plan / real', 'Deuda plan / real', 'Ahorro plan / real', 'Patrimonio plan / real', 'Estado'],
    SG.map((g) => tr([mes(g.mes), g.semanas, pr(g.ingresoPlan, g.ingresoReal, true), pr(g.gastosPlan, g.gastosReal, false), pr(g.otrosPlan, g.otrosReal, false), pr(g.pagosPlan, g.pagosReal, true), pr(g.ahorroMesPlan, g.ahorroMesReal, true),
      pr(g.deudaPlan, g.deudaReal, false), pr(g.ahorroPlan, g.ahorroReal, true), pr(g.patrimonioPlan, g.patrimonioReal, true), badge(g.estado, g.estado === 'En plan' ? 'ok' : (g.estado === 'Atrasado' ? 'bad' : 'neutral'))])), 'num'),
    '')}<p class="muted">Lo real se llena solo desde la pantalla Semana (último dato de cada mes). Verde = igual o mejor que el plan.</p>`;
  return { html, after: () => {
    mkChart('c-seg', { type: 'line', data: { labels: SG.map((g) => mes(g.mes)), datasets: [ds('Deuda plan', SG.map((g) => g.deudaPlan), C.red, { borderDash: [5, 4], pointRadius: 0 }), ds('Deuda real', SG.map((g) => g.deudaReal), C.red, { borderWidth: 3 }),
      ds('Ahorro plan', SG.map((g) => g.ahorroPlan), C.green, { borderDash: [5, 4], pointRadius: 0 }), ds('Ahorro real', SG.map((g) => g.ahorroReal), C.green, { borderWidth: 3 })] } });
  } };
};
function pr(p, r, masEsMejor) { if (r === null || r === undefined) return `${money(p)} / <span class="muted">—</span>`; const ok = masEsMejor ? r >= p - 1 : r <= p + 1; return `${money(p)} / <b class="${ok ? 'pos' : 'neg'}">${money(r)}</b>`; }

V.presupuesto = () => {
  const { f1, f2, subsW, autosW, prestamoW, vacW } = R.pres, k = 52 / 12;
  const rows = [['Ingreso nómina', f1.ingreso, f2.ingreso], ['Jazmín (casa)', f1.jazmin, f2.jazmin], ['Gasolina', f1.gasolina, f2.gasolina], ['Renta (apartar)', f1.renta, f2.renta], ['Escuela (apartar)', f1.escuela, f2.escuela],
    ["'Otros' (familia)", f1.otros, f2.otros], ['Colchón mínimo', f1.colchon, f2.colchon], ['Gastos de temporada (apartar)', f1.estacionales, f2.estacionales], ['Terreno (apartar)', f1.terreno, f2.terreno],
    ['Suscripciones', subsW, subsW], ['Autos (apartar)', autosW, autosW], ['Préstamo NU', prestamoW, 0], ['Vacaciones', 0, vacW]];
  const html = card('Lo que apartas cada semana', tabla(['Concepto', 'Fase 1 · semana', 'Fase 1 · mes', 'Fase 2 · semana', 'Fase 2 · mes'],
    rows.map(([l, a, b]) => tr([l, money(a), money(a * k), money(b), money(b * k)])).concat([tr(['<b>A tarjetas (F1) / ahorro e inversión (F2)</b>', `<b>${money(f1.plan)}</b>`, `<b>${money(f1.plan * k)}</b>`, `<b>${money(f2.plan)}</b>`, `<b>${money(f2.plan * k)}</b>`], 'total'),
      tr(['% del ingreso a tu plan', pct(f1.plan / f1.ingreso), '', pct(f2.plan / f2.ingreso), ''])]), 'num') +
    `<p class="muted">Mensual = semanal × 52 / 12. En meses con 5 viernes, la semana extra (menos Jazmín y gasolina, ${money(f1.ingreso - f1.jazmin - f1.gasolina)}) va completa a tu plan.</p>`);
  return { html };
};

V.pendientes = () => {
  const P = state.pendientes || [];
  const vis = P.map((p, k) => ({ ...p, k })).filter((p) => filtroPend === 'todos' || p.estado !== 'Hecho');
  const html = `${card('Tus acciones', `<div class="seg"><button class="btn ${filtroPend === 'todos' ? 'primary' : ''}" data-action="filtro" data-v="todos">Todas (${P.length})</button><button class="btn ${filtroPend === 'falta' ? 'primary' : ''}" data-action="filtro" data-v="falta">Lo que falta (${P.filter((p) => p.estado !== 'Hecho').length})</button></div>` +
    tabla(['#', 'Acción', 'Cuándo', 'Impacto', 'Estado', ''], vis.map((p) => tr([p.k + 1, `<input type="text" data-lista="pendientes" data-k="${p.k}" data-field="accion" value="${esc(p.accion)}">`, `<input type="text" data-lista="pendientes" data-k="${p.k}" data-field="cuando" value="${esc(p.cuando ?? '')}">`, `<span class="muted">${esc(p.impacto ?? '')}</span>`,
      `<select data-lista="pendientes" data-k="${p.k}" data-field="estado">${['Pendiente', 'En proceso', 'Hecho'].map((o) => `<option ${o === p.estado ? 'selected' : ''}>${o}</option>`).join('')}</select>`, `<button class="btn ghost" data-action="delLista" data-lista="pendientes" data-k="${p.k}">✕</button>`], p.estado === 'Hecho' ? 'done' : '')), 'edit') +
    `<button class="btn" data-action="addPend">+ Agregar acción</button>`)}
  ${card('Consejos', `<div class="tips">${(state.consejos || []).map((c) => `<div class="tip"><b>${esc(c.tema)}</b><p>${esc(c.texto)}</p><small>${esc(c.porque || '')}</small></div>`).join('')}</div>`)}`;
  return { html };
};

V.metas = () => {
  const M = R.MT, D = state.datos, a = M.auto;
  const html = `<div class="kpis">${kpi('Hoy podrías comprar una casa de', money(M.hoyCasa), `crédito ${money(M.credito)} + subcuenta`, 'ok')}${kpi('Casa meta lista en', mes(M.casaLista), money(D.metas.precioCasa))}
    ${kpi('Ingreso extra para la casa meta', money(M.extraCasa), 'sin ahorrar más', M.extraCasa > 0 ? 'bad' : 'ok')}${kpi('Enganche del auto listo', M.autoListo === 'no' ? 'No incluido' : mes(M.autoListo), money(D.metas.autoPrecio))}
    ${kpi('Dos metas juntas', pct(M.dosMetasPct), 'de tu ingreso (máx. 40%)', M.dosMetasPct > 0.4 ? 'bad' : 'ok')}</div>
  ${card('Tus datos para casa y auto', formGrid(CAMPOS_METAS))}
  <div class="grid2">
  ${card('Casa', `<div class="mini"><div><span>Pago mensual del crédito que usas</span><b class="${M.pago / M.ingreso > 0.35 ? 'neg' : ''}">${money(M.pago)}</b></div><div><span>Crédito que usas</span><b>${money(M.credito)}</b></div>
    <div><span>Costo total de la casa</span><b>${money(M.costoCasa)}</b></div><div><span>Crédito necesario para la casa meta</span><b>${money(M.creditoNecesario)}</b></div><div><span>Pago de ese crédito</span><b>${money(M.pagoNecesario)} (${pct(M.pctNecesario)})</b></div>
    <div><span>Ingreso que necesitarías</span><b>${money(M.ingresoNecesario)}</b></div><div><span>O enganche extra a ahorrar</span><b>${money(M.engancheExtra)}</b></div><div><span>Más que tu renta actual</span><b>${money(M.masQueRenta)}</b></div></div>`)}
  ${card('Auto', `<div class="mini"><div><span>Enganche</span><b>${money(a.enganche)}</b></div><div><span>Pago mensual</span><b>${money(a.pago)}</b></div><div><span>Costo mensual con seguro</span><b>${money(a.costo)} (${pct(a.pct)})</b></div>
    <div><span>Auto máximo recomendado</span><b>${money(a.maximo)}</b></div><div><span>Ingreso extra para el auto meta</span><b>${money(a.extraNecesario)}</b></div><div><span>Ahorro mensual para metas (desde ${mes(mKey(R.P.filas[R.P.filas.length - 1].idx + 1))})</span><b>${money(M.capacidad)}</b></div></div>`)}
  </div>
  <div class="grid2">${card('Casa: tus recursos vs el costo', canvas('c-casa'))}${card('Auto: ahorro para el enganche', canvas('c-auto'))}</div>`;
  return { html, after: () => {
    const T = M.tabla.filter((_, k) => k % 3 === 0);
    mkChart('c-casa', { type: 'line', data: { labels: T.map((t) => mes(mKey(t.idx))), datasets: [ds('Recursos (ahorro + subcuenta + crédito)', T.map((t) => t.recursos), C.green, { pointRadius: 0 }), ds('Costo total de la casa', T.map(() => M.costoCasa), C.red, { borderDash: [6, 4], pointRadius: 0 }), ds('Subcuenta Infonavit', T.map((t) => t.subcuenta), C.light, { pointRadius: 0 })] } });
    mkChart('c-auto', { type: 'line', data: { labels: T.map((t) => mes(mKey(t.idx))), datasets: [ds('Ahorro para el auto', T.map((t) => t.auto), C.orange, { pointRadius: 0 }), ds('Enganche necesario', T.map(() => M.auto.enganche), C.gray, { borderDash: [6, 4], pointRadius: 0 })] } });
  } };
};

V.suenos = () => {
  const S = R.SU, D = state.datos;
  const html = `${card('Supuestos', formGrid(CAMPOS_SUENOS) + `<p class="muted">Lo que te deja hoy cada acordeón (tu parte): <b>${money(S.perUnit)}</b>.</p>`)}
  ${card('¿Cuánto necesitas ganar según el año en que quieres cumplirlo?', tabla(['Año (julio)', 'Subcuenta', 'Pago casa', 'Costo auto', 'Ingreso: casa + auto', 'Ingreso: solo casa', 'Tu nómina proyectada', 'Acordeonix: casa + auto', 'Acordeonix: solo casa', 'Acordeones/mes: casa + auto', 'Acordeones/mes: solo casa'],
    S.anos.map((a) => tr([a.anio, money(a.subcuenta), money(a.pagoCasa), money(a.autoCosto), money(a.ingresoCasaAuto), money(a.ingresoCasa), money(a.nomina), `<b class="neg">${money(a.acordeonixCasaAuto)}</b>`, `<b class="neg">${money(a.acordeonixCasa)}</b>`, a.acordeonesCasaAuto, a.acordeonesCasa])), 'num'))}
  ${card(`¿Qué tendría que cambiar en Acordeonix? (meta ${D.suenos.anioMeta}${D.suenos.conAuto === 1 ? ', con auto' : ', solo casa'}: ${money(S.necesario)} al mes)`, tabla(['Escenario', 'Precio', 'Costo', 'Reserva', 'Tu parte', 'Te deja por acordeón', 'Acordeones al mes', 'Ventas al mes'],
    S.escenarios.map((e, k) => {
      const inp = (f, t) => e.vinculado && (f !== 'reserva' || k === 0) ? (t === 'pct' ? pct(e[f]) : money(e[f])) : inputFor(`datos.suenos.escenarios.${k}.${f}`, t, D.suenos.escenarios[k][f]);
      return tr([esc(e.nombre), inp('precio', 'money'), inp('costo', 'money'), k === 1 ? pct(0) : inp('reserva', 'pct'), inp('parte', 'pct'), money(e.deja), `<b>${e.acordeones ?? '—'}</b>`, money(e.ventas)]);
    }), 'num edit'))}
  ${card('Ingreso necesario vs tu nómina proyectada', canvas('c-suenos'))}`;
  return { html, after: () => mkChart('c-suenos', { type: 'line', data: { labels: S.anos.map((a) => a.anio), datasets: [ds('Casa + auto', S.anos.map((a) => a.ingresoCasaAuto), C.red), ds('Solo casa', S.anos.map((a) => a.ingresoCasa), C.orange), ds('Tu nómina', S.anos.map((a) => a.nomina), C.green, { borderWidth: 3 })] } }) };
};

V.retiro = () => {
  const T = R.RT, D = state.datos.retiro;
  const html = `<div class="kpis">${kpi('Capital que necesitas', money(T.capital), `a los ${D.edadRetiro} (pesos de hoy)`)}${kpi('Tu ahorro a esa edad', money(T.acumulado), 'nómina + Acordeonix')}${kpi('Te faltaría', money(T.falta), '', T.falta > 0 ? 'bad' : 'ok')}
    ${kpi('Edad realista de retiro', T.edadRealista ? `${T.edadRealista} años` : 'Después de los 70', 'con tu plan actual', 'ok')}</div>
  <div class="grid2">${card('Tus datos y supuestos', formGrid(CAMPOS_RETIRO))}
  ${card('Para retirarte a los ' + D.edadRetiro, `<div class="mini"><div><span>Opción A · ahorro mensual de tu nómina</span><b>${money(T.nominaNecesaria)}</b></div><div><span>Opción B · lo que Acordeonix debe darte al mes al empezar</span><b>${money(T.acordeonixNecesario)}</b></div>
    <div><span>…creciendo, al retirarte sería al mes</span><b>${money(T.acordeonixAlRetiro)}</b></div><div><span>Referencia: 25 veces tu gasto anual</span><b>${money(T.regla25)}</b></div></div>
    <p class="muted">Sin Afore (puedes activarla como extra). Todo en pesos de hoy: sube tus aportaciones cada año con la inflación.</p>` + canvas('c-ret', 240))}</div>
  ${card('¿A qué edad te alcanza?', tabla(['Edad', 'Años ahorrando', 'Capital necesario', 'Tu ahorro', '¿Alcanza?', 'Nómina necesaria', 'Acordeonix necesario (inicio)', 'Acordeonix a esa edad'],
    T.filas.map((f) => tr([f.edad, f.anos, money(f.capital), money(f.acumulado), badge(f.alcanza ? 'Sí' : 'No', f.alcanza ? 'ok' : 'bad'), money(f.nominaNecesaria), money(f.acordeonixNecesario), money(f.acordeonixEsaEdad)], f.edad === D.edadRetiro ? 'hl' : '')), 'num'))}`;
  return { html, after: () => mkChart('c-ret', { type: 'line', data: { labels: T.filas.map((f) => f.edad), datasets: [ds('Capital que necesitas', T.filas.map((f) => f.capital), C.red), ds('Tu ahorro acumulado', T.filas.map((f) => f.acumulado), C.green)] } }) };
};

V.escenarios = () => {
  const E = R.ES;
  const html = `${card(`Escenarios para salir de las tarjetas (tasa promedio ${pct(E.tasaProm, 2)} mensual)`, tabla(['Escenario', "'Otros' al mes", '¿Vende activos?', 'Libre de deudas', 'Intereses aprox.', 'Ahorro vs sin ajuste'],
    E.escenarios.map((e) => tr([e.nombre, money(e.otros), e.vende ? 'Sí' : 'No', `<b>${mes(e.libre)}</b>`, money(e.intereses), money(e.ahorroVsA)])), 'num') + canvas('c-esc', 280) +
    `<p class="muted">Modelo simplificado (toda la deuda junta). 'Modo austero' es para 1–2 meses de sprint, no para siempre.</p>`)}`;
  return { html, after: () => {
    const labs = ['Hoy', ...R.P.filas.map((r) => mes(r.mes))]; const cs = [C.red, C.navy, C.green, C.orange];
    mkChart('c-esc', { type: 'line', data: { labels: labs, datasets: E.escenarios.map((e, k) => ds(e.nombre, e.serie, cs[k])) } });
  } };
};

V.datos = () => {
  const X = R.P.X, D = state.datos;
  const secs = SECCIONES_DATOS.map((s) => {
    let body = s.campos ? formGrid(s.campos) : '';
    if (s.tabla) {
      const arr = getPath(D, s.tabla) || [];
      body += tabla([...s.columnas.map((c) => c[1]), ''], arr.map((row, k) => tr([...s.columnas.map(([f, , t]) => inputFor(`datos.${s.tabla}.${k}.${f}`, t, row[f])), `<button class="btn ghost" data-action="delRow" data-arr="${s.tabla}" data-k="${k}">✕</button>`])), 'edit') +
        `<button class="btn" data-action="addRow" data-arr="${s.tabla}">+ Agregar</button>`;
    }
    return `<details class="card" id="sec-${s.id}" ${s.id === 'general' ? 'open' : ''}><summary>${s.titulo}</summary>${body}</details>`;
  }).join('');
  const html = `${card('Respaldo', `<div class="row">
      <button class="btn primary" data-action="export">Descargar respaldo (JSON)</button>
      <label class="btn">Importar respaldo… <input type="file" id="imp" accept=".json,application/json" hidden></label>
      <span class="muted">Importar reemplaza todo lo que hay en la app.</span></div>`)}
    ${card('Valores calculados', `<div class="mini"><div><span>Colchón inicial</span><b>${money(X.colchonInicial)}</b></div><div><span>Gasto esencial mensual</span><b>${money(X.gastoEsencial)}</b></div>
      <div><span>Meta del fondo de emergencia</span><b>${money(X.metaFondo)}</b></div><div><span>Terreno: pago mensual necesario</span><b>${money(X.terrenoMensual)}</b></div>
      <div><span>Acordeonix: ingreso para ti</span><b>${money(X.ingresoAcordeonix)}</b></div><div><span>Préstamo: monto para liquidar</span><b>${money2(X.montoLiq)}</b></div>
      <div><span>Autos: apartado mensual</span><b>${money(X.autosMensual)}</b></div><div><span>Deuda inicial de tarjetas</span><b>${money(X.deudaTotal)}</b></div></div>`)}
    ${secs}`;
  return { html };
};

// ---------------- Cierre del mes ----------------
let csvTmp = null, filtroCat = '', mesCierre = null;
function mesesCierre() {
  const s = new Set((state.movimientos || []).filter((m) => m.fecha).map((m) => m.fecha.slice(0, 7)));
  R.P.filas.forEach((r) => { if (r.mes <= HOY.slice(0, 7)) s.add(r.mes); });
  s.add(HOY.slice(0, 7));
  return [...s].sort().reverse();
}
V.cierre = () => {
  const meses = mesesCierre();
  if (!mesCierre || !meses.includes(mesCierre)) mesCierre = meses.find((k) => (state.movimientos || []).some((m) => m.fecha && m.fecha.startsWith(k))) || meses[0];
  const c = cierreMes(state.datos, R.P, state.movimientos || [], mesCierre, R.SR.mensual);
  const H = historialCierres(state.datos, R.P, state.movimientos || [], R.SR.mensual);
  const ev = (state.cierres || {})[mesCierre] || {};
  const cuentas = [...state.datos.deudas.map((d) => d.nombre), 'Débito / nómina', 'Efectivo'];
  const optsCat = (sel) => CATEGORIAS.map((k) => `<option value="${k.id}" ${k.id === sel ? 'selected' : ''}>${esc(k.nombre)}</option>`).join('');
  const movs = c.movimientos.filter((m) => !filtroCat || (m.categoria || 'sinCategoria') === filtroCat).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const filasPlan = c.filas.filter((f) => f.real || f.plan);
  const csvBox = csvTmp ? `<div class="csvmap"><p><b>${esc(csvTmp.nombre)}</b>: ${csvTmp.rows.length} filas. Indica qué columna es cada cosa:</p><div class="form">
      ${['fecha', 'descripcion', 'cargo', 'abono', 'monto'].map((k) => `<label class="f"><span>${{ fecha: 'Fecha', descripcion: 'Descripción', cargo: 'Cargo (gasto)', abono: 'Abono (pago/ingreso)', monto: 'O un solo monto' }[k]}</span><select data-csv="${k}"><option value="">—</option>${csvTmp.head.map((h, i) => `<option value="${i}" ${csvTmp.map[k] === i ? 'selected' : ''}>${esc(h || 'Columna ' + (i + 1))}</option>`).join('')}</select></label>`).join('')}
      <label class="f"><span>Si es un solo monto, el gasto viene…</span><select data-csv="signo"><option value="pos" ${csvTmp.map.signo === 'pos' ? 'selected' : ''}>positivo</option><option value="neg" ${csvTmp.map.signo === 'neg' ? 'selected' : ''}>negativo</option></select></label>
      <label class="f"><span>Cuenta</span><select data-csv="cuenta">${cuentas.map((x) => `<option ${x === csvTmp.map.cuenta ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label></div>
      ${tabla(['Fecha', 'Descripción', 'Monto', 'Tipo', 'Categoría'], csvPreview().slice(0, 6).map((m) => tr([m.fecha || '<span class="neg">?</span>', esc(m.descripcion), money2(m.monto), m.tipoMov, esc(catById(m.categoria).nombre)])), 'num')}
      <div class="row"><button class="btn primary" data-action="csvImport">Importar ${csvPreview().filter((m) => m.fecha && m.monto).length} movimientos</button><button class="btn ghost" data-action="csvCancel">Cancelar</button></div></div>` : '';
  const html = `
  <div class="weeknav"><select data-action="mesCierre">${meses.map((k) => `<option value="${k}" ${k === mesCierre ? 'selected' : ''}>${mesLargo(k)}</option>`).join('')}</select>
    <span class="muted">${c.movimientos.length} movimientos</span>${mesCierre >= HOY.slice(0, 7) ? badge('Mes en curso: la comparación es parcial hasta que cierre el mes', 'warn') : ''}</div>
  <div class="kpis">${kpi('Ingresos reales', money(c.ingresos), `plan ${money(c.ingresosPlan)}`)}${kpi('Gastos reales', money(c.gastos), 'sin contar pagos a tarjeta ni ahorro')}
    ${kpi('Te quedó libre', money(c.balance), c.ingresos ? `${pct(c.balance / c.ingresos)} de tus ingresos (ideal 20%)` : '', c.balance >= c.ideal ? 'ok' : 'bad')}
    ${kpi('Comisiones e intereses', money(c.filas.find((f) => f.id === 'comisiones').real), '', c.filas.find((f) => f.id === 'comisiones').real > 0 ? 'bad' : 'ok')}
    ${kpi('Gastos hormiga', money(c.hormigaTotal), `${c.hormiga.length} compras de menos de $200`)}</div>
  <div class="grid2">
    ${card('Evaluación del mes', `<ul class="alertas">${c.alertas.map(([t, x]) => `<li class="${t}">${esc(x)}</li>`).join('')}</ul>
      <label class="f full"><span>Evaluación y acuerdos del mes</span><textarea rows="5" data-cierre="evaluacion" placeholder="Qué salió bien, qué ajustar el próximo mes…">${esc(ev.evaluacion || '')}</textarea></label>`)}
    ${card('Plan vs real por categoría', canvas('c-cierre', 300))}
  </div>
  ${card('Detalle por categoría', tabla(['Categoría', 'Plan', 'Real', 'Diferencia', ''], filasPlan.map((f) => {
    const real = f.id === 'otros' ? c.otrosTotal : f.real;
    const dif = f.plan === null ? null : real - f.plan;
    const malo = f.tipo === 'ingreso' ? dif < -1 : dif > f.plan * 0.1 + 1;
    return tr([esc(f.nombre) + (f.id === 'otros' ? ` <small class="muted">(${f.nota})</small>` : ''), f.plan === null ? '<span class="muted">sin plan</span>' : money(f.plan), `<b>${money(real)}</b>`,
      dif === null ? '—' : `<b class="${malo ? 'neg' : 'pos'}">${money(dif)}</b>`, f.plan === null ? '' : badge(malo ? 'Revisar' : 'Bien', malo ? 'bad' : 'ok')]);
  }), 'num') + `<p class="muted">Pagos a tarjeta en el mes: <b>${money(c.pagosTarjeta)}</b> (no cuentan como gasto: el gasto ya se contó cuando compraste).</p>`)}
  <div class="grid2">
    ${card('Los 10 gastos más grandes', tabla(['Fecha', 'Descripción', 'Cuenta', 'Monto'], c.top.map((m) => tr([dia(m.fecha), esc(m.descripcion), esc(m.cuenta || ''), money2(m.monto)])), 'num'))}
    ${card('Gasto por cuenta y por tipo', tabla(['Cuenta', 'Gastos'], Object.entries(c.porCuenta).map(([k, v]) => tr([esc(k), money(v)])), 'num') +
      tabla(['Tipo', 'Gastos', '% de ingresos'], Object.entries(c.grupos).map(([k, v]) => tr([esc(k || '—'), money(v), c.ingresos ? pct(v / c.ingresos) : '—'])), 'num'))}
  </div>
  ${card('Importar estados de cuenta', `<div class="row">
      <label class="btn primary">Importar CSV del banco… <input type="file" id="csvfile" accept=".csv,.txt,text/csv" hidden></label>
      <label class="btn">Agregar movimientos (JSON de Claude)… <input type="file" id="movjson" accept=".json" hidden></label>
      <button class="btn" data-action="addMov">+ Movimiento manual</button></div>
    <p class="muted">PDF: pásaselos a Claude junto con un respaldo y te regresa un JSON con los movimientos ya clasificados y la evaluación del mes.</p>${csvBox}`)}
  ${card(`Movimientos de ${mesLargo(mesCierre)}`, `<div class="row"><select data-action="filtroCat"><option value="">Todas las categorías</option>${optsCat(filtroCat)}</select>
      <button class="btn" data-action="recategorizar">Aplicar reglas a los "sin categoría"</button></div>` +
    tabla(['Fecha', 'Cuenta', 'Descripción', 'Monto', 'Tipo', 'Categoría', ''], movs.map((m) => tr([
      `<input type="date" data-col="movimientos" data-id="${m.id}" data-field="fecha" value="${esc(m.fecha)}">`,
      `<select data-col="movimientos" data-id="${m.id}" data-field="cuenta">${[...new Set([...cuentas, m.cuenta])].filter(Boolean).map((x) => `<option ${x === m.cuenta ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`,
      `<input type="text" data-col="movimientos" data-id="${m.id}" data-field="descripcion" value="${esc(m.descripcion)}">`,
      `<div class="num is-money"><input type="number" step="any" data-col="movimientos" data-id="${m.id}" data-field="monto" value="${esc(m.monto)}"></div>`,
      `<select data-col="movimientos" data-id="${m.id}" data-field="tipoMov"><option value="cargo" ${m.tipoMov !== 'abono' ? 'selected' : ''}>Cargo</option><option value="abono" ${m.tipoMov === 'abono' ? 'selected' : ''}>Abono</option></select>`,
      `<select data-col="movimientos" data-id="${m.id}" data-field="categoria" class="${(m.categoria || 'sinCategoria') === 'sinCategoria' ? 'warnsel' : ''}">${optsCat(m.categoria || 'sinCategoria')}</select>`,
      `<button class="btn ghost" data-action="del" data-col="movimientos" data-id="${m.id}">✕</button>`])), 'edit'))}
  ${card('Historial mes a mes', tabla(['Mes', 'Movimientos', 'Ingresos', 'Gastos', 'Te quedó libre', '% libre', 'Comisiones'], H.slice().reverse().map((h) => tr([`<a href="#cierre" data-action="goMes" data-mes="${h.mes}">${mesLargo(h.mes)}</a>`, h.n, money(h.ingresos), money(h.gastos), money(h.balance), h.pct === null ? '—' : `<b class="${h.pct >= 0.2 ? 'pos' : 'neg'}">${pct(h.pct)}</b>`, money(h.comisiones)])), 'num'))}
  <details class="card"><summary>Reglas para clasificar automáticamente</summary>
    <p class="muted">Una regla por línea: <code>palabras o patrón =&gt; categoría</code>. Categorías: ${CATEGORIAS.map((k) => k.id).join(', ')}.</p>
    <textarea rows="12" data-reglas="1" class="mono">${esc((state.reglas || []).map(([p, k]) => `${p} => ${k}`).join('\n'))}</textarea></details>`;
  return { html, after: () => {
    const F = filasPlan.filter((f) => f.tipo === 'gasto');
    mkChart('c-cierre', { type: 'bar', data: { labels: F.map((f) => f.nombre.split(' (')[0]), datasets: [ds('Plan', F.map((f) => f.plan ?? 0), C.gray, { backgroundColor: C.gray + '88' }), ds('Real', F.map((f) => (f.id === 'otros' ? c.otrosTotal : f.real)), C.navy, { backgroundColor: C.navy })] }, options: { indexAxis: 'y', scales: { x: { ticks: { callback: (v) => money(v) } } } } });
  } };
};

// CSV
function parseCSV(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === delim) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const MES_TXT = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
function parseFecha(s) {
  s = String(s || '').trim().toLowerCase(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if ((m = s.match(/^(\d{1,2})[\s\/\-.]([a-z]{3})[a-z]*[\s\/\-.](\d{2,4})/)) && MES_TXT[m[2]]) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(MES_TXT[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
function parseMonto(s) { s = String(s ?? '').trim(); if (!s) return null; const neg = /^\(.*\)$/.test(s) || s.includes('-'); const n = Number(s.replace(/[^0-9.]/g, '')); return isNaN(n) || s.replace(/[^0-9]/g, '') === '' ? null : (neg ? -n : n); }
function csvPreview() {
  const { rows, map } = csvTmp; const out = [];
  rows.forEach((r) => {
    const fecha = parseFecha(r[map.fecha]); const desc = (r[map.descripcion] || '').trim();
    let monto = null, tipoMov = 'cargo';
    if (map.cargo !== null && map.cargo !== undefined && parseMonto(r[map.cargo])) { monto = Math.abs(parseMonto(r[map.cargo])); }
    else if (map.abono !== null && map.abono !== undefined && parseMonto(r[map.abono])) { monto = Math.abs(parseMonto(r[map.abono])); tipoMov = 'abono'; }
    else if (map.monto !== null && map.monto !== undefined && parseMonto(r[map.monto]) !== null) { const v = parseMonto(r[map.monto]); const gasto = map.signo === 'neg' ? v < 0 : v > 0; monto = Math.abs(v); tipoMov = gasto ? 'cargo' : 'abono'; }
    let categoria = categorizar(desc, state.reglas || REGLAS_BASE);
    if (categoria === 'sinCategoria' && tipoMov === 'abono') categoria = map.cuenta.startsWith('Tarjeta') ? 'pagoTarjeta' : 'otroIngreso';
    out.push({ fecha, descripcion: desc, monto, tipoMov, categoria, cuenta: map.cuenta });
  });
  return out;
}
function guessMap(head) {
  const f = (re) => { const i = head.findIndex((h) => re.test(String(h).toLowerCase())); return i >= 0 ? i : null; };
  return { fecha: f(/fecha|date/), descripcion: f(/descrip|concepto|detalle|movimiento|comercio/), cargo: f(/cargo|retiro|debito|débito/), abono: f(/abono|deposito|depósito|credito|crédito/),
    monto: f(/^monto|importe|amount/), signo: 'pos', cuenta: state.datos.deudas[0]?.nombre || 'Débito / nómina' };
}
const idMov = (m) => `${m.fecha}_${(m.cuenta || '').replace(/\W+/g, '')}_${(m.descripcion || '').replace(/\W+/g, '').slice(0, 24)}_${Math.round((m.monto || 0) * 100)}`;
async function agregarMovimientos(nuevos, cierres) {
  const ex = new Set((state.movimientos || []).map((m) => m.id)); const add = [];
  nuevos.forEach((m) => { const it = { tipoMov: 'cargo', categoria: 'sinCategoria', ...m }; it.id = it.id || idMov(it); if (!ex.has(it.id)) { ex.add(it.id); add.push(it); } });
  state.movimientos.push(...add);
  if (cierres) { state.cierres = state.cierres || {}; Object.entries(cierres).forEach(([k, v]) => { state.cierres[k] = { ...(state.cierres[k] || {}), ...v }; }); }
  await guardar(async () => { await store.saveItems('movimientos', add, 'id'); await store.saveListas({ cierres: state.cierres }); });
  toast(`${add.length} movimientos agregados${nuevos.length - add.length ? ` (${nuevos.length - add.length} repetidos omitidos)` : ''}`);
  if (add.length) mesCierre = add.map((m) => m.fecha.slice(0, 7)).sort().pop();
  render();
}

// ---------------- render ----------------
function render() {
  const id = (location.hash || '#inicio').slice(1);
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.v === v.id));
  $('#titulo').textContent = v.t;
  document.body.dataset.grupo = v.g;
  const y = window.scrollY;
  destroyCharts();
  R = calcularTodo(state, HOY);
  const out = V[v.id]();
  $('#main').innerHTML = out.html;
  if (out.after) out.after();
  window.scrollTo(0, y);
}
function navHTML() {
  return Object.entries(GRUPOS).map(([g, t]) => `<div class="ng g-${g}"><div class="ngt">${t}</div>${VIEWS.filter((v) => v.g === g).map((v) => `<a href="#${v.id}" data-v="${v.id}">${v.t}</a>`).join('')}${g === 'fut' ? '<a href="inversiones.html">Inversiones ↗</a>' : ''}</div>`).join('');
}

// ---------------- guardado ----------------
async function guardar(fn) {
  setStatus('Guardando…', 'busy');
  try { await fn(); setStatus(store.modo === 'local' ? 'Guardado en este navegador' : 'Guardado', 'ok'); return true; }
  catch (e) { console.error(e); setStatus('Error al guardar', 'err'); toast('No se pudo guardar: ' + (e.message || e)); return false; }
}
function guardarDatos() { clearTimeout(saveTimer); saveTimer = setTimeout(() => guardar(() => store.saveDatos(state.datos)), 500); }
const guardarListas = () => guardar(() => store.saveListas({ pendientes: state.pendientes, consejos: state.consejos, listaEspera: state.listaEspera, ui: state.ui, reglas: state.reglas, cierres: state.cierres }));

function normalizar(s) {
  s.semanas = s.semanas || []; s.cargos = (s.cargos || []).map((c) => ({ id: c.id || uid(), ...c })); s.suscripciones = (s.suscripciones || []).map((c) => ({ id: c.id || uid(), ...c }));
  s.movimientos = (s.movimientos || []).map((m) => ({ id: m.id || idMov(m), ...m })); s.reglas = (s.reglas && s.reglas.length) ? s.reglas : REGLAS_BASE; s.cierres = s.cierres || {};
  s.pendientes = s.pendientes || []; s.consejos = (s.consejos && s.consejos.length) ? s.consejos : CONSEJOS_BASE; s.listaEspera = s.listaEspera || []; s.ui = s.ui || {};
  s.datos.simulador = s.datos.simulador || { monto: 1500, forma: "De mi 'otros'" };
  return s;
}

// ---------------- eventos ----------------
function onChange(e) {
  const t = e.target;
  if (t.dataset.path) {
    const [root, ...rest] = t.dataset.path.split('.');
    setPath(state[root], rest.join('.'), parseVal(t.dataset.type, t.value));
    if (root === 'datos') guardarDatos();
    render(); return;
  }
  if (t.dataset.sem) {
    const f = t.dataset.sem; let s = state.semanas.find((x) => x.fecha === f);
    if (!s) { s = { fecha: f }; state.semanas.push(s); }
    const val = t.type === 'text' ? (t.value || null) : (t.value === '' ? null : Number(t.value));
    if (t.dataset.field.startsWith('saldos.')) { s.saldos = s.saldos || {}; s.saldos[t.dataset.field.slice(7)] = val; } else s[t.dataset.field] = val;
    guardar(() => store.saveItem('semanas', s, 'fecha')); render(); return;
  }
  if (t.dataset.col) {
    const it = state[t.dataset.col].find((x) => x.id === t.dataset.id); if (!it) return;
    it[t.dataset.field] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : (t.value || null);
    guardar(() => store.saveItem(t.dataset.col, it, 'id')); render(); return;
  }
  if (t.dataset.lista) {
    const it = state[t.dataset.lista][Number(t.dataset.k)];
    it[t.dataset.field] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : (t.value || null);
    guardarListas(); render(); return;
  }
  if (t.dataset.esc) { state.ui.escenarioBalance = state.ui.escenarioBalance || {}; state.ui.escenarioBalance[t.dataset.esc] = t.value === '' ? null : Number(t.value); guardarListas(); render(); return; }
  if (t.dataset.ui) { state.ui[t.dataset.ui] = t.value || null; guardarListas(); render(); return; }
  if (t.dataset.action === 'semSel') { semSel = t.value; render(); return; }
  if (t.id === 'imp' && t.files[0]) importar(t.files[0]);
  if (t.dataset.action === 'mesCierre') { mesCierre = t.value; render(); return; }
  if (t.dataset.action === 'filtroCat') { filtroCat = t.value; render(); return; }
  if (t.dataset.cierre) { state.cierres = state.cierres || {}; state.cierres[mesCierre] = { ...(state.cierres[mesCierre] || {}), [t.dataset.cierre]: t.value }; guardarListas(); return; }
  if (t.dataset.reglas) {
    state.reglas = t.value.split('\n').map((l) => l.split('=>').map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]);
    guardarListas(); toast(`${state.reglas.length} reglas guardadas`); return;
  }
  if (t.dataset.csv) { const k = t.dataset.csv; csvTmp.map[k] = ['signo', 'cuenta'].includes(k) ? t.value : (t.value === '' ? null : Number(t.value)); render(); return; }
  if (t.id === 'csvfile' && t.files[0]) {
    t.files[0].text().then((txt) => { const rows = parseCSV(txt); const hi = rows.findIndex((r) => r.some((x) => /fecha|date/i.test(x))); const h = hi >= 0 ? hi : 0;
      csvTmp = { nombre: t.files[0].name, head: rows[h], rows: rows.slice(h + 1) }; csvTmp.map = guessMap(csvTmp.head); render(); });
    return;
  }
  if (t.id === 'movjson' && t.files[0]) {
    t.files[0].text().then((txt) => { try { const j = JSON.parse(txt); const lista = Array.isArray(j) ? j : (j.movimientos || []);
      if (j.saldos) j.saldos.forEach((x) => { let sm = state.semanas.find((w) => w.fecha === x.fecha); if (!sm) { sm = { fecha: x.fecha }; state.semanas.push(sm); } sm.saldos = { ...(sm.saldos || {}), ...x.saldos }; store.saveItem('semanas', sm, 'fecha'); });
      agregarMovimientos(lista, j.cierres); } catch (e) { toast('JSON inválido: ' + e.message); } });
    return;
  }
}
async function onClick(e) {
  const b = e.target.closest('[data-action]'); if (!b || b.tagName === 'SELECT') return;
  const a = b.dataset.action, S = (R && R.SEM) || [];
  if (a === 'semPrev' || a === 'semNext') { const i = S.findIndex((s) => s.fecha === semSel); semSel = S[Math.max(0, Math.min(S.length - 1, i + (a === 'semPrev' ? -1 : 1)))].fecha; render(); }
  if (a === 'goSem') { e.preventDefault(); semSel = b.dataset.fecha; render(); window.scrollTo(0, 0); }
  if (a === 'addCargo') {
    const c = { id: uid(), fecha: $('#nc-fecha').value, tarjeta: $('#nc-tarjeta').value, concepto: $('#nc-concepto').value, tipo: $('#nc-tipo').value, monto: Number($('#nc-monto').value) || 0 };
    if (!c.monto) { toast('Captura el monto'); return; }
    state.cargos.push(c); guardar(() => store.saveItem('cargos', c, 'id')); toast('Cargo agregado'); render();
  }
  if (a === 'del') { if (!confirm('¿Borrar?')) return; const col = b.dataset.col; state[col] = state[col].filter((x) => x.id !== b.dataset.id); guardar(() => store.deleteItem(col, b.dataset.id, 'id')); render(); }
  if (a === 'addSub') { const s = { id: uid(), servicio: 'Nueva', medio: state.datos.deudas[0]?.nombre || 'Débito / efectivo', monto: 0, dia: 1, decision: 'Revisar', cancelada: null }; state.suscripciones.push(s); guardar(() => store.saveItem('suscripciones', s, 'id')); render(); }
  if (a === 'addEspera') { state.listaEspera.push({ cosa: '', precio: null, fecha: HOY }); guardarListas(); render(); }
  if (a === 'addPend') { state.pendientes.push({ accion: 'Nueva acción', cuando: '', impacto: '', estado: 'Pendiente' }); guardarListas(); render(); }
  if (a === 'delLista') { if (!confirm('¿Borrar?')) return; state[b.dataset.lista].splice(Number(b.dataset.k), 1); guardarListas(); render(); }
  if (a === 'filtro') { filtroPend = b.dataset.v; render(); }
  if (a === 'limpiarEscenario') { state.ui.escenarioBalance = {}; guardarListas(); render(); }
  if (a === 'addRow') { const arr = getPath(state.datos, b.dataset.arr); arr.push({}); guardarDatos(); render(); }
  if (a === 'delRow') { if (!confirm('¿Borrar esta fila?')) return; getPath(state.datos, b.dataset.arr).splice(Number(b.dataset.k), 1); guardarDatos(); render(); }
  if (a === 'export') exportar();
  if (a === 'csvCancel') { csvTmp = null; render(); }
  if (a === 'csvImport') { const ms = csvPreview().filter((m) => m.fecha && m.monto); csvTmp = null; await agregarMovimientos(ms); }
  if (a === 'addMov') { const m = { id: uid(), fecha: (mesCierre === HOY.slice(0, 7) ? HOY : mesCierre + '-01'), cuenta: 'Débito / nómina', descripcion: 'Nuevo movimiento', monto: 0, tipoMov: 'cargo', categoria: 'sinCategoria' }; state.movimientos.push(m); guardar(() => store.saveItem('movimientos', m, 'id')); render(); }
  if (a === 'recategorizar') { const cambia = state.movimientos.filter((m) => (m.categoria || 'sinCategoria') === 'sinCategoria').map((m) => { const k = categorizar(m.descripcion, state.reglas); return k !== 'sinCategoria' ? Object.assign(m, { categoria: k }) : null; }).filter(Boolean);
    await guardar(() => store.saveItems('movimientos', cambia, 'id')); toast(`${cambia.length} movimientos clasificados`); render(); }
  if (a === 'goMes') { e.preventDefault(); mesCierre = b.dataset.mes; render(); window.scrollTo(0, 0); }
  if (a === 'login') {
    const msg = $('#login-msg'); msg.textContent = 'Abriendo Google…'; b.disabled = true;
    try { await store.signIn(); msg.textContent = ''; }
    catch (err) { console.error(err); msg.textContent = mensajeAuth(err); }
    finally { b.disabled = false; }
  }
  if (a === 'logout') { await store.signOut(); }
  if (a === 'menu') document.body.classList.toggle('nav-open');
  if (a === 'tema') { const sig = { matriz: 'light', light: 'dark', dark: 'matriz' }; const t = sig[tema()]; document.documentElement.dataset.theme = t; try { localStorage.setItem('plan_tema', t); } catch {} C = PAL[t]; window.lluviaRefrescar?.(); if (state) render(); toast?.(`Tema: ${{ matriz: 'Matriz', light: 'Claro', dark: 'Oscuro' }[t]}`); }
}
function exportar() {
  const blob = new Blob([JSON.stringify({ version: 1, exportado: HOY, ...state }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `respaldo_plan_${HOY}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importar(file) {
  try {
    const s = JSON.parse(await file.text());
    if (!s.datos) throw new Error('El archivo no tiene datos del plan');
    if (!confirm('Esto reemplaza todo lo que hay en la app con el respaldo. ¿Continuar?')) return;
    state = normalizar({ datos: s.datos, semanas: s.semanas, cargos: s.cargos, suscripciones: s.suscripciones, pendientes: s.pendientes, consejos: s.consejos, listaEspera: s.listaEspera, ui: s.ui, movimientos: s.movimientos, reglas: s.reglas, cierres: s.cierres });
    setStatus('Importando…', 'busy');
    const ok = await guardar(() => store.saveAll(state));
    if (!ok) return;
    toast(`Respaldo importado: ${state.semanas.length} semanas, ${state.cargos.length} cargos, ${state.suscripciones.length} suscripciones`);
    location.hash = '#inicio'; render();
  } catch (e) { toast('No se pudo importar: ' + e.message); }
}

// Cambios hechos en otro dispositivo: recarga los datos sin interrumpir lo que estés escribiendo.
let recargaPendiente = false;
async function recargarRemoto() {
  const el = document.activeElement;
  if (el && el.matches && el.matches('input, textarea, select') && document.getElementById('main').contains(el)) {
    if (!recargaPendiente) { recargaPendiente = true; el.addEventListener('blur', () => { recargaPendiente = false; setTimeout(recargarRemoto, 300); }, { once: true }); }
    return;
  }
  try {
    const s = await store.load();
    if (!s || !s.datos) return;
    const y = window.scrollY;
    state = normalizar(s); render(); window.scrollTo(0, y);
    setStatus('Actualizado desde otro dispositivo', 'ok');
  } catch (e) { console.warn(e); }
}

// ---------------- arranque ----------------
async function arrancar() {
  $('#nav').innerHTML = navHTML();
  document.addEventListener('change', onChange);
  document.addEventListener('click', onClick);
  window.addEventListener('hashchange', () => { document.body.classList.remove('nav-open'); render(); });
  await store.init(async (user) => {
    if (!user) { document.body.classList.add('logged-out'); $('#user').textContent = ''; return; }
    document.body.classList.remove('logged-out');
    $('#user').textContent = user.email;
    $('#modo').hidden = store.modo !== 'local';
    setStatus('Cargando…', 'busy');
    try {
      const s = await store.load();
      state = normalizar(s && s.datos ? s : { datos: datosEjemplo(HOY), pendientes: [], consejos: CONSEJOS_BASE });
      if (!s || !s.datos) { location.hash = '#datos'; toast('Importa tu respaldo en Datos y respaldo'); }
      setStatus(store.modo === 'local' ? 'Modo local' : 'Sincronizado', 'ok');
      render();
      store.watch(recargarRemoto);
    } catch (e) { console.error(e); setStatus('Error al cargar', 'err'); $('#main').innerHTML = card('No se pudieron cargar tus datos', `<p>${esc(e.message)}</p>`); }
  }, (msg) => { $('#login-msg').textContent = msg; });
}
arrancar();
