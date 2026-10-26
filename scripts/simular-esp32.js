// Simulador del ESP32: se comporta como el nodo central para probar el servidor sin hardware.
//
//   npm run simular                    -> modo en vivo: sync cada 5 s con entradas/salidas al azar
//   npm run simular -- --historial 30  -> primero carga 30 dias de eventos de ejemplo, despues en vivo
//
// Usa SERVIDOR (por defecto http://localhost:3000) y DEVICE_API_KEY del archivo .env.
const SERVIDOR = process.env.SERVIDOR || `http://localhost:${process.env.PORT || 3000}`;
const CLAVE = process.env.DEVICE_API_KEY;
const INTERVALO_SYNC_MS = 5000;

if (!CLAVE) { console.error('Falta DEVICE_API_KEY en .env'); process.exit(1); }

const inicio = Date.now();
const estado = {
  bootId: Math.floor(Math.random() * 0xffffffff),
  personas: 0, entradas: 0, salidas: 0, maximoHistorico: 0, historialSemana: [0, 0, 0, 0, 0],
  enlaceRF: true, radioOk: true, sdDisponible: true, perdidosRF: 0, rssi: -58,
  ip: '192.168.1.42', horaSincronizada: true,
};
let seq = 0;
let cola = [];        // eventos pendientes de confirmar por el servidor
let ack = [];         // comandos ejecutados, a confirmar en el proximo sync
const uptime = () => Date.now() - inicio;

function evento(tipo, epochSeg = Math.floor(Date.now() / 1000)) {
  seq++;
  cola.push({ seq, tipo, personas: estado.personas, epoch: epochSeg, uptimeMs: uptime() });
}

async function sync(eventos) {
  const res = await fetch(`${SERVIDOR}/api/dispositivo/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': CLAVE },
    body: JSON.stringify({ ...estado, uptimeMs: uptime(), eventos, ack }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- Carga de historial: dias habiles de 8 a 22 h, con picos a las 10 y a las 19 ----
async function cargarHistorial(dias) {
  const eventos = [];
  let personas = 0;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ahora = Date.now();
  for (let d = dias; d >= 0; d--) {                          // d = 0 es hoy, hasta la hora actual
    const dia = new Date(hoy.getTime() - d * 86400000);
    const dow = dia.getDay();
    if (dow === 0) continue;                                   // domingo cerrado
    const intensidad = dow === 6 ? 0.3 : 1;                    // sabado poco movimiento
    for (let h = 8; h < 22; h++) {
      const pico = Math.exp(-((h - 10) ** 2) / 3) + 0.8 * Math.exp(-((h - 19) ** 2) / 2);
      const cruces = Math.round((4 + 25 * pico) * intensidad * (0.7 + Math.random() * 0.6));
      // Horarios ordenados dentro de la hora: asi la ocupacion se calcula en orden cronologico
      const horarios = Array.from({ length: cruces }, () => dia.getTime() + h * 3600000 + Math.random() * 3600000)
        .filter((ts) => ts < ahora)
        .sort((a, b) => a - b);
      for (const ts of horarios) {
        const entra = h < 21 && (personas === 0 || Math.random() < (h < 16 ? 0.62 : 0.4));
        personas += entra ? 1 : -1;
        eventos.push({ ts, tipo: entra ? 'entrada' : 'salida', personas });
      }
    }
    if (d === 0) break;                                        // hoy todavia no cerro
    let ts = dia.getTime() + 22 * 3600000;
    while (personas > 0) {                                     // al cierre se van todos
      personas--;
      ts += 5000 + Math.random() * 20000;
      eventos.push({ ts, tipo: 'salida', personas });
    }
  }

  // Lote con un bootId propio, como si fuera un arranque anterior del ESP32
  const bootHistorial = Math.floor(Math.random() * 0xffffffff);
  for (let i = 0; i < eventos.length; i += 200) {
    const lote = eventos.slice(i, i + 200).map((e, j) => ({
      seq: i + j + 1, tipo: e.tipo, personas: e.personas, epoch: Math.floor(e.ts / 1000), uptimeMs: 0,
    }));
    const res = await fetch(`${SERVIDOR}/api/dispositivo/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': CLAVE },
      body: JSON.stringify({ ...estado, bootId: bootHistorial, uptimeMs: 0, eventos: lote, ack: [] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  // El modo en vivo sigue desde donde quedo hoy, como haria el ESP32 al recuperar estado.txt
  const deHoy = eventos.filter((e) => e.ts >= hoy.getTime());
  estado.personas = personas;
  estado.entradas = deHoy.filter((e) => e.tipo === 'entrada').length;
  estado.salidas = deHoy.filter((e) => e.tipo === 'salida').length;
  estado.maximoHistorico = Math.max(0, ...eventos.map((e) => e.personas));
  for (let i = 0; i < 5; i++) {
    const inicioDia = hoy.getTime() - (((hoy.getDay() + 6) % 7) - i) * 86400000;
    const delDia = eventos.filter((e) => e.ts >= inicioDia && e.ts < inicioDia + 86400000);
    estado.historialSemana[i] = Math.max(0, ...delDia.map((e) => e.personas));
  }
  console.log(`Historial cargado: ${eventos.length} eventos de ${dias} dias.`);
}

// ---- Modo en vivo ----
function cruceAlAzar() {
  if (Math.random() < 0.5) return;
  const entra = estado.personas === 0 || Math.random() < 0.55;
  if (entra) {
    estado.personas++; estado.entradas++;
    estado.maximoHistorico = Math.max(estado.maximoHistorico, estado.personas);
    const idx = (new Date().getDay() + 6) % 7;
    if (idx < 5) estado.historialSemana[idx] = Math.max(estado.historialSemana[idx], estado.personas);
  } else {
    estado.personas--; estado.salidas++;
  }
  evento(entra ? 'entrada' : 'salida');
  console.log(`${entra ? 'Entrada' : 'Salida '} -> personas: ${estado.personas}`);
}

function ejecutarComando(c) {
  if (c.tipo === 'reset') {
    estado.personas = 0;
    evento('reset');
    console.log(`Comando #${c.id}: reset -> personas: 0`);
  } else if (c.tipo === 'fijar') {
    estado.personas = c.valor;
    evento('correccion');
    console.log(`Comando #${c.id}: fijar -> personas: ${c.valor}`);
  }
  ack.push(c.id);
}

async function ciclo() {
  cruceAlAzar();
  // De vez en cuando el sensor pierde senal un ciclo, para ver el historial de conexiones
  estado.enlaceRF = Math.random() > 0.03;
  estado.rssi = -55 - Math.round(Math.random() * 10);
  try {
    const enviados = cola.slice(0, 50);
    const ackEnviados = ack;
    const r = await sync(enviados);
    const recibidos = new Set(r.eventosRecibidos);
    cola = cola.filter((e) => !recibidos.has(e.seq));
    ack = ack.filter((id) => !ackEnviados.includes(id));
    r.comandos.forEach(ejecutarComando);
  } catch (err) {
    console.log(`Sin conexion con el servidor (${err.message}); ${cola.length} eventos en cola.`);
  }
}

const i = process.argv.indexOf('--historial');
if (i > 0) await cargarHistorial(parseInt(process.argv[i + 1], 10) || 30);
console.log(`Simulando ESP32 contra ${SERVIDOR} (bootId ${estado.bootId}). Ctrl+C para salir.`);
await ciclo();
setInterval(ciclo, INTERVALO_SYNC_MS);
