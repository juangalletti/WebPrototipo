// Seguimiento en memoria de la conexion del nodo central (ESP32) y del enlace RF.
// Cada cambio queda registrado en la tabla 'conexiones' para el historial de salud.
import { query } from './db.js';

export const FUERA_DE_LINEA_MS = 30000;   // sin noticias del ESP32 durante este tiempo => fuera de linea

// Motivos de reinicio que manda el ESP32 (leerMotivoReinicio en el firmware)
export const MOTIVOS_REINICIO = {
  encendido: 'encendido (se enchufó o volvió la luz)',
  pin_reset: 'botón de reset',
  software: 'reinicio por software',
  sin_sync: 'reinicio automático (20 min sin sincronizar)',
  error_programa: 'error del programa',
  watchdog: 'watchdog (el programa se colgó)',
  caida_tension: 'caída de tensión (la fuente no da suficiente corriente)',
  desconocido: 'desconocido',
};

let ultimoContacto = null;   // Date del ultimo sync del ESP32
let enLinea = false;
let ultimoBootId = null;
let ultimoEnlaceRF = null;

function registrar(tipo, detalle = null) {
  return query('INSERT INTO conexiones (tipo, detalle) VALUES ($1, $2)', [tipo, detalle]);
}

// Al arrancar el servidor se recupera lo ultimo conocido, para no registrar cambios falsos.
export async function cargarEstadoConexion() {
  const filas = await query('SELECT datos, actualizado FROM estado_central WHERE id = 1');
  if (filas.length === 0) return;
  ultimoContacto = new Date(filas[0].actualizado);
  ultimoBootId = filas[0].datos.bootId ?? null;
  ultimoEnlaceRF = filas[0].datos.enlaceRF ?? null;
  enLinea = Date.now() - ultimoContacto.getTime() < FUERA_DE_LINEA_MS;
}

// Se llama en cada sync del ESP32.
export async function contactoCentral(datos) {
  if (!enLinea) {
    const via = datos.conexion === 'ethernet' ? 'por cable' : datos.red ? `por WiFi ${datos.red}` : '';
    await registrar('central_en_linea', datos.ip ? `IP ${datos.ip} ${via}`.trim() : null);
    enLinea = true;
  }
  if (ultimoBootId !== null && datos.bootId !== ultimoBootId) {
    const motivo = MOTIVOS_REINICIO[datos.motivoReinicio] || datos.motivoReinicio || 'motivo desconocido';
    await registrar('central_reiniciado', `${motivo} · encendido hace ${Math.round(datos.uptimeMs / 1000)} s`);
  }
  if (ultimoEnlaceRF !== null && datos.enlaceRF !== ultimoEnlaceRF) {
    await registrar(datos.enlaceRF ? 'sensor_conectado' : 'sensor_sin_senal');
  }
  ultimoContacto = new Date();
  ultimoBootId = datos.bootId;
  ultimoEnlaceRF = datos.enlaceRF;
}

// Revisa cada 10 s si el ESP32 dejo de reportar.
export function vigilarConexion() {
  setInterval(async () => {
    if (enLinea && Date.now() - ultimoContacto.getTime() > FUERA_DE_LINEA_MS) {
      enLinea = false;
      await registrar('central_fuera_de_linea');
    }
  }, 10000);
}

export function infoConexion() {
  return {
    centralEnLinea: enLinea,
    ultimoContactoSeg: ultimoContacto ? Math.round((Date.now() - ultimoContacto.getTime()) / 1000) : null,
  };
}
