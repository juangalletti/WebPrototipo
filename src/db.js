// Acceso a la base de datos.
// - En Railway (o donde haya DATABASE_URL) usa PostgreSQL real con 'pg'.
// - En la PC, sin DATABASE_URL, usa PGlite: un Postgres que corre dentro de Node y
//   guarda los datos en ./datos-local. Asi se prueba todo sin instalar nada.
// Las dos opciones entienden el mismo SQL, asi que el resto del codigo no cambia.

export const ZONA = 'America/Argentina/Buenos_Aires';

let ejecutar;

if (process.env.DATABASE_URL) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  ejecutar = async (texto, params) => (await pool.query(texto, params)).rows;
  console.log('Base de datos: PostgreSQL (DATABASE_URL)');
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const { fileURLToPath } = await import('node:url');
  const db = new PGlite(fileURLToPath(new URL('../datos-local', import.meta.url)));
  ejecutar = async (texto, params) => (await db.query(texto, params)).rows;
  console.log('Base de datos: PGlite local en ./datos-local (modo desarrollo)');
}

export function query(texto, params = []) {
  return ejecutar(texto, params);
}

// Se ejecuta en cada arranque; IF NOT EXISTS lo hace seguro de repetir.
const ESQUEMA = [
  // Cada entrada/salida/reset/correccion que informa el ESP32.
  // (boot_id, seq) identifica el evento: si el ESP32 lo reenvia, no se duplica.
  `CREATE TABLE IF NOT EXISTS eventos (
     id          BIGSERIAL PRIMARY KEY,
     boot_id     BIGINT NOT NULL,
     seq         INTEGER NOT NULL,
     tipo        TEXT NOT NULL,
     personas    INTEGER NOT NULL,
     ts          TIMESTAMPTZ NOT NULL,
     ts_estimado BOOLEAN NOT NULL DEFAULT false,
     recibido    TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (boot_id, seq)
   )`,
  `CREATE INDEX IF NOT EXISTS eventos_ts ON eventos (ts)`,

  // Ultimo estado completo que mando el ESP32 (una sola fila).
  `CREATE TABLE IF NOT EXISTS estado_central (
     id          INTEGER PRIMARY KEY DEFAULT 1,
     datos       JSONB NOT NULL,
     actualizado TIMESTAMPTZ NOT NULL
   )`,

  // Ordenes del admin para el ESP32 (reset, fijar valor). El ESP32 las recibe en la
  // respuesta a su proximo envio de estado y confirma con 'ack'.
  `CREATE TABLE IF NOT EXISTS comandos (
     id          SERIAL PRIMARY KEY,
     tipo        TEXT NOT NULL,
     valor       INTEGER,
     usuario     TEXT NOT NULL,
     estado      TEXT NOT NULL DEFAULT 'pendiente',
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     entregado   TIMESTAMPTZ,
     confirmado  TIMESTAMPTZ
   )`,

  // Cambios de conectividad: nodo central en linea / fuera de linea, enlace RF, reinicios.
  `CREATE TABLE IF NOT EXISTS conexiones (
     id      BIGSERIAL PRIMARY KEY,
     ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
     tipo    TEXT NOT NULL,
     detalle TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS auditoria (
     id      BIGSERIAL PRIMARY KEY,
     ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
     usuario TEXT,
     accion  TEXT NOT NULL,
     detalle TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS usuarios (
     usuario TEXT PRIMARY KEY,
     hash    TEXT NOT NULL,
     creado  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS config (
     clave TEXT PRIMARY KEY,
     valor TEXT NOT NULL
   )`,
  `INSERT INTO config (clave, valor) VALUES ('aforo_max', '0'), ('aviso_pct', '80')
     ON CONFLICT (clave) DO NOTHING`,
];

export async function iniciarBase() {
  for (const sentencia of ESQUEMA) await query(sentencia);
}

export async function leerConfig() {
  const filas = await query('SELECT clave, valor FROM config');
  const c = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return { aforoMax: parseInt(c.aforo_max, 10) || 0, avisoPct: parseInt(c.aviso_pct, 10) || 80 };
}

export function auditar(usuario, accion, detalle = null) {
  return query('INSERT INTO auditoria (usuario, accion, detalle) VALUES ($1, $2, $3)', [usuario, accion, detalle]);
}
