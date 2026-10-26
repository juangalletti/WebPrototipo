// Apartado admin: login, control del contador, registro, estadisticas, salud, auditoria y usuarios.
import { Router } from 'express';
import { query, auditar, ZONA } from '../db.js';
import {
  hashear, verificarPassword, crearCookieSesion, borrarCookieSesion, requiereAdmin,
  loginBloqueado, registrarFallo, limpiarFallos,
} from '../auth.js';
import { infoConexion } from '../estado.js';
import { fechaValida, TIPOS_EVENTO, estadisticasRango, listarEventos, hoyLocal } from '../estadisticas.js';

export const rutasAdmin = Router();

const MAX_DIAS_RANGO = 366;
const USUARIO_VALIDO = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_LARGO_PASSWORD = 8;
// Hash de relleno: si el usuario no existe se verifica igual, para no revelar por el tiempo de respuesta
const HASH_RELLENO = hashear('relleno-para-tiempo-constante');

// Lee ?desde=&hasta= (YYYY-MM-DD). Por defecto, los ultimos 30 dias.
async function leerRango(req, res) {
  const hoy = await hoyLocal();
  const hace30 = new Date(Date.parse(`${hoy}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const desde = req.query.desde || hace30;
  const hasta = req.query.hasta || hoy;
  if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) {
    res.status(400).json({ error: 'Rango de fechas invalido' });
    return null;
  }
  if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > MAX_DIAS_RANGO) {
    res.status(400).json({ error: `El rango no puede superar ${MAX_DIAS_RANGO} dias` });
    return null;
  }
  return { desde, hasta };
}

// ---------------------------------------------------------------------
// Sesion
// ---------------------------------------------------------------------
rutasAdmin.post('/login', async (req, res) => {
  const ip = req.ip;
  if (loginBloqueado(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Proba de nuevo en 15 minutos.' });
  }
  const { usuario, password } = req.body || {};
  if (typeof usuario !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Faltan usuario y contrasena' });
  }
  const [fila] = await query('SELECT hash FROM usuarios WHERE usuario = $1', [usuario]);
  const ok = verificarPassword(password, fila ? fila.hash : HASH_RELLENO) && Boolean(fila);
  if (!ok) {
    registrarFallo(ip);
    await auditar(usuario.slice(0, 32), 'login_fallido', `IP ${ip}`);
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }
  limpiarFallos(ip);
  crearCookieSesion(res, usuario);
  await auditar(usuario, 'login', `IP ${ip}`);
  res.json({ usuario });
});

rutasAdmin.post('/logout', requiereAdmin, async (req, res) => {
  await auditar(req.usuario, 'logout');
  borrarCookieSesion(res);
  res.json({ ok: true });
});

rutasAdmin.get('/yo', requiereAdmin, (req, res) => res.json({ usuario: req.usuario }));

// ---------------------------------------------------------------------
// Control del contador: los comandos los ejecuta el ESP32 en su proximo sync
// ---------------------------------------------------------------------
rutasAdmin.post('/comandos', requiereAdmin, async (req, res) => {
  const { tipo, valor } = req.body || {};
  if (tipo === 'reset') {
    const [c] = await query(
      `INSERT INTO comandos (tipo, usuario) VALUES ('reset', $1) RETURNING id`, [req.usuario]);
    await auditar(req.usuario, 'reset_contador', `comando #${c.id}`);
    return res.json({ id: c.id });
  }
  if (tipo === 'fijar') {
    if (!Number.isInteger(valor) || valor < 0 || valor > 10000) {
      return res.status(400).json({ error: 'El valor tiene que ser un entero entre 0 y 10000' });
    }
    const [c] = await query(
      `INSERT INTO comandos (tipo, valor, usuario) VALUES ('fijar', $1, $2) RETURNING id`, [valor, req.usuario]);
    await auditar(req.usuario, 'correccion_contador', `fijar en ${valor} (comando #${c.id})`);
    return res.json({ id: c.id });
  }
  res.status(400).json({ error: 'Tipo de comando desconocido' });
});

rutasAdmin.get('/comandos', requiereAdmin, async (req, res) => {
  res.json(await query(
    `SELECT id, tipo, valor, usuario, estado,
            to_char(creado AT TIME ZONE $1, 'DD/MM HH24:MI:SS') AS creado,
            to_char(confirmado AT TIME ZONE $1, 'DD/MM HH24:MI:SS') AS confirmado
       FROM comandos ORDER BY id DESC LIMIT 20`, [ZONA]));
});

// ---------------------------------------------------------------------
// Registro de eventos y exportacion CSV
// ---------------------------------------------------------------------
function leerTipo(req, res) {
  const tipo = req.query.tipo || null;
  if (tipo && !TIPOS_EVENTO.includes(tipo)) {
    res.status(400).json({ error: 'Tipo de evento invalido' });
    return undefined;
  }
  return tipo;
}

rutasAdmin.get('/eventos', requiereAdmin, async (req, res) => {
  const rango = await leerRango(req, res);
  if (!rango) return;
  const tipo = leerTipo(req, res);
  if (tipo === undefined) return;
  const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
  res.json({ pagina, porPagina: 50, ...(await listarEventos({ ...rango, tipo, pagina })) });
});

