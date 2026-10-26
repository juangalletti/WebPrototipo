// API que usa el ESP32. Un solo endpoint para hacer una sola conexion HTTPS por ciclo:
//
// POST /api/dispositivo/sync   (cabecera X-API-Key)
// {
//   "bootId": 123456789,          numero al azar que el ESP32 elige en cada arranque
//   "uptimeMs": 54000,            millis() al momento del envio
//   "personas": 3, "entradas": 10, "salidas": 7, "maximoHistorico": 12,
//   "historialSemana": [5,8,0,0,0],
//   "enlaceRF": true, "radioOk": true, "sdDisponible": true,
//   "perdidosRF": 0, "rssi": -60, "ip": "192.168.1.42", "horaSincronizada": true,
//   "eventos": [ { "seq": 41, "tipo": "entrada", "personas": 3, "epoch": 1761500000, "uptimeMs": 53000 } ],
//   "ack": [7]                     ids de comandos ya ejecutados
// }
// Respuesta: { "eventosRecibidos": [41], "comandos": [ { "id": 8, "tipo": "reset" } ] }
//
// - "eventosRecibidos" incluye los repetidos: el ESP32 puede sacarlos de su cola.
// - Si el evento no tiene hora (epoch = 0, sin NTP), se estima con el uptime:
//   hora = ahora - (uptimeMs del envio - uptimeMs del evento).
import { Router } from 'express';
import { query } from '../db.js';
import { requiereDispositivo } from '../auth.js';
import { contactoCentral } from '../estado.js';
import { TIPOS_EVENTO } from '../estadisticas.js';

const VENCIMIENTO_COMANDO = '5 minutes';   // un reset viejo no debe aplicarse horas despues
const MAX_EVENTOS_POR_SYNC = 200;

export const rutasDispositivo = Router();

const esEntero = (v) => Number.isInteger(v);

rutasDispositivo.post('/sync', requiereDispositivo, async (req, res) => {
  const d = req.body;
  if (!d || !esEntero(d.bootId) || !esEntero(d.uptimeMs) || !esEntero(d.personas)) {
    return res.status(400).json({ error: 'Faltan bootId, uptimeMs o personas' });
  }
  const eventos = Array.isArray(d.eventos) ? d.eventos.slice(0, MAX_EVENTOS_POR_SYNC) : [];
  const ack = Array.isArray(d.ack) ? d.ack.filter(esEntero) : [];

  const ahora = Date.now();
  const recibidos = [];
  for (const e of eventos) {
    if (!e || !esEntero(e.seq) || !TIPOS_EVENTO.includes(e.tipo) || !esEntero(e.personas)) continue;
    const tieneHora = esEntero(e.epoch) && e.epoch > 1600000000;
    const ts = tieneHora
      ? new Date(e.epoch * 1000)
      : new Date(ahora - Math.max(0, d.uptimeMs - (esEntero(e.uptimeMs) ? e.uptimeMs : d.uptimeMs)));
    await query(
      `INSERT INTO eventos (boot_id, seq, tipo, personas, ts, ts_estimado)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (boot_id, seq) DO NOTHING`,
      [d.bootId, e.seq, e.tipo, e.personas, ts, !tieneHora]);
    recibidos.push(e.seq);
  }

  const { eventos: _e, ack: _a, ...estado } = d;
  await query(
    `INSERT INTO estado_central (id, datos, actualizado) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET datos = EXCLUDED.datos, actualizado = EXCLUDED.actualizado`,
    [JSON.stringify(estado)]);
  await contactoCentral(estado);

  if (ack.length) {
    await query(
      `UPDATE comandos SET estado = 'confirmado', confirmado = now()
        WHERE id = ANY($1::int[]) AND estado = 'pendiente'`, [ack]);
  }
  await query(
    `UPDATE comandos SET estado = 'vencido'
      WHERE estado = 'pendiente' AND creado < now() - interval '${VENCIMIENTO_COMANDO}'`);
  const comandos = await query(
    `UPDATE comandos SET entregado = coalesce(entregado, now())
      WHERE estado = 'pendiente' RETURNING id, tipo, valor`);
  comandos.sort((a, b) => a.id - b.id);

  res.json({
    eventosRecibidos: recibidos,
    comandos: comandos.map((c) => (c.tipo === 'fijar' ? c : { id: c.id, tipo: c.tipo })),
  });
});
