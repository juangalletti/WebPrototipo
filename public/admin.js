// Apartado admin. Todo el contenido que viene del servidor se inserta con textContent.
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
async function api(metodo, url, cuerpo) {
  const opciones = { method: metodo, headers: {} };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  const res = await fetch(url, opciones);
  if (res.status === 401 && !url.endsWith('/login')) { mostrarLogin(); throw new Error('Sesión vencida, volvé a ingresar'); }
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
  return datos;
}

function mensaje(id, texto, tipo = 'exito') {
  const el = $(id);
  el.className = el.className.replace(/\b(error|exito)\b/g, '').trim() + ' ' + tipo;
  el.textContent = texto;
}

// Nombre visible y estilo de cada estado. Los colores de estado (verde/ambar/rojo) se
// reservan para estados; entrada/salida usan indigo/gris. Siempre van con texto.
const ESTADOS = {
  entrada: ['Entrada', 'pastilla-info'],
  salida: ['Salida', 'pastilla-neutra'],
  reset: ['Reset', 'pastilla-mal'],
  correccion: ['Corrección', 'pastilla-aviso'],
  pendiente: ['◌ Pendiente', 'pastilla-aviso'],
  confirmado: ['✓ Aplicada', 'pastilla-ok'],
  vencido: ['✕ Vencida', 'pastilla-mal'],
  central_en_linea: ['● Nodo central en línea', 'pastilla-ok'],
  central_fuera_de_linea: ['✕ Nodo central fuera de línea', 'pastilla-mal'],
  central_reiniciado: ['↻ Nodo central reiniciado', 'pastilla-aviso'],
  sensor_conectado: ['● Sensor conectado', 'pastilla-ok'],
  sensor_sin_senal: ['✕ Sensor sin señal', 'pastilla-mal'],
};

function pastilla(clave) {
  const [texto, clase] = ESTADOS[clave] || [clave, 'pastilla-neutra'];
  const s = document.createElement('span');
  s.className = clase;
  s.textContent = texto;
  return s;
}

function celda(contenido, clase = '') {
  const td = document.createElement('td');
  if (clase) td.className = clase;
  if (contenido instanceof Node) td.append(contenido);
  else td.textContent = contenido ?? '';
  return td;
}

function fila(...celdas) {
  const tr = document.createElement('tr');
  tr.append(...celdas);
  return tr;
}

function llenarTabla(tbody, filas, columnas, textoVacio = 'Sin datos') {
  if (filas.length === 0) {
    const td = celda(textoVacio, 'py-10 text-center text-slate-400');
    td.colSpan = columnas;
    tbody.replaceChildren(fila(td));
    return;
  }
  tbody.replaceChildren(...filas);
}

function paginacion(cont, pagina, porPagina, total, irA) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const info = document.createElement('span');
  info.className = 'mr-auto subtitulo tabular-nums';
  info.textContent = `${total} registros · página ${pagina} de ${paginas}`;
  const boton = (texto, destino, deshabilitado) => {
    const b = document.createElement('button');
    b.className = 'boton';
    b.textContent = texto;
    b.disabled = deshabilitado;
    b.onclick = () => irA(destino);
    return b;
  };
  cont.replaceChildren(info, boton('Anterior', pagina - 1, pagina <= 1), boton('Siguiente', pagina + 1, pagina >= paginas));
}

const fechaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fijarRango(form, dias) {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(hoy.getDate() - (dias - 1));
  form.desde.value = fechaISO(desde);
  form.hasta.value = fechaISO(hoy);
}

