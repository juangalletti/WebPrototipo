// Grafico de barras verticales de una sola serie, compartido por el dashboard y el admin.
// Sin librerias: columnas HTML con clases de Tailwind y un tooltip al pasar el mouse.
//
// graficoBarras(contenedor, {
//   valores:   [n, ...]            alturas
//   etiquetas: ['Lun', '', ...]    texto del eje ('' = sin texto en esa columna)
//   nombres:   ['Lunes', ...]      titulo del tooltip (por defecto, la etiqueta)
//   resaltar:  indice              columna destacada (hoy, hora actual); -1 = ninguna
//   conValores: true               numero sobre cada barra (solo con pocas columnas)
//   columnas:  24                  total de columnas; las que no tienen valor quedan vacias
//   formato:   (v) => `${v} personas`
// })
function graficoBarras(cont, opciones) {
  const {
    valores, etiquetas = [], nombres = etiquetas, resaltar = -1, conValores = false,
    columnas = valores.length, formato = (v) => String(v),
  } = opciones;
  // El dashboard llama cada 2 s: si los datos no cambiaron no se redibuja (asi no se cierra el tooltip)
  const firma = JSON.stringify([valores, etiquetas, resaltar, columnas, cont.clientWidth]);
  if (cont.dataset.firma === firma) return;
  cont.dataset.firma = firma;

  const maximo = Math.max(1, ...valores);
  const pocas = columnas <= 12;

  cont.classList.add('relative', 'flex', 'flex-col');
  const area = document.createElement('div');
  area.className = `relative flex flex-1 items-end border-b border-slate-200 dark:border-slate-700 ${pocas ? 'gap-3' : 'gap-0.5'}`;
  const eje = document.createElement('div');
  eje.className = `flex pt-2 ${pocas ? 'gap-3' : 'gap-0.5'}`;
  const tooltip = document.createElement('div');
  tooltip.className = 'pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg ring-1 ring-white/10 dark:bg-slate-100 dark:text-slate-900';
  tooltip.hidden = true;

  cont.replaceChildren(area, eje, tooltip);
  const altoArea = area.clientHeight || 100;
  const altoUtil = altoArea - (conValores ? 20 : 4);

  for (let i = 0; i < columnas; i++) {
    const tieneValor = i < valores.length;
    const v = tieneValor ? valores[i] : 0;

    const col = document.createElement('div');
    col.className = 'group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end';

    if (conValores && tieneValor) {
      const num = document.createElement('div');
      num.className = 'mb-1 text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300';
      num.textContent = formato(v).split(' ')[0];
      col.append(num);
    }

    const barra = document.createElement('div');
    const ancho = pocas ? 'w-full max-w-10' : 'w-full max-w-4';
    if (!tieneValor) {
      // Columna futura (ej: horas que todavia no pasaron): solo un trazo tenue
      barra.className = `${ancho} h-0.5 rounded-full bg-slate-100 dark:bg-slate-800`;
    } else {
      const alto = v === 0 ? 2 : Math.max(4, Math.round((v / maximo) * altoUtil));
      const color = i === resaltar
        ? 'bg-marca-600 dark:bg-marca-400'
        : 'bg-marca-300 group-hover:bg-marca-400 dark:bg-marca-400/45 dark:group-hover:bg-marca-400/70';
      barra.className = `${ancho} rounded-t transition-colors ${v === 0 ? 'bg-slate-200 dark:bg-slate-700' : color}`;
      barra.style.height = alto + 'px';

      col.addEventListener('mouseenter', () => {
        tooltip.replaceChildren();
        const t = document.createElement('div');
        t.className = 'font-semibold';
        t.textContent = nombres[i] || etiquetas[i] || String(i);
        const d = document.createElement('div');
        d.className = 'tabular-nums opacity-80';
        d.textContent = formato(v);
        tooltip.append(t, d);
        tooltip.hidden = false;
        const rc = cont.getBoundingClientRect();
        const rb = barra.getBoundingClientRect();
        tooltip.style.left = `${rb.left - rc.left + rb.width / 2}px`;
        tooltip.style.top = `${rb.top - rc.top - 6}px`;
      });
      col.addEventListener('mouseleave', () => { tooltip.hidden = true; });
    }
    col.append(barra);
    area.append(col);

    // La etiqueta se centra bajo su columna aunque sea mas ancha que ella
    const et = document.createElement('div');
    et.className = 'relative h-4 min-w-0 flex-1';
    if (etiquetas[i]) {
      const texto = document.createElement('span');
      texto.className = `absolute left-1/2 -translate-x-1/2 text-[11px] tabular-nums whitespace-nowrap ${
        i === resaltar ? 'font-semibold text-marca-600 dark:text-marca-400' : 'text-slate-400 dark:text-slate-500'}`;
      texto.textContent = etiquetas[i];
      et.append(texto);
    }
    eje.append(et);
  }
}
