import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const port = process.env.PORT || 4000;
const jwtSecret = process.env.JWT_SECRET;
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    message: 'Halloween Party API funcionando',
    version: '1.0.0'
  });
});

const drinkSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  category: { type: String, required: true, trim: true, maxlength: 60 },
  price: { type: Number, required: true, min: 0 },
  image_url: { type: String, default: '', trim: true },
  description: { type: String, default: '', trim: true, maxlength: 300 },
  available: { type: Boolean, default: true },
  featured: { type: Boolean, default: false }
}, { timestamps: true });
const Drink = mongoose.model('Drink', drinkSchema);

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Inicia sesión para administrar el menú.' });
  try { req.admin = jwt.verify(token, jwtSecret); next(); }
  catch { return res.status(401).json({ message: 'Sesión inválida o vencida. Vuelve a iniciar sesión.' }); }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !jwtSecret) return res.status(500).json({ message: 'Falta configurar las credenciales del administrador en el servidor.' });
  const emailMatches = String(email || '').toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();
  const passwordMatches = await bcrypt.compare(String(password || ''), await bcrypt.hash(process.env.ADMIN_PASSWORD, 10));
  if (!emailMatches || !passwordMatches) return res.status(401).json({ message: 'Correo o contraseña incorrectos.' });
  const token = jwt.sign({ role: 'admin', email: process.env.ADMIN_EMAIL }, jwtSecret, { expiresIn: '8h' });
  res.json({ token, expiresIn: 28800 });
});

app.get('/api/drinks', async (_req, res) => {
  try { const drinks = await Drink.find().sort({ featured: -1, name: 1 }).lean(); res.json(drinks.map(d => ({ ...d, id: String(d._id) }))); }
  catch { res.status(500).json({ message: 'No se pudo cargar el menú.' }); }
});
app.post('/api/drinks', auth, async (req, res) => {
  try { const drink = await Drink.create(cleanPayload(req.body)); res.status(201).json({ ...drink.toObject(), id: String(drink._id) }); }
  catch (e) { res.status(400).json({ message: e.name === 'ValidationError' ? e.message : 'Datos de bebida inválidos.' }); }
});
app.put('/api/drinks/:id', auth, async (req, res) => {
  try { const drink = await Drink.findByIdAndUpdate(req.params.id, cleanPayload(req.body), { new: true, runValidators: true }); if (!drink) return res.status(404).json({ message: 'Bebida no encontrada.' }); res.json({ ...drink.toObject(), id: String(drink._id) }); }
  catch (e) { res.status(400).json({ message: e.name === 'ValidationError' || e.name === 'CastError' ? 'ID o datos de bebida inválidos.' : 'No se pudo actualizar la bebida.' }); }
});
app.patch('/api/drinks/:id', auth, async (req, res) => {
  if (typeof req.body?.available !== 'boolean') return res.status(400).json({ message: 'Indica la disponibilidad de la bebida.' });
  try { const drink = await Drink.findByIdAndUpdate(req.params.id, { available: req.body.available }, { new: true, runValidators: true }); if (!drink) return res.status(404).json({ message: 'Bebida no encontrada.' }); res.json({ ...drink.toObject(), id: String(drink._id) }); }
  catch { res.status(400).json({ message: 'No se pudo actualizar la disponibilidad.' }); }
});
app.delete('/api/drinks/:id', auth, async (req, res) => {
  try { const drink = await Drink.findByIdAndDelete(req.params.id); if (!drink) return res.status(404).json({ message: 'Bebida no encontrada.' }); res.json({ message: 'Bebida eliminada.' }); }
  catch { res.status(400).json({ message: 'ID de bebida inválido.' }); }
});
function cleanPayload(body = {}) {
  const payload = {};
  for (const key of ['name', 'category', 'price', 'image_url', 'description', 'available', 'featured']) if (body[key] !== undefined) payload[key] = body[key];
  if (payload.name !== undefined) payload.name = String(payload.name).trim();
  if (payload.category !== undefined) payload.category = String(payload.category).trim();
  if (payload.image_url !== undefined) payload.image_url = String(payload.image_url).trim();
  if (payload.description !== undefined) payload.description = String(payload.description).trim();
  if (payload.price !== undefined) payload.price = Number(payload.price);
  return payload;
}

if (!jwtSecret) console.warn('AVISO: configura JWT_SECRET en backend/.env antes de usar el panel.');
try {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI no está configurada.');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado a MongoDB');
  app.listen(port, () => console.log(`Halloween Party API escuchando en puerto ${port}`));
} catch (error) {
  console.error('No se pudo iniciar la API:', error.message);
  process.exit(1);
}
