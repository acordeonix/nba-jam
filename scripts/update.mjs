// NBA JAM — recolector de box scores
// Baja de ESPN los partidos terminados y los agrega a data/games.json y data/games.csv.
// Uso:
//   node scripts/update.mjs                         -> incremental (desde el último día guardado hasta hoy)
//   node scripts/update.mjs 2025-10-21 2026-04-12   -> backfill de un rango de fechas
// Variables opcionales: SEASON_TYPES="2" (2=regular, 3=playoffs, 1=pretemporada, 5=play-in), START_DATE

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const GAMES_JSON = path.join(DATA, 'games.json');
const GAMES_CSV = path.join(DATA, 'games.csv');
const SLATE_JSON = path.join(DATA, 'slate.json');
const ROSTERS_JSON = path.join(DATA, 'rosters.json');   // rosters actuales: equipo -> jugadores
const META_JSON = path.join(DATA, 'meta.json');
const PLAYERS_DIR = path.join(DATA, 'players');          // data/players/<season>.json
const ATHLETES_JSON = path.join(DATA, 'athletes.json');  // catálogo id -> [nombre, nombre corto, posición, número]

const BASE = process.env.ESPN_BASE || 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const START_DATE = process.env.START_DATE || '2026-10-20'; // arranque temporada regular 2026-27
const SEASON_TYPES = (process.env.SEASON_TYPES || '2').split(',').map(s => Number(s.trim()));
const DELAY_MS = Number(process.env.DELAY_MS || 100);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);      // partidos que se bajan a la vez
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 300);     // corta a tiempo y guarda lo avanzado
const SAVE_EVERY_DAYS = 10;                                      // guarda progreso cada N días procesados

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Solo los 30 equipos NBA: deja fuera el All-Star (STARS, WORLD, STRIPES…) y exhibiciones
const NBA = new Set(['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GS','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NO','NY','OKC','ORL','PHI','PHX','POR','SAC','SA','TOR','UTAH','WSH']);
// La final de la Copa NBA no cuenta en las estadísticas oficiales de temporada regular
const isCupFinal = ev => ev.competitions?.[0]?.type?.abbreviation === 'CC' ||
  (ev.competitions?.[0]?.notes || []).some(n => /cup championship/i.test(n.headline || ''));
const EXCLUDE_IDS = new Set(['401809839']); // final Copa NBA 2025 (ya guardada antes del filtro)
const isNbaEvent = ev => (ev.competitions?.[0]?.competitors || []).every(c => NBA.has(c.team?.abbreviation)) && !isCupFinal(ev) && !EXCLUDE_IDS.has(ev.id);

async function getJSON(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'nba-jam-tracker/1.0' }, signal: AbortSignal.timeout(20000) }); // máx. 20 s por petición
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries) throw new Error(`${url} -> ${e.message}`);
      await sleep(1000 * i);
    }
  }
}

// Fecha "de calendario NBA" (hora del Este)
function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const ymd = iso => iso.replaceAll('-', '');

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

