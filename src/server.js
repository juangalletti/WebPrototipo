// Servidor del contador de personas: recibe los datos del ESP32 y sirve el dashboard.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { iniciarBase } from './db.js';
import { crearAdminInicial } from './auth.js';
import { cargarEstadoConexion, vigilarConexion } from './estado.js';
import { rutasDispositivo } from './rutas/dispositivo.js';
import { rutasPublicas } from './rutas/publico.js';
import { rutasAdmin } from './rutas/admin.js';

const PUERTO = process.env.PORT || 3000;
const CARPETA_PUBLICA = fileURLToPath(new URL('../public', import.meta.url));

await iniciarBase();
await crearAdminInicial();
await cargarEstadoConexion();
vigilarConexion();

const app = express();
app.set('trust proxy', 1);   // Railway pone un proxy adelante: req.ip es la IP real del cliente
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '100kb' }));

app.use('/api/dispositivo', rutasDispositivo);
app.use('/api', rutasPublicas);
app.use('/api/admin', rutasAdmin);
app.get('/salud', (req, res) => res.send('ok'));   // para el healthcheck de Railway
app.get('/admin', (req, res) => res.sendFile('admin.html', { root: CARPETA_PUBLICA }));
app.use(express.static(CARPETA_PUBLICA));

app.use('/api', (req, res) => res.status(404).json({ error: 'No existe' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalido' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PUERTO, () => console.log(`Servidor escuchando en http://localhost:${PUERTO}`));
