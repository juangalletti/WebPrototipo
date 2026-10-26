// Consultas de historial y estadisticas sobre la tabla 'eventos'.
// Todas las fechas se interpretan en hora de Argentina (ZONA).
import { query, ZONA } from './db.js';

// YYYY-MM-DD y ademas una fecha que exista (descarta 2026-13-01 o 2026-02-30)
export function fechaValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}
export const TIPOS_EVENTO = ['entrada', 'salida', 'reset', 'correccion'];
const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

// Rango [desde 00:00, hasta 23:59:59] en hora local. Parametros: $1 desde, $2 hasta, $3 zona.
const RANGO = `WITH r AS (SELECT ($1::date)::timestamp AT TIME ZONE $3 AS ini,
                                 (($2::date) + 1)::timestamp AT TIME ZONE $3 AS fin)`;

// Ocupacion maxima de cada hora de hoy (0 .. hora actual).
// La ocupacion "arrastra" el ultimo valor conocido: si no hubo eventos en una hora,
// esa hora vale lo mismo que la anterior.
export async function ocupacionPorHoraHoy() {
  const [{ inicio, hora }] = await query(
    `SELECT date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 AS inicio,
            extract(hour FROM now() AT TIME ZONE $1)::int AS hora`, [ZONA]);
  const previo = await query(
    'SELECT personas FROM eventos WHERE ts < $1 ORDER BY ts DESC, id DESC LIMIT 1', [inicio]);
  const eventos = await query(
    `SELECT extract(hour FROM ts AT TIME ZONE $2)::int AS h, personas
       FROM eventos WHERE ts >= $1 ORDER BY ts, id`, [inicio, ZONA]);

  let actual = previo.length ? previo[0].personas : 0;
  const valores = [];
  let i = 0;
  for (let h = 0; h <= hora; h++) {
    let maximo = actual;
    while (i < eventos.length && eventos[i].h === h) {
      actual = eventos[i].personas;
      maximo = Math.max(maximo, actual);
      i++;
    }
    valores.push(maximo);
  }
  return valores;
}

export async function hoyLocal() {
  const [{ hoy }] = await query(`SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS hoy`, [ZONA]);
  return hoy;
}

function* diasEntre(desde, hasta) {
  const d = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  while (d <= fin) {
    yield { fecha: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

export async function estadisticasRango(desde, hasta) {
  const p = [desde, hasta, ZONA];

  const totales = Object.fromEntries(TIPOS_EVENTO.map((t) => [t, 0]));
  for (const f of await query(
    `${RANGO} SELECT tipo, count(*)::int AS n FROM eventos, r
              WHERE ts >= r.ini AND ts < r.fin GROUP BY tipo`, p)) {
    totales[f.tipo] = f.n;
  }

  const [pico] = await query(
    `${RANGO} SELECT personas, to_char(ts AT TIME ZONE $3, 'DD/MM/YYYY HH24:MI') AS cuando
                FROM eventos, r WHERE ts >= r.ini AND ts < r.fin
               ORDER BY personas DESC, ts LIMIT 1`, p);

  const porDia = new Map((await query(
    `${RANGO} SELECT to_char(ts AT TIME ZONE $3, 'YYYY-MM-DD') AS dia,
                     count(*) FILTER (WHERE tipo = 'entrada')::int AS entradas,
                     count(*) FILTER (WHERE tipo = 'salida')::int AS salidas,
                     max(personas)::int AS maximo
                FROM eventos, r WHERE ts >= r.ini AND ts < r.fin
               GROUP BY dia`, p)).map((f) => [f.dia, f]));

  const entradasPorHora = Array(24).fill(0);
  for (const f of await query(
    `${RANGO} SELECT extract(hour FROM ts AT TIME ZONE $3)::int AS h, count(*)::int AS n
                FROM eventos, r WHERE ts >= r.ini AND ts < r.fin AND tipo = 'entrada'
               GROUP BY h`, p)) {
    entradasPorHora[f.h] = f.n;
  }

  // Serie diaria completa (los dias sin eventos valen 0) y promedio por dia de la semana.
  const serie = [];
  const sumaDow = Array(7).fill(0);
  const cantDow = Array(7).fill(0);
  for (const { fecha, dow } of diasEntre(desde, hasta)) {
    const f = porDia.get(fecha) || { entradas: 0, salidas: 0, maximo: 0 };
    serie.push({ fecha, entradas: f.entradas, salidas: f.salidas, maximo: f.maximo });
    sumaDow[dow] += f.entradas;
    cantDow[dow]++;
  }
  // Orden Lun..Dom
  const promedioPorDia = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({
    dia: DIAS_SEMANA[dow],
    promedio: cantDow[dow] ? Math.round((sumaDow[dow] / cantDow[dow]) * 10) / 10 : 0,
  }));

  const diasConActividad = serie.filter((d) => d.entradas > 0).length;
  return {
    desde, hasta, totales,
    pico: pico || null,
    diasConActividad,
    promedioEntradasDiaActivo: diasConActividad ? Math.round((totales.entrada / diasConActividad) * 10) / 10 : 0,
    serie, promedioPorDia, entradasPorHora,
  };
}

// Listado de eventos filtrado. pagina empieza en 1; porPagina = null => todos (para CSV).
export async function listarEventos({ desde, hasta, tipo, pagina = 1, porPagina = 50 }) {
  const p = [desde, hasta, ZONA];
  let filtroTipo = '';
  if (tipo) { p.push(tipo); filtroTipo = `AND tipo = $${p.length}`; }

  const [{ total }] = await query(
    `${RANGO} SELECT count(*)::int AS total FROM eventos, r
              WHERE ts >= r.ini AND ts < r.fin ${filtroTipo}`, p);

  let limite = '';
  if (porPagina) {
    p.push(porPagina, (pagina - 1) * porPagina);
    limite = `LIMIT $${p.length - 1} OFFSET $${p.length}`;
  }
  const filas = await query(
    `${RANGO} SELECT id, to_char(ts AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI:SS') AS fecha_hora,
                     tipo, personas, ts_estimado
                FROM eventos, r WHERE ts >= r.ini AND ts < r.fin ${filtroTipo}
               ORDER BY ts DESC, id DESC ${limite}`, p);
  return { total, filas };
}