function haceCuanto(seg) {
  if (seg === null || seg === undefined) return 'nunca';
  if (seg < 60) return `hace ${seg} s`;
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`;
  return `hace ${Math.round(seg / 86400)} días`;
}

// ---------------------------------------------------------------------
// Sesion y pestanas
// ---------------------------------------------------------------------
let temporizador = null;

function mostrarLogin() {
  clearInterval(temporizador);
  $('vistaAdmin').hidden = true;
  $('vistaLogin').hidden = false;
  $('formLogin').usuario.focus();
}

function mostrarAdmin(usuario) {
  $('nombreUsuario').textContent = usuario;
  $('inicialUsuario').textContent = usuario.charAt(0);
  $('vistaLogin').hidden = true;
  $('vistaAdmin').hidden = false;
  abrirPestana('control');
}

$('formLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    const r = await api('POST', '/api/admin/login', { usuario: f.usuario.value, password: f.password.value });
    f.password.value = '';
    mensaje('msgLogin', '', 'error');
    mostrarAdmin(r.usuario);
  } catch (err) {
    mensaje('msgLogin', err.message, 'error');
  }
});

$('btnLogout').addEventListener('click', async () => {
  await api('POST', '/api/admin/logout', {}).catch(() => {});
  mostrarLogin();
});

const CARGAR = {
  control: cargarControl, registro: () => cargarEventos(1), estadisticas: cargarEstadisticas,
  sistema: cargarSalud, auditoria: () => cargarAuditoria(1), usuarios: cargarUsuarios,
};
const PESTANA_BASE = 'whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition';
const PESTANA_ACTIVA = `${PESTANA_BASE} bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300`;
const PESTANA_INACTIVA = `${PESTANA_BASE} text-white/80 hover:bg-white/10 hover:text-white cursor-pointer`;

function abrirPestana(nombre) {
  document.querySelectorAll('nav [role=tab]').forEach((b) => {
    const activa = b.dataset.panel === nombre;
    b.setAttribute('aria-selected', String(activa));
    b.className = activa ? PESTANA_ACTIVA : PESTANA_INACTIVA;
  });
  document.querySelectorAll('main > section').forEach((p) => { p.hidden = p.id !== 'panel-' + nombre; });
  clearInterval(temporizador);
  CARGAR[nombre]();
  // Control y salud se refrescan solos para ver cuando el ESP32 aplica una orden
  if (nombre === 'control' || nombre === 'sistema') temporizador = setInterval(CARGAR[nombre], 3000);
}

document.querySelectorAll('nav [role=tab]').forEach((b) => {
  b.addEventListener('click', () => abrirPestana(b.dataset.panel));
});

// ---------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------
let aforoCargado = false;

function setPastilla(el, ok, textoOk, textoMal) {
  el.className = ok ? 'pastilla-ok' : 'pastilla-mal';
  el.textContent = ok ? `● ${textoOk}` : `✕ ${textoMal}`;
}

async function cargarControl() {
  try {
    const [estado, comandos] = await Promise.all([
      fetch('/api/estado').then((r) => r.json()), api('GET', '/api/admin/comandos')]);
    $('cPersonas').textContent = estado.personasActuales ?? '--';
    $('cEntSal').textContent = estado.hayDatos ? `${estado.entradas} / ${estado.salidas}` : '--';
    setPastilla($('cCentral'), estado.centralEnLinea, 'En línea', 'Fuera de línea');
    $('cCentralDetalle').textContent = `Último dato ${haceCuanto(estado.ultimoContactoSeg)}`;
    setPastilla($('cSensor'), estado.sensorConectado, 'Conectado', 'Sin señal');

    if (!aforoCargado) {
      $('formAforo').aforoMax.value = estado.aforoMax;
      $('formAforo').avisoPct.value = estado.avisoPct;
      aforoCargado = true;
    }

    llenarTabla($('tablaComandos'), comandos.map((c) => fila(
      celda('#' + c.id, 'tabular-nums text-slate-400'),
      celda(c.tipo === 'reset' ? 'Reiniciar a 0' : `Fijar en ${c.valor}`, 'font-medium'),
      celda(c.usuario), celda(c.creado, 'tabular-nums'),
      celda(pastilla(c.estado)),
      celda(c.confirmado || '—', 'tabular-nums'),
    )), 6, 'Todavía no se enviaron órdenes');
  } catch (err) {
    mensaje('msgControl', err.message, 'error');
  }
}

async function enviarComando(cuerpo, descripcion) {
  try {
    const r = await api('POST', '/api/admin/comandos', cuerpo);
    mensaje('msgControl', `Orden #${r.id} enviada (${descripcion}). Se aplica cuando el ESP32 se conecte.`);
    cargarControl();
  } catch (err) {
    mensaje('msgControl', err.message, 'error');
  }
}