rutasAdmin.get('/eventos.csv', requiereAdmin, async (req, res) => {
  const rango = await leerRango(req, res);
  if (!rango) return;
  const tipo = leerTipo(req, res);
  if (tipo === undefined) return;
  const { filas } = await listarEventos({ ...rango, tipo, porPagina: null });
  const lineas = ['fecha_hora,tipo,personas,hora_estimada'];
  for (const f of filas.reverse()) {
    lineas.push(`${f.fecha_hora},${f.tipo},${f.personas},${f.ts_estimado ? 'si' : 'no'}`);
  }
  await auditar(req.usuario, 'exportar_csv', `${rango.desde} a ${rango.hasta}${tipo ? ` (${tipo})` : ''}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="eventos_${rango.desde}_${rango.hasta}.csv"`);
  res.send('﻿' + lineas.join('\r\n') + '\r\n');   // BOM para que Excel respete los acentos
});

// ---------------------------------------------------------------------
// Estadisticas
// ---------------------------------------------------------------------
rutasAdmin.get('/estadisticas', requiereAdmin, async (req, res) => {
  const rango = await leerRango(req, res);
  if (!rango) return;
  res.json(await estadisticasRango(rango.desde, rango.hasta));
});

// ---------------------------------------------------------------------
// Salud del sistema
// ---------------------------------------------------------------------
rutasAdmin.get('/salud', requiereAdmin, async (req, res) => {
  const [fila] = await query(
    `SELECT datos, to_char(actualizado AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI:SS') AS actualizado
       FROM estado_central WHERE id = 1`, [ZONA]);
  const conexiones = await query(
    `SELECT to_char(ts AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI:SS') AS fecha_hora, tipo, detalle
       FROM conexiones ORDER BY id DESC LIMIT 50`, [ZONA]);
  const [desconexiones] = await query(
    `SELECT count(*) FILTER (WHERE tipo = 'central_fuera_de_linea')::int AS central,
            count(*) FILTER (WHERE tipo = 'sensor_sin_senal')::int AS sensor
       FROM conexiones WHERE ts > now() - interval '7 days'`);
  res.json({
    ...infoConexion(),
    ultimoEstado: fila ? fila.datos : null,
    actualizado: fila ? fila.actualizado : null,
    desconexiones7dias: desconexiones,
    conexiones,
  });
});

// ---------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------
rutasAdmin.get('/auditoria', requiereAdmin, async (req, res) => {
  const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
  const [{ total }] = await query('SELECT count(*)::int AS total FROM auditoria');
  const filas = await query(
    `SELECT to_char(ts AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI:SS') AS fecha_hora, usuario, accion, detalle
       FROM auditoria ORDER BY id DESC LIMIT 50 OFFSET $2`, [ZONA, (pagina - 1) * 50]);
  res.json({ pagina, porPagina: 50, total, filas });
});

// ---------------------------------------------------------------------
// Usuarios admin
// ---------------------------------------------------------------------
rutasAdmin.get('/usuarios', requiereAdmin, async (req, res) => {
  res.json(await query(
    `SELECT usuario, to_char(creado AT TIME ZONE $1, 'DD/MM/YYYY') AS creado FROM usuarios ORDER BY usuario`,
    [ZONA]));
});

rutasAdmin.post('/usuarios', requiereAdmin, async (req, res) => {
  const { usuario, password } = req.body || {};
  if (typeof usuario !== 'string' || !USUARIO_VALIDO.test(usuario)) {
    return res.status(400).json({ error: 'Usuario: 3 a 32 caracteres (letras, numeros, . _ -)' });
  }
  if (typeof password !== 'string' || password.length < MIN_LARGO_PASSWORD) {
    return res.status(400).json({ error: `La contrasena debe tener al menos ${MIN_LARGO_PASSWORD} caracteres` });
  }
  const filas = await query(
    'INSERT INTO usuarios (usuario, hash) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING usuario',
    [usuario, hashear(password)]);
  if (filas.length === 0) return res.status(409).json({ error: 'Ese usuario ya existe' });
  await auditar(req.usuario, 'crear_usuario', usuario);
  res.json({ usuario });
});

rutasAdmin.delete('/usuarios/:usuario', requiereAdmin, async (req, res) => {
  const usuario = req.params.usuario;
  if (usuario === req.usuario) return res.status(400).json({ error: 'No podes borrar tu propio usuario' });
  const filas = await query('DELETE FROM usuarios WHERE usuario = $1 RETURNING usuario', [usuario]);
  if (filas.length === 0) return res.status(404).json({ error: 'Usuario inexistente' });
  await auditar(req.usuario, 'borrar_usuario', usuario);
  res.json({ ok: true });
});

rutasAdmin.post('/password', requiereAdmin, async (req, res) => {
  const { actual, nueva } = req.body || {};
  const [fila] = await query('SELECT hash FROM usuarios WHERE usuario = $1', [req.usuario]);
  if (typeof actual !== 'string' || !verificarPassword(actual, fila.hash)) {
    return res.status(400).json({ error: 'La contrasena actual no es correcta' });
  }
  if (typeof nueva !== 'string' || nueva.length < MIN_LARGO_PASSWORD) {
    return res.status(400).json({ error: `La contrasena nueva debe tener al menos ${MIN_LARGO_PASSWORD} caracteres` });
  }
  await query('UPDATE usuarios SET hash = $1 WHERE usuario = $2', [hashear(nueva), req.usuario]);
  await auditar(req.usuario, 'cambiar_password');
  res.json({ ok: true });
});
