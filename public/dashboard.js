// Dashboard publico: consulta /api/estado cada 2 s (igual que el dashboard del ESP32).
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const $ = (id) => document.getElementById(id);

function haceCuanto(seg) {
  if (seg === null) return 'nunca';
  if (seg < 60) return `hace ${seg} s`;
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`;
  return `hace ${Math.round(seg / 86400)} días`;
}

function setVivo(estado) {
  const colores = { ok: 'bg-emerald-400', mal: 'bg-rose-400', espera: 'bg-slate-300' };
  $('vivoPunto').className = `relative inline-flex size-2.5 rounded-full ${colores[estado]}`;
  $('vivoPulso').className = estado === 'ok'
    ? 'absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-75'
    : 'hidden';
  $('vivoTexto').textContent = { ok: 'En vivo', mal: 'Fuera de línea', espera: 'Conectando…' }[estado];
}

async function actualizar() {
  try {
    const res = await fetch('/api/estado');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const mostrar = (v) => (v === null ? '--' : v);
    $('personasActuales').textContent = mostrar(d.personasActuales);
    $('entradas').textContent = mostrar(d.entradas);
    $('salidas').textContent = mostrar(d.salidas);
    $('maxHistorico').textContent = mostrar(d.maximoHistorico);

    const hoy = (new Date().getDay() + 6) % 7;
    graficoBarras($('graficoSemana'), {
      valores: d.historialSemana, etiquetas: DIAS, nombres: DIAS_LARGOS,
      resaltar: hoy < 5 ? hoy : -1, conValores: true, formato: (v) => `${v} personas`,
    });

    $('graficoHoras').hidden = !d.hayDatos;
    $('sinDatosHoras').hidden = d.hayDatos;
    if (d.hayDatos) {
      const horas = d.ocupacionPorHora;
      graficoBarras($('graficoHoras'), {
        valores: horas,
        columnas: 24,
        etiquetas: Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? `${h}h` : '')),
        nombres: Array.from({ length: 24 }, (_, h) => `${h}:00 a ${h}:59`),
        resaltar: horas.length - 1,
        formato: (v) => `${v} personas como máximo`,
      });
    }

    setVivo(d.centralEnLinea ? 'ok' : 'mal');
    $('estadoVivo').title = d.hayDatos
      ? `Último dato del ESP32: ${haceCuanto(d.ultimoContactoSeg)}`
      : 'El ESP32 todavía no envió datos.';
  } catch (err) {
    setVivo('mal');
    $('vivoTexto').textContent = 'Sin conexión';
  }
}

// El clima cambia despacio y el servidor lo guarda 10 min: alcanza con pedirlo cada 5 min
async function actualizarClima() {
  try {
    const res = await fetch('/api/clima');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const c = await res.json();
    $('climaIcono').textContent = c.icono;
    $('climaTemp').textContent = c.temperatura;
    $('climaDescripcion').textContent = c.descripcion;
    $('climaMax').textContent = c.maxima;
    $('climaMin').textContent = c.minima;
    $('climaSensacion').textContent = c.sensacion;
    $('climaViento').textContent = `${c.viento} km/h ${c.direccionViento}`;
    $('climaRafagas').textContent = `ráfagas ${c.rafagas}`;
    $('climaHumedad').textContent = c.humedad;
    $('climaHora').textContent = `Actualizado ${c.medido.slice(11, 16)} h`;
    $('clima').hidden = false;
    $('climaError').hidden = true;
  } catch (err) {
    $('clima').hidden = true;
    $('climaError').hidden = false;
    $('climaHora').textContent = '';
  }
}

actualizar();
setInterval(actualizar, 2000);
actualizarClima();
setInterval(actualizarClima, 5 * 60 * 1000);