$('btnReset').addEventListener('click', () => {
  if (!confirm('¿Seguro que querés reiniciar el contador de personas actuales a 0?')) return;
  enviarComando({ tipo: 'reset' }, 'reiniciar a 0');
});

$('btnFijar').addEventListener('click', () => {
  const valor = Number($('valorFijar').value);
  if ($('valorFijar').value === '' || !Number.isInteger(valor) || valor < 0) {
    mensaje('msgControl', 'Ingresá un número entero mayor o igual a 0', 'error');
    return;
  }
  if (!confirm(`¿Fijar el contador de personas actuales en ${valor}?`)) return;
  enviarComando({ tipo: 'fijar', valor }, `fijar en ${valor}`);
});

$('formAforo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    await api('PUT', '/api/admin/config', { aforoMax: Number(f.aforoMax.value), avisoPct: Number(f.avisoPct.value) });
    mensaje('msgAforo', 'Aforo guardado.');
  } catch (err) {
    mensaje('msgAforo', err.message, 'error');
  }
});

// ---------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------
function filtrosRegistro() {
  const f = $('formRegistro');
  if (!f.desde.value || !f.hasta.value) fijarRango(f, 7);
  const p = new URLSearchParams({ desde: f.desde.value, hasta: f.hasta.value });
  if (f.tipo.value) p.set('tipo', f.tipo.value);
  return p;
}

async function cargarEventos(pagina) {
  const p = filtrosRegistro();
  $('linkCsv').href = '/api/admin/eventos.csv?' + p;
  p.set('pagina', pagina);
  try {
    const r = await api('GET', '/api/admin/eventos?' + p);
    mensaje('msgRegistro', '');
    llenarTabla($('tablaEventos'), r.filas.map((e) => fila(
      celda(e.fecha_hora, 'tabular-nums'), celda(pastilla(e.tipo)), celda(e.personas, 'text-right tabular-nums font-medium'),
      celda(e.ts_estimado ? 'Estimada (sin NTP)' : 'Exacta', 'text-slate-500 dark:text-slate-400'),
    )), 4, 'No hay eventos en ese rango');
    paginacion($('pagEventos'), r.pagina, r.porPagina, r.total, cargarEventos);
  } catch (err) {
    mensaje('msgRegistro', err.message, 'error');
  }
}

$('formRegistro').addEventListener('submit', (ev) => { ev.preventDefault(); cargarEventos(1); });
$('formRegistro').addEventListener('change', () => { $('linkCsv').href = '/api/admin/eventos.csv?' + filtrosRegistro(); });

// ---------------------------------------------------------------------
// Estadisticas
// ---------------------------------------------------------------------
const DIAS_LARGOS = { Lun: 'Lunes', Mar: 'Martes', Mie: 'Miércoles', Jue: 'Jueves', Vie: 'Viernes', Sab: 'Sábado', Dom: 'Domingo' };
const NOMBRE_DIA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

async function cargarEstadisticas() {
  const f = $('formEstadisticas');
  if (!f.desde.value || !f.hasta.value) fijarRango(f, 30);
  try {
    const e = await api('GET', '/api/admin/estadisticas?' + new URLSearchParams({ desde: f.desde.value, hasta: f.hasta.value }));
    mensaje('msgEstadisticas', '');
    $('eEntradas').textContent = e.totales.entrada.toLocaleString('es-AR');
    $('eSalidas').textContent = e.totales.salida.toLocaleString('es-AR');
    $('ePico').textContent = e.pico ? e.pico.personas : '--';
    $('ePicoCuando').textContent = e.pico ? e.pico.cuando : 'Sin datos';
    $('ePromedio').textContent = e.promedioEntradasDiaActivo.toLocaleString('es-AR');
    $('eDias').textContent = `${e.diasConActividad} días con actividad`;
    $('eAjustes').textContent = `${e.totales.reset} / ${e.totales.correccion}`;

    const cadaN = Math.ceil(e.serie.length / 10);
    graficoBarras($('gSerie'), {
      valores: e.serie.map((d) => d.entradas),
      etiquetas: e.serie.map((d, i) => (i % cadaN === 0 ? `${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}` : '')),
      nombres: e.serie.map((d) => {
        const fecha = new Date(`${d.fecha}T12:00:00`);
        return `${NOMBRE_DIA[fecha.getDay()]} ${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)} · pico ${d.maximo}`;
      }),
      conValores: e.serie.length <= 14,
      formato: (v) => `${v} entradas`,
    });
    graficoBarras($('gSemana'), {
      valores: e.promedioPorDia.map((d) => d.promedio),
      etiquetas: e.promedioPorDia.map((d) => d.dia),
      nombres: e.promedioPorDia.map((d) => DIAS_LARGOS[d.dia]),
      conValores: true,
      formato: (v) => `${v.toLocaleString('es-AR')} entradas en promedio`,
    });
    graficoBarras($('gHoras'), {
      valores: e.entradasPorHora,
      etiquetas: e.entradasPorHora.map((_, h) => (h % 3 === 0 ? `${h}h` : '')),
      nombres: e.entradasPorHora.map((_, h) => `${h}:00 a ${h}:59`),
      formato: (v) => `${v} entradas`,
    });
  } catch (err) {
    mensaje('msgEstadisticas', err.message, 'error');
  }
}

