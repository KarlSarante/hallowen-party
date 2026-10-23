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


const orderSchema = new mongoose.Schema({
  tableNumber: {
    type: String,
    required: true,
    trim: true,
    maxlength: 20
  },
  items: [{
    drinkId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 50
    }
  }],
  total: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: [
      'Pendiente',
      'Preparando',
      'Listo para entregar',
      'Entregado'
    ],
    default: 'Pendiente'
  }
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);

const orderSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },
  orderingEnabled: { type: Boolean, default: false }
}, { timestamps: true });

const OrderSettings = mongoose.model('OrderSettings', orderSettingsSchema);


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

app.get('/api/settings/orders', async (_req, res) => {
  try {
    const settings = await OrderSettings.findOne({ key: 'global' }).lean();
    res.json({ orderingEnabled: settings?.orderingEnabled === true });
  } catch (error) {
    console.error('Error consultando configuración de pedidos:', error);
    res.status(500).json({ message: 'No se pudo consultar la configuración de pedidos.' });
  }
});

app.put('/api/settings/orders', auth, async (req, res) => {
  if (typeof req.body?.orderingEnabled !== 'boolean') {
    return res.status(400).json({ message: 'Indica si los pedidos están habilitados.' });
  }

  try {
    const settings = await OrderSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: { orderingEnabled: req.body.orderingEnabled }, $setOnInsert: { key: 'global' } },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    res.json({ orderingEnabled: settings.orderingEnabled });
  } catch (error) {
    console.error('Error actualizando configuración de pedidos:', error);
    res.status(500).json({ message: 'No se pudo actualizar la configuración de pedidos.' });
  }
});

app.get('/api/drinks', async (_req, res) => {
  try { const drinks = await Drink.find().sort({ featured: -1, name: 1 }).lean(); res.json(drinks.map(d => ({ ...d, id: String(d._id) }))); }
  catch { res.status(500).json({ message: 'No se pudo cargar el menú.' }); }
});


app.post('/api/orders', async (req, res) => {
  try {
    const settings = await OrderSettings.findOne({ key: 'global' }).lean();
    if (settings?.orderingEnabled !== true) {
      return res.status(403).json({
        message: 'Los pedidos están desactivados temporalmente. El menú está disponible solo para consulta.'
      });
    }

    const tableNumber = String(req.body?.tableNumber || '').trim();
    const requestedItems = req.body?.items;

    if (!tableNumber || tableNumber.length > 20) {
      return res.status(400).json({
        message: 'Indica un número de mesa válido.'
      });
    }

    if (!Array.isArray(requestedItems) ||
        requestedItems.length === 0 ||
        requestedItems.length > 30) {
      return res.status(400).json({
        message: 'El pedido debe incluir al menos una bebida.'
      });
    }

    const quantities = new Map();

    for (const item of requestedItems) {
      const id = String(item?.drinkId || '');
      const quantity = Number(item?.quantity);

      if (!mongoose.isValidObjectId(id) ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 50) {
        return res.status(400).json({
          message: 'Hay una bebida o cantidad inválida.'
        });
      }

      quantities.set(id, (quantities.get(id) || 0) + quantity);

      if (quantities.get(id) > 50) {
        return res.status(400).json({
          message: 'Máximo 50 unidades por bebida.'
        });
      }
    }

    const drinkIds = [...quantities.keys()];
    const drinks = await Drink.find({
      _id: { $in: drinkIds },
      available: true
    }).lean();

    if (drinks.length !== drinkIds.length) {
      return res.status(400).json({
        message: 'Una o más bebidas no están disponibles.'
      });
    }

    const items = drinks.map(drink => ({
      drinkId: drink._id,
      name: drink.name,
      price: drink.price,
      quantity: quantities.get(String(drink._id))
    }));

    const total = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const order = await Order.create({
      tableNumber,
      items,
      total,
      status: 'Pendiente'
    });

    res.status(201).json({
      message: 'Pedido enviado correctamente.',
      order
    });
  } catch (error) {
    console.error('Error creando pedido:', error);
    res.status(500).json({
      message: 'No se pudo registrar el pedido.'
    });
  }
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


app.get('/api/orders', auth, async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .lean();

    res.json(orders);
  } catch (error) {
    console.error('Error consultando pedidos:', error);
    res.status(500).json({
      message: 'No se pudieron cargar los pedidos.'
    });
  }
});

app.patch('/api/orders/:id/status', auth, async (req, res) => {
  const allowedStatuses = [
    'Pendiente',
    'Preparando',
    'Listo para entregar',
    'Entregado'
  ];

  const { status } = req.body || {};

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      message: 'Estado del pedido inválido.'
    });
  }

  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({
        message: 'Pedido no encontrado.'
      });
    }

    res.json(order);
  } catch (error) {
    res.status(400).json({
      message: 'No se pudo actualizar el pedido.'
    });
  }
});

app.put('/api/orders/:id', auth, async (req, res) => {
  const allowedStatuses = [
    'Pendiente',
    'Preparando',
    'Listo para entregar',
    'Entregado'
  ];

  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'ID de pedido inválido.' });
  }

  const tableNumber = typeof req.body?.tableNumber === 'string'
    ? req.body.tableNumber.trim()
    : '';
  const requestedItems = req.body?.items;
  const { status } = req.body || {};

  if (!tableNumber || tableNumber.length > 20) {
    return res.status(400).json({ message: 'Indica un número de mesa válido.' });
  }

  if (!Array.isArray(requestedItems) ||
      requestedItems.length === 0 ||
      requestedItems.length > 30) {
    return res.status(400).json({ message: 'El pedido debe incluir al menos una bebida.' });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: 'Estado del pedido inválido.' });
  }

  const quantities = new Map();
  for (const item of requestedItems) {
    const drinkId = String(item?.drinkId || '');
    const quantity = Number(item?.quantity);

    if (!mongoose.isValidObjectId(drinkId) ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 50) {
      return res.status(400).json({ message: 'Hay una bebida o cantidad inválida.' });
    }

    const nextQuantity = (quantities.get(drinkId) || 0) + quantity;
    if (nextQuantity > 50) {
      return res.status(400).json({ message: 'Máximo 50 unidades por bebida.' });
    }
    quantities.set(drinkId, nextQuantity);
  }

  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Pedido no encontrado.' });
    }

    const drinkIds = [...quantities.keys()];
    const drinks = await Drink.find({ _id: { $in: drinkIds } }).lean();
    if (drinks.length !== drinkIds.length) {
      return res.status(400).json({ message: 'Una o más bebidas no existen.' });
    }

    const drinksById = new Map(drinks.map(drink => [String(drink._id), drink]));
    const items = drinkIds.map(drinkId => {
      const drink = drinksById.get(drinkId);
      return {
        drinkId: drink._id,
        name: drink.name,
        price: drink.price,
        quantity: quantities.get(drinkId)
      };
    });
    const total = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    order.tableNumber = tableNumber;
    order.items = items;
    order.total = total;
    order.status = status;
    await order.save();

    res.json(order);
  } catch (error) {
    console.error('Error editando pedido:', error);
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return res.status(400).json({ message: 'Datos del pedido inválidos.' });
    }
    res.status(500).json({ message: 'No se pudo actualizar el pedido.' });
  }
});

app.delete('/api/orders/:id', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'ID de pedido inválido.' });
  }

  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Pedido no encontrado.' });
    }

    res.json({ message: 'Pedido eliminado correctamente.' });
  } catch (error) {
    console.error('Error eliminando pedido:', error);
    res.status(500).json({ message: 'No se pudo eliminar el pedido.' });
  }
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
