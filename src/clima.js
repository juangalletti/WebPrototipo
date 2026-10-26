// Clima actual de Neuquen capital, desde Open-Meteo (gratis, sin clave).
// Lo consulta el servidor y lo guarda CACHE_MS: aunque haya muchos visitantes, a Open-Meteo
// le llega como mucho un pedido cada 10 minutos.
const NEUQUEN = { latitud: -38.9516, longitud: -68.0591 };
const CACHE_MS = 10 * 60 * 1000;
const VIEJO_MAX_MS = 2 * 60 * 60 * 1000;   // si Open-Meteo falla, se muestra el ultimo dato hasta 2 h
const TIMEOUT_MS = 8000;

const URL_CLIMA = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: NEUQUEN.latitud,
  longitude: NEUQUEN.longitud,
  current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
  daily: 'temperature_2m_max,temperature_2m_min',
  timezone: 'America/Argentina/Buenos_Aires',
  forecast_days: '1',
  wind_speed_unit: 'kmh',
});

// Codigos WMO que usa Open-Meteo -> descripcion e icono
function describirCodigo(codigo, esDeDia) {
  const sol = esDeDia ? '☀️' : '🌙';
  const tabla = [
    [[0], 'Despejado', sol],
    [[1], 'Mayormente despejado', esDeDia ? '🌤️' : '🌙'],
    [[2], 'Parcialmente nublado', esDeDia ? '⛅' : '☁️'],
    [[3], 'Nublado', '☁️'],
    [[45, 48], 'Niebla', '🌫️'],
    [[51, 53, 55, 56, 57], 'Llovizna', '🌦️'],
    [[61, 63, 65, 66, 67, 80, 81, 82], 'Lluvia', '🌧️'],
    [[71, 73, 75, 77, 85, 86], 'Nieve', '🌨️'],
    [[95, 96, 99], 'Tormenta', '⛈️'],
  ];
  const fila = tabla.find(([codigos]) => codigos.includes(codigo));
  return fila ? { descripcion: fila[1], icono: fila[2] } : { descripcion: 'Sin datos', icono: '🌡️' };
}

const PUNTOS_CARDINALES = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const puntoCardinal = (grados) => PUNTOS_CARDINALES[Math.round(grados / 45) % 8];

let ultimo = null;        // { datos, obtenido }
let pedidoEnCurso = null; // si llegan varios visitantes juntos, se hace un solo pedido

async function pedirClima() {
  const res = await fetch(URL_CLIMA, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo respondio HTTP ${res.status}`);
  const j = await res.json();
  const c = j.current;
  return {
    ciudad: 'Neuquén',
    temperatura: Math.round(c.temperature_2m),
    sensacion: Math.round(c.apparent_temperature),
    humedad: c.relative_humidity_2m,
    viento: Math.round(c.wind_speed_10m),
    rafagas: Math.round(c.wind_gusts_10m),
    direccionViento: puntoCardinal(c.wind_direction_10m),
    minima: Math.round(j.daily.temperature_2m_min[0]),
    maxima: Math.round(j.daily.temperature_2m_max[0]),
    ...describirCodigo(c.weather_code, c.is_day === 1),
    medido: c.time,   // hora local de la medicion, "2026-10-26T19:15"
  };
}

// Devuelve el clima (de la cache si es reciente) o null si no hay ningun dato utilizable.
export async function obtenerClima() {
  const ahora = Date.now();
  if (ultimo && ahora - ultimo.obtenido < CACHE_MS) return ultimo.datos;
  try {
    pedidoEnCurso ??= pedirClima().finally(() => { pedidoEnCurso = null; });
    const datos = await pedidoEnCurso;
    ultimo = { datos, obtenido: Date.now() };
    return datos;
  } catch (err) {
    console.error('Clima:', err.message);
    if (ultimo && ahora - ultimo.obtenido < VIEJO_MAX_MS) return ultimo.datos;
    return null;
  }
}