$('formEstadisticas').addEventListener('submit', (ev) => { ev.preventDefault(); cargarEstadisticas(); });
document.querySelectorAll('#formEstadisticas [data-dias]').forEach((b) => {
  b.addEventListener('click', () => { fijarRango($('formEstadisticas'), Number(b.dataset.dias)); cargarEstadisticas(); });
});

// ---------------------------------------------------------------------
// Salud del sistema
// ---------------------------------------------------------------------
// estado: 'ok' | 'aviso' | 'mal' | null (dato informativo, sin pastilla)
function dato(titulo, valor, estado = null) {
  const d = document.createElement('div');
  d.className = 'tarjeta p-5';
  const t = document.createElement('div');
  t.className = 'etiqueta-dato';
  t.textContent = titulo;
  d.append(t);
  if (estado) {
    const p = document.createElement('div');
    p.className = 'mt-2';
    const s = document.createElement('span');
    const icono = { ok: '●', aviso: '⚠', mal: '✕' }[estado];
    s.className = { ok: 'pastilla-ok', aviso: 'pastilla-aviso', mal: 'pastilla-mal' }[estado];
    s.textContent = `${icono} ${valor}`;
    p.append(s);
    d.append(p);
  } else {
    const v = document.createElement('div');
    v.className = 'mt-1 text-lg font-semibold tabular-nums';
    v.textContent = valor;
    d.append(v);
  }
  return d;
}

const siNo = (b, si, no) => [b ? si : no, b ? 'ok' : 'mal'];

async function cargarSalud() {
  try {
    const s = await api('GET', '/api/admin/salud');
    const u = s.ultimoEstado;
    const datos = [
      dato('Nodo central', ...siNo(s.centralEnLinea, 'En línea', 'Fuera de línea')),
      dato('Último contacto', s.actualizado ? haceCuanto(s.ultimoContactoSeg) : 'nunca'),
    ];
    if (u) {
      const rssi = Number.isInteger(u.rssi) ? u.rssi : null;
      datos.push(
        dato('Módulo nRF24', ...siNo(u.radioOk, 'Detectado', 'No detectado')),
        dato('Enlace con el pasillo', ...siNo(u.enlaceRF, 'Recibiendo', 'Sin señal')),
        dato('Mensajes RF perdidos', String(u.perdidosRF ?? '—'), u.perdidosRF > 0 ? 'aviso' : null),
        dato('Tarjeta SD', ...siNo(u.sdDisponible, 'Lista', 'No detectada')),
        dato('Hora (NTP)', ...siNo(u.horaSincronizada, 'Sincronizada', 'Sin sincronizar')),
        dato('Señal WiFi', rssi === null ? '—' : `${rssi} dBm`, rssi === null ? null : rssi > -67 ? 'ok' : rssi > -80 ? 'aviso' : 'mal'),
        dato('IP local del ESP32', u.ip || '—'),
        dato('Tiempo encendido', haceCuanto(Math.round((u.uptimeMs || 0) / 1000)).replace('hace ', '')),
      );
    }
    datos.push(
      dato('Caídas del nodo central (7 días)', String(s.desconexiones7dias.central), s.desconexiones7dias.central ? 'aviso' : 'ok'),
      dato('Pérdidas del sensor (7 días)', String(s.desconexiones7dias.sensor), s.desconexiones7dias.sensor ? 'aviso' : 'ok'),
    );
    $('saludDatos').replaceChildren(...datos);
    llenarTabla($('tablaConexiones'), s.conexiones.map((c) => fila(
      celda(c.fecha_hora, 'tabular-nums'), celda(pastilla(c.tipo)), celda(c.detalle || '', 'text-slate-500 dark:text-slate-400'),
    )), 3, 'Sin eventos de conexión');
  } catch (err) {
    $('saludDatos').replaceChildren(dato('Error', err.message, 'mal'));
  }
}