// Convierte un equipo del boxscore de ESPN en un registro compacto
function parseTeamStats(teamBox) {
  const s = {};
  for (const st of teamBox.statistics || []) s[st.name] = st.displayValue;
  const pair = key => {
    const v = s[key];
    if (!v || !v.includes('-')) return [null, null];
    const [a, b] = v.split('-').map(Number);
    return [a, b];
  };
  const [fgm, fga] = pair('fieldGoalsMade-fieldGoalsAttempted');
  const [tpm, tpa] = pair('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
  const [ftm, fta] = pair('freeThrowsMade-freeThrowsAttempted');
  return {
    ast: num(s.assists),
    to: num(s.totalTurnovers ?? s.turnovers),
    reb: num(s.totalRebounds),
    oreb: num(s.offensiveRebounds),
    dreb: num(s.defensiveRebounds),
    stl: num(s.steals),
    blk: num(s.blocks),
    pf: num(s.fouls),
    fgm, fga, tpm, tpa, ftm, fta,
    fbp: num(s.fastBreakPoints),
    pip: num(s.pointsInPaint),
  };
}

// Momios americanos del over/under (si ESPN los trae)
function ouOdds(pc) {
  const o = num(pc.overOdds) ?? num(pc.total?.over?.close?.odds) ?? num(pc.total?.over?.open?.odds);
  const u = num(pc.underOdds) ?? num(pc.total?.under?.close?.odds) ?? num(pc.total?.under?.open?.odds);
  return { ...(o != null ? { o } : {}), ...(u != null ? { u } : {}) };
}

function parseGame(event, summary) {
  const comp = event.competitions[0];
  const side = ha => comp.competitors.find(c => c.homeAway === ha);
  const boxTeams = summary?.boxscore?.teams || [];
  const build = ha => {
    const c = side(ha);
    const abbr = c.team.abbreviation;
    const box = boxTeams.find(t => t.homeAway === ha) || boxTeams.find(t => t.team?.abbreviation === abbr);
    const q = (c.linescores || []).map(l => num(l.value ?? l.displayValue) ?? 0);
    return { t: abbr, pts: num(c.score), q, ...(box ? parseTeamStats(box) : {}) };
  };
  // Línea del mercado (DraftKings vía ESPN): total de puntos y spread del local
  const pc = (summary?.pickcenter || [])[0] || comp.odds?.[0] || null;
  const mk = pc && num(pc.overUnder) != null ? { ou: num(pc.overUnder), sp: num(pc.spread), p: pc.provider?.name || '', det: pc.details || '', ...ouOdds(pc) } : undefined;
  return {
    id: event.id,
    date: null, // se asigna con la fecha ET consultada
    season: event.season?.year ?? null,
    type: event.season?.type ?? null,
    h: build('home'),
    a: build('away'),
    ...(mk ? { mk } : {}),
  };
}

// Box score por jugador. Fila compacta:
// [game_id, athlete_id, team, titular(1/0), MIN, PTS, REB, AST, STL, BLK, TO, 3PM, 3PA, FGM, FGA, FTM, FTA, OREB, DREB, PF, +/-]
const P_COLS = ['gid', 'aid', 'team', 'st', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'tpm', 'tpa', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'pf', 'pm'];
function parsePlayers(gid, summary, athletes) {
  const rows = [];
  for (const team of summary?.boxscore?.players || []) {
    const abbr = team.team?.abbreviation;
    const block = team.statistics?.[0];
    if (!block) continue;
    const keys = block.keys || [];
    const idx = k => keys.indexOf(k);
    for (const a of block.athletes || []) {
      const ath = a.athlete || {};
      if (ath.id) athletes[ath.id] = [ath.displayName, ath.shortName, ath.position?.abbreviation || '', ath.jersey || ''];
      if (a.didNotPlay || !a.stats?.length) continue;
      const v = k => { const i = idx(k); return i < 0 ? null : a.stats[i]; };
      const n = k => num(v(k));
      const pr = k => { const x = v(k); if (!x || !String(x).includes('-')) return [null, null]; return String(x).split('-').map(Number); };
      const [fgm, fga] = pr('fieldGoalsMade-fieldGoalsAttempted');
      const [tpm, tpa] = pr('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
      const [ftm, fta] = pr('freeThrowsMade-freeThrowsAttempted');
      const min = n('minutes');
      if (!min) continue;
      rows.push([gid, ath.id, abbr, a.starter ? 1 : 0, min, n('points'), n('rebounds'), n('assists'), n('steals'), n('blocks'), n('turnovers'),
        tpm, tpa, fgm, fga, ftm, fta, n('offensiveRebounds'), n('defensiveRebounds'), n('fouls'), n('plusMinus')]);
    }
  }
  return rows;
}
function parseInjuries(summary, athletes) {
  const out = {};
  for (const t of summary?.injuries || []) {
    const abbr = t.team?.abbreviation;
    if (!abbr) continue;
    out[abbr] = (t.injuries || []).map(i => {
      const ath = i.athlete || {};
      if (ath.id && !athletes[ath.id]) athletes[ath.id] = [ath.displayName, ath.shortName, ath.position?.abbreviation || '', ath.jersey || ''];
      return [ath.id, ath.displayName, i.status || i.type?.description || ''];
    });
  }
  return out;
}

async function load(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

const CSV_STATS = ['pts', 'q1', 'q2', 'q3', 'q4', 'ot', 'ast', 'to', 'reb', 'oreb', 'dreb', 'stl', 'blk', 'pf', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'fbp', 'pip'];
function flat(t) {
  const q = t.q || [];
  return {
    ...t,
    q1: q[0] ?? '', q2: q[1] ?? '', q3: q[2] ?? '', q4: q[3] ?? '',
    ot: q.length > 4 ? q.slice(4).reduce((a, b) => a + b, 0) : 0,
  };
}
function toCSV(games) {
  // Formato "largo": 2 filas por partido (una por equipo), con stats a favor (_f) y en contra (_c)
  const head = ['date', 'game_id', 'season', 'type', 'team', 'opp', 'ha',
    ...CSV_STATS.map(k => k + '_f'), ...CSV_STATS.map(k => k + '_c'), ...CSV_STATS.map(k => k + '_tot')];
  const rows = [head.join(',')];
  for (const g of games) {
    for (const [me, op, ha] of [[g.h, g.a, 'H'], [g.a, g.h, 'A']]) {
      const m = flat(me), o = flat(op);
      const tot = k => (m[k] === '' || m[k] == null || o[k] === '' || o[k] == null) ? '' : Number(m[k]) + Number(o[k]);
      rows.push([g.date, g.id, g.season, g.type, me.t, op.t, ha,
        ...CSV_STATS.map(k => m[k] ?? ''), ...CSV_STATS.map(k => o[k] ?? ''), ...CSV_STATS.map(tot)].join(','));
    }
  }
  return rows.join('\n') + '\n';
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  const games0 = await load(GAMES_JSON, []);
  // Limpia lo que no es temporada regular NBA (All-Star, final de Copa) si quedó de cargas anteriores
  const games = games0.filter(g => NBA.has(g.h.t) && NBA.has(g.a.t) && !EXCLUDE_IDS.has(g.id) && !g.cup);
  const dropped = new Set(games0.filter(g => !games.includes(g)).map(g => g.id));
  if (dropped.size) console.log(`Limpieza: ${dropped.size} partidos fuera de la temporada regular NBA`);
  const have = new Set(games.map(g => g.id));
  await fs.mkdir(PLAYERS_DIR, { recursive: true });
  const athletes = await load(ATHLETES_JSON, {});
  // Carga los box scores de jugadores ya guardados, por temporada
  const pSeasons = {}; const pDirty = new Set(); const havePlayers = new Set();
  for (const f of await fs.readdir(PLAYERS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const season = f.replace('.json', '');
    pSeasons[season] = (await load(path.join(PLAYERS_DIR, f), [])).filter(r => !dropped.has(r[0]) && NBA.has(r[2]));
    if (dropped.size) pDirty.add(season);
    for (const r of pSeasons[season]) havePlayers.add(r[0]);
  }
  const addPlayers = (season, rows) => {
    if (!rows.length) return;
    (pSeasons[season] ||= []).push(...rows); pDirty.add(String(season));
  };
  const today = etDate();

  let [from, to] = process.argv.slice(2);
  if (!from) {
    const last = games.reduce((m, g) => (g.date > m ? g.date : m), '');
    from = last ? addDays(last, -1) : START_DATE; // re-checa el día anterior por juegos tardíos
    to = today;
  }
  to = to || today;
  if (from > to) { console.log(`Nada que hacer: ${from} > ${to}`); }

  const t0 = Date.now();
  let added = 0, failed = 0, days = 0, stoppedAt = null;

  // Guarda todo lo avanzado (se llama cada N días y al final)
  async function save(slate) {
    games.sort((x, y) => (x.date + x.id).localeCompare(y.date + y.id));
    for (const season of pDirty) {
      const ids = new Set(); // dedupe por (juego, jugador)
      const rows = pSeasons[season].filter(r => { const k = r[0] + '|' + r[1]; if (ids.has(k)) return false; ids.add(k); return true; });
      pSeasons[season] = rows;
      await fs.writeFile(path.join(PLAYERS_DIR, `${season}.json`), '[\n' + rows.map(r => JSON.stringify(r)).join(',\n') + '\n]');
    }
    await fs.writeFile(ATHLETES_JSON, JSON.stringify(athletes));
    await fs.writeFile(GAMES_JSON, JSON.stringify(games));
    await fs.writeFile(GAMES_CSV, toCSV(games));
    if (slate) await fs.writeFile(SLATE_JSON, JSON.stringify(slate));
    await fs.writeFile(META_JSON, JSON.stringify({ updated: new Date().toISOString(), games: games.length, last_date: games.at(-1)?.date ?? null, season_types: SEASON_TYPES,
      player_seasons: Object.keys(pSeasons).filter(k => pSeasons[k].length).sort(), player_cols: P_COLS }, null, 2));
  }

  async function processEvent(ev, d) {
    try {
      const summary = await getJSON(`${BASE}/summary?event=${ev.id}`);
      const season = ev.season?.year ?? 'na';
      const prow = parsePlayers(ev.id, summary, athletes);
      addPlayers(season, prow); havePlayers.add(ev.id);
      if (have.has(ev.id)) { console.log(`  jugadores ${d} ${ev.id} (${prow.length})`); return; }
      const g = parseGame(ev, summary);
      g.date = d;
      games.push(g); have.add(ev.id); added++;
      console.log(`+ ${d} ${g.a.t} ${g.a.pts} @ ${g.h.t} ${g.h.pts}  (AST ${g.a.ast}+${g.h.ast}) · ${prow.length} jugadores`);
    } catch (e) {
      failed++; console.warn(`! ${d} ${ev.id} no se pudo bajar (${e.message}); se reintenta en la próxima corrida`);
    }
  }

  for (let d = from; d <= to; d = addDays(d, 1)) {
    if ((Date.now() - t0) / 60000 > MAX_MINUTES) { stoppedAt = d; break; }
    let events = [];
    try { events = (await getJSON(`${BASE}/scoreboard?dates=${ymd(d)}&limit=50`)).events || []; }
    catch (e) { console.warn(`! ${d} calendario no disponible (${e.message})`); failed++; continue; }
    const todo = events.filter(ev => ev.status?.type?.completed && SEASON_TYPES.includes(ev.season?.type) && isNbaEvent(ev) && !(have.has(ev.id) && havePlayers.has(ev.id)));
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      await Promise.all(todo.slice(i, i + CONCURRENCY).map(ev => processEvent(ev, d)));
      await sleep(DELAY_MS);
    }
    if (++days % SAVE_EVERY_DAYS === 0) { await save(); console.log(`· progreso guardado hasta ${d} (${games.length} partidos)`); }
  }

  // Calendario próximo (hoy y mañana) como respaldo si el navegador no puede llamar a ESPN
  const slate = [];
  for (const d of [today, addDays(today, 1)]) {
    try {
      const sb = await getJSON(`${BASE}/scoreboard?dates=${ymd(d)}&limit=50`);
      for (const ev of sb.events || []) {
        const c = ev.competitions[0].competitors;
        let inj = {}, mk;
        try {
          await sleep(DELAY_MS); const sm = await getJSON(`${BASE}/summary?event=${ev.id}`);
          inj = parseInjuries(sm, athletes);
          const pc = (sm.pickcenter || [])[0] || ev.competitions[0].odds?.[0];
          if (pc && num(pc.overUnder) != null) mk = { ou: num(pc.overUnder), sp: num(pc.spread), p: pc.provider?.name || '', det: pc.details || '', ...ouOdds(pc) };
        } catch {}
        slate.push({
          id: ev.id, date: d, start: ev.date, type: ev.season?.type,
          h: c.find(x => x.homeAway === 'home').team.abbreviation,
          a: c.find(x => x.homeAway === 'away').team.abbreviation,
          inj, ...(mk ? { mk } : {}),
        });
      }
    } catch (e) { console.warn('slate', d, e.message); }
  }

  // Rosters actuales de los 30 equipos (traspasos, agentes libres, novatos)
  try {
    const prev = await load(ROSTERS_JSON, { teams: {} });
    const tj = await getJSON(`${BASE}/teams`);
    const list = (tj.sports?.[0]?.leagues?.[0]?.teams || []).map(x => x.team).filter(t => NBA.has(t.abbreviation));
    const teams = { ...prev.teams };
    let season = prev.season ?? null, ok = 0;
    for (const t of list) {
      try {
        await sleep(DELAY_MS);
        const r = await getJSON(`${BASE}/teams/${t.id}/roster`);
        season = r.season?.year ?? season;
        teams[t.abbreviation] = (r.athletes || []).map(a => {
          athletes[a.id] = [a.displayName, a.shortName || athletes[a.id]?.[1] || '', a.position?.abbreviation || athletes[a.id]?.[2] || '', a.jersey || athletes[a.id]?.[3] || ''];
          const inj = a.injuries?.[0]?.status || '';
          return [String(a.id), inj];
        });
        ok++;
      } catch (e) { console.warn(`roster ${t.abbreviation}: ${e.message}`); }
    }
    if (ok) {
      await fs.writeFile(ROSTERS_JSON, JSON.stringify({ updated: new Date().toISOString(), season, season_start: season ? `${season - 1}-10-01` : null, teams }));
      console.log(`Rosters: ${ok}/30 equipos actualizados (temporada ${season})`);
    }
  } catch (e) { console.warn('rosters', e.message); }

  await save(slate);
  console.log(`Listo: ${added} partidos nuevos, ${games.length} en total${failed ? `, ${failed} pendientes por error` : ''}.`);
  if (stoppedAt) console.log(`Se cortó por tiempo en ${stoppedAt}. Vuelve a correr el mismo rango: lo ya guardado se salta solo.`);
}

main().catch(e => { console.error(e); process.exit(1); });
