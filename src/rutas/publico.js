// Datos para el dashboard publico (sin login).
import { Router } from 'express';
import { query, leerConfig } from '../db.js';
import { infoConexion } from '../estado.js';
import { ocupacionPorHoraHoy } from '../estadisticas.js';
import { obtenerClima } from '../clima.js';

export const rutasPublicas = Router();

rutasPublicas.get('/estado', async (req, res) => {
  const [fila] = await query('SELECT datos FROM estado_central WHERE id = 1');
  const d = fila ? fila.datos : null;
  const conexion = infoConexion();
  const { aforoMax, avisoPct } = await leerConfig();

  res.json({
    ...conexion,
    hayDatos: Boolean(d),
    personasActuales: d ? d.personas : null,
    entradas: d ? d.entradas : null,
    salidas: d ? d.salidas : null,
    maximoHistorico: d ? d.maximoHistorico : null,
    historialSemana: d && Array.isArray(d.historialSemana) ? d.historialSemana : [0, 0, 0, 0, 0],
    // El sensor solo se considera OK si el nodo central esta en linea y ve el enlace RF
    sensorConectado: Boolean(d && conexion.centralEnLinea && d.enlaceRF),
    aforoMax, avisoPct,
    ocupacionPorHora: await ocupacionPorHoraHoy(),
  });
});

rutasPublicas.get('/clima', async (req, res) => {
  const clima = await obtenerClima();
  if (!clima) return res.status(503).json({ error: 'Clima no disponible' });
  res.json(clima);
});