// ---------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------
const ACCIONES = {
  login: 'Inicio de sesión', login_fallido: 'Intento de sesión fallido', logout: 'Cierre de sesión',
  reset_contador: 'Reinició el contador', correccion_contador: 'Corrigió el contador',
  cambiar_config: 'Cambió el aforo', exportar_csv: 'Exportó CSV', crear_usuario: 'Agregó administrador',
  borrar_usuario: 'Borró administrador', cambiar_password: 'Cambió su contraseña',
};

async function cargarAuditoria(pagina) {
  try {
    const r = await api('GET', '/api/admin/auditoria?pagina=' + pagina);
    llenarTabla($('tablaAuditoria'), r.filas.map((a) => fila(
      celda(a.fecha_hora, 'tabular-nums'), celda(a.usuario || '—', 'font-medium'),
      celda(ACCIONES[a.accion] || a.accion, a.accion === 'login_fallido' ? 'text-rose-600 dark:text-rose-400' : ''),
      celda(a.detalle || '', 'text-slate-500 dark:text-slate-400'),
    )), 4);
    paginacion($('pagAuditoria'), r.pagina, r.porPagina, r.total, cargarAuditoria);
  } catch (err) {
    llenarTabla($('tablaAuditoria'), [], 4, err.message);
  }
}

// ---------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------
async function cargarUsuarios() {
  try {
    const usuarios = await api('GET', '/api/admin/usuarios');
    const yo = $('nombreUsuario').textContent;
    llenarTabla($('tablaUsuarios'), usuarios.map((u) => {
      let accion;
      if (u.usuario === yo) {
        accion = document.createElement('span');
        accion.className = 'pastilla-info';
        accion.textContent = 'Vos';
      } else {
        accion = document.createElement('button');
        accion.className = 'boton-peligro !py-1 text-xs';
        accion.textContent = 'Borrar';
        accion.onclick = async () => {
          if (!confirm(`¿Borrar al administrador ${u.usuario}?`)) return;
          try { await api('DELETE', '/api/admin/usuarios/' + encodeURIComponent(u.usuario)); cargarUsuarios(); }
          catch (err) { mensaje('msgUsuario', err.message, 'error'); }
        };
      }
      return fila(celda(u.usuario, 'font-medium'), celda(u.creado, 'tabular-nums'), celda(accion, 'text-right'));
    }), 3);
  } catch (err) {
    mensaje('msgUsuario', err.message, 'error');
  }
}

$('formUsuario').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    await api('POST', '/api/admin/usuarios', { usuario: f.usuario.value, password: f.password.value });
    mensaje('msgUsuario', `Administrador ${f.usuario.value} agregado.`);
    f.reset();
    cargarUsuarios();
  } catch (err) {
    mensaje('msgUsuario', err.message, 'error');
  }
});

$('formPassword').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    await api('POST', '/api/admin/password', { actual: f.actual.value, nueva: f.nueva.value });
    mensaje('msgPassword', 'Contraseña cambiada.');
    f.reset();
  } catch (err) {
    mensaje('msgPassword', err.message, 'error');
  }
});

// ---------------------------------------------------------------------
// Arranque: si ya hay sesion, entra directo al panel
// ---------------------------------------------------------------------
fetch('/api/admin/yo')
  .then((r) => (r.ok ? r.json() : null))
  .then((r) => (r ? mostrarAdmin(r.usuario) : mostrarLogin()))
  .catch(mostrarLogin);
