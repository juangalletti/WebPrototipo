# contador_web

Servidor y dashboard del contador de personas (Practica Profesionalizante 2 - ASI).
El ESP32 cuenta y le manda los datos a este servidor; el servidor los guarda en PostgreSQL
y sirve el dashboard publico (`/`) y el apartado admin (`/admin`).

## Probar en la PC

```bash
npm install
cp .env.example .env      # y completar los valores
npm run dev               # http://localhost:3000
npm run simular -- --historial 30   # en otra terminal: simula el ESP32 con 30 dias de datos
```

Estilos: Tailwind CSS v4. Se editan en `estilos/entrada.css` y en las clases del HTML/JS;
despues de cambiarlos correr `npm run css` (o `npm run css:watch` mientras se trabaja).
`public/app.css` va al repo ya compilado, asi Railway no necesita compilar nada.

Sin `DATABASE_URL` se usa PGlite (Postgres dentro de Node) y los datos quedan en `datos-local/`.
Para empezar de cero, frenar el servidor y borrar esa carpeta.

## Variables de entorno

| Variable | Para que |
|---|---|
| `DEVICE_API_KEY` | Clave que el ESP32 manda en la cabecera `X-API-Key` |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Admin que se crea en el primer arranque (si no hay usuarios) |
| `SESSION_SECRET` | Firma de las cookies de sesion |
| `DATABASE_URL` | PostgreSQL (en Railway se completa al vincular la base) |
| `PORT` | Puerto (Railway lo pone solo) |
| `NODE_ENV` | `production` en Railway (la cookie de sesion pasa a ser solo HTTPS) |

## API del ESP32

`POST /api/dispositivo/sync` con `X-API-Key`. Un solo pedido por ciclo (cada ~5 s) con el
estado actual, los eventos pendientes y la confirmacion de comandos ejecutados.
El formato completo esta documentado al principio de `src/rutas/dispositivo.js`.

- Los eventos se identifican por `(bootId, seq)`: reenviarlos no los duplica.
- `epoch = 0` (sin NTP) => el servidor estima la hora con `uptimeMs`.
- Los comandos (`reset`, `fijar`) vuelven en la respuesta; el ESP32 los ejecuta, genera el
  evento `reset` o `correccion` y los confirma en `ack` en el proximo sync. Vencen a los 5 minutos.
- 30 s sin sync => el nodo central figura "fuera de linea".
