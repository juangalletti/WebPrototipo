// Login del apartado admin: contrasenas con scrypt y sesion en una cookie firmada (HMAC).
// No usa dependencias externas: todo sale del modulo crypto de Node.
import crypto from 'node:crypto';
import { query } from './db.js';

const DURACION_SESION_MS = 8 * 60 * 60 * 1000;   // 8 horas
const NOMBRE_COOKIE = 'sesion_admin';

let secreto = process.env.SESSION_SECRET;
if (!secreto) {
  secreto = crypto.randomBytes(32).toString('hex');
  console.warn('AVISO: falta SESSION_SECRET; las sesiones se pierden al reiniciar el servidor.');
}

// ---- Contrasenas ----
export function hashear(password) {
  const sal = crypto.randomBytes(16);
  const clave = crypto.scryptSync(password, sal, 64);
  return `scrypt$${sal.toString('hex')}$${clave.toString('hex')}`;
}

export function verificarPassword(password, guardado) {
  const [, salHex, claveHex] = guardado.split('$');
  const esperada = Buffer.from(claveHex, 'hex');
  const calculada = crypto.scryptSync(password, Buffer.from(salHex, 'hex'), esperada.length);
  return crypto.timingSafeEqual(esperada, calculada);
}

// Primer arranque: si no hay usuarios, se crea el admin con ADMIN_USER / ADMIN_PASSWORD.
export async function crearAdminInicial() {
  const [{ total }] = await query('SELECT count(*)::int AS total FROM usuarios');
  if (total > 0) return;
  const usuario = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!usuario || !password) {
    console.warn('AVISO: no hay usuarios y faltan ADMIN_USER / ADMIN_PASSWORD: el admin no tiene acceso.');
    return;
  }
  await query('INSERT INTO usuarios (usuario, hash) VALUES ($1, $2)', [usuario, hashear(password)]);
  console.log(`Usuario admin inicial creado: ${usuario}`);
}

// ---- Sesion en cookie firmada: base64url(datos).firma ----
function firmar(texto) {
  return crypto.createHmac('sha256', secreto).update(texto).digest('base64url');
}

export function crearCookieSesion(res, usuario) {
  const datos = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + DURACION_SESION_MS })).toString('base64url');
  const valor = `${datos}.${firmar(datos)}`;
  const seguro = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${NOMBRE_COOKIE}=${valor}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACION_SESION_MS / 1000}${seguro}`);
}

export function borrarCookieSesion(res) {
  res.setHeader('Set-Cookie', `${NOMBRE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function leerSesion(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const valor = cookies[NOMBRE_COOKIE];
  if (!valor) return null;
  const [datos, firma] = valor.split('.');
  if (!datos || !firma) return null;
  const esperada = Buffer.from(firmar(datos));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  const sesion = JSON.parse(Buffer.from(datos, 'base64url').toString());
  return sesion.exp > Date.now() ? sesion.u : null;
}

// Middleware: exige sesion valida de un usuario que siga existiendo.
// Los POST ademas tienen que ser JSON: un formulario de otro sitio no puede mandar
// application/json sin permiso del navegador, eso evita ataques CSRF.
export async function requiereAdmin(req, res, next) {
  const usuario = leerSesion(req);
  if (!usuario) return res.status(401).json({ error: 'Sesion no iniciada o vencida' });
  const filas = await query('SELECT 1 FROM usuarios WHERE usuario = $1', [usuario]);
  if (filas.length === 0) return res.status(401).json({ error: 'Usuario inexistente' });
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Se esperaba JSON' });
  }
  req.usuario = usuario;
  next();
}

// ---- Limite de intentos de login: 5 fallos cada 15 minutos por IP ----
const fallos = new Map();
const VENTANA_FALLOS_MS = 15 * 60 * 1000;
const MAX_FALLOS = 5;

export function loginBloqueado(ip) {
  const f = fallos.get(ip);
  if (!f || Date.now() - f.desde > VENTANA_FALLOS_MS) return false;
  return f.cantidad >= MAX_FALLOS;
}

export function registrarFallo(ip) {
  const f = fallos.get(ip);
  if (!f || Date.now() - f.desde > VENTANA_FALLOS_MS) fallos.set(ip, { cantidad: 1, desde: Date.now() });
  else f.cantidad++;
}

export function limpiarFallos(ip) {
  fallos.delete(ip);
}

// ---- Autenticacion del ESP32: cabecera X-API-Key ----
export function requiereDispositivo(req, res, next) {
  const clave = process.env.DEVICE_API_KEY;
  if (!clave) return res.status(503).json({ error: 'Falta DEVICE_API_KEY en el servidor' });
  const recibida = Buffer.from(req.get('X-API-Key') || '');
  const esperada = Buffer.from(clave);
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) {
    return res.status(401).json({ error: 'Clave de dispositivo invalida' });
  }
  next();
}
