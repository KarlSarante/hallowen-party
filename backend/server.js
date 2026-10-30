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
  featured: { type: Boolean, default: false },
  stock: { type: Number, default: 0, min: 0 },
  minimumStock: { type: Number, default: 0, min: 0 },
  unitsSold: { type: Number, default: 0, min: 0 },
  inventoryUpdatedAt: { type: Date, default: null }
}, { timestamps: true });
const Drink = mongoose.model('Drink', drinkSchema);


const orderSchema = new mongoose.Schema({
  locationType: {
    type: String,
    enum: ['mesa', 'mueble'],
    default: 'mesa'
  },
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
      'Entregado',
      'Cancelado'
    ],
    default: 'Pendiente'
  },
  inventoryState: {
    type: String,
    enum: ['pending', 'sold', 'reversed'],
    default: 'pending'
  }
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);

const orderSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global' },
  orderingEnabled: { type: Boolean, default: false }
}, { timestamps: true });

const OrderSettings = mongoose.model('OrderSettings', orderSettingsSchema);

const inventoryMovementSchema = new mongoose.Schema({
  drink: { type: mongoose.Schema.Types.ObjectId, ref: 'Drink', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  type: { type: String, enum: ['entrada', 'venta', 'ajuste', 'devolucion'], required: true },
  quantity: { type: Number, required: true, min: 1 },
  previousStock: { type: Number, required: true, min: 0 },
  nextStock: { type: Number, required: true, min: 0 },
  reason: { type: String, default: '', trim: true, maxlength: 300 },
  adminEmail: { type: String, default: '' },
  idempotencyKey: { type: String, unique: true, sparse: true },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: String, default: '' },
  voidReason: { type: String, default: '' }
}, { timestamps: true });
const InventoryMovement = mongoose.model('InventoryMovement', inventoryMovementSchema);

const saleStatus = 'Entregado';
const allowedOrderStatuses = ['Pendiente', 'Preparando', 'Listo para entregar', saleStatus, 'Cancelado'];

function inventoryStatus(drink) {
  if (Number(drink.stock || 0) <= 0) return 'Agotado';
  if (Number(drink.stock || 0) <= Number(drink.minimumStock || 0)) return 'Stock bajo';
  return 'Disponible';
}

function stockError(drink, quantity) {
  return drink
    ? `Stock insuficiente para "${drink.name}". Disponible: ${drink.stock}, solicitado: ${quantity}.`
    : 'La bebida ya no existe.';
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

async function applyInventoryDelta(drinkId, delta, options = {}) {
  if (!Number.isInteger(delta) || delta === 0) return;
  const { orderId = null, type, reason = '', adminEmail = '', idempotencyKey, session } = options;
  if (idempotencyKey) {
    const existing = await InventoryMovement.findOne({ idempotencyKey }).session(session);
    if (existing) return;
  }
  const query = { _id: drinkId };
  if (delta < 0) query.stock = { $gte: Math.abs(delta) };
  const drink = await Drink.findOneAndUpdate(
    query,
    {
      $inc: { stock: delta, ...(delta < 0 ? { unitsSold: Math.abs(delta) } : type === 'devolucion' ? { unitsSold: -Math.abs(delta) } : {}) },
      $set: { inventoryUpdatedAt: new Date() }
    },
    { new: false, session }
  );
  if (!drink) {
    const current = await Drink.findById(drinkId).session(session);
    if (!current) throw Object.assign(new Error('Bebida no encontrada.'), { statusCode: 404 });
    throw Object.assign(new Error(stockError(current, Math.abs(delta))), { statusCode: 409 });
  }
  const previousStock = drink.stock;
  await InventoryMovement.create([{
    drink: drink._id,
    order: orderId,
    type,
    quantity: Math.abs(delta),
    previousStock,
    nextStock: previousStock + delta,
    reason,
    adminEmail,
    idempotencyKey
  }], { session });
}

function itemQuantities(items = []) {
  return new Map(items.map(item => [String(item.drinkId), Number(item.quantity)]));
}

async function syncOrderInventory(order, previousItems, previousState, session, adminEmail) {
  const wasSold = previousState === 'sold';
  const isSold = order.status === saleStatus;
  if (order.status === 'Cancelado' && wasSold) {
    for (const [drinkId, quantity] of itemQuantities(previousItems)) {
      await applyInventoryDelta(drinkId, quantity, {
        orderId: order._id, type: 'devolucion', reason: 'Venta cancelada',
        adminEmail, idempotencyKey: `order:${order._id}:return`, session
      });
    }
    order.inventoryState = 'reversed';
    return;
  }
  if (!wasSold && isSold) {
    for (const [drinkId, quantity] of itemQuantities(order.items)) {
      await applyInventoryDelta(drinkId, -quantity, {
        orderId: order._id, type: 'venta', reason: 'Pedido entregado',
        adminEmail, idempotencyKey: `order:${order._id}:sale:${drinkId}`, session
      });
    }
    order.inventoryState = 'sold';
    return;
  }
  if (wasSold && isSold) {
    const before = itemQuantities(previousItems);
    const after = itemQuantities(order.items);
    const ids = new Set([...before.keys(), ...after.keys()]);
    for (const drinkId of ids) {
      const delta = (after.get(drinkId) || 0) - (before.get(drinkId) || 0);
      if (delta !== 0) {
        await applyInventoryDelta(drinkId, -delta, {
          orderId: order._id, type: delta > 0 ? 'venta' : 'devolucion',
          reason: 'Diferencia por edición del pedido', adminEmail,
          idempotencyKey: `order:${order._id}:edit:${new Date().toISOString()}:${drinkId}`, session
        });
      }
    }
  }
}

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

    const locationType = String(req.body?.locationType || '').trim();
    const tableNumber = String(req.body?.tableNumber || '').trim();
    const requestedItems = req.body?.items;

    if (!['mesa', 'mueble'].includes(locationType) || !tableNumber || tableNumber.length > 20) {
      return res.status(400).json({
        message: 'Indica un número de mesa o mueble válido.'
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
      available: true,
      stock: { $gt: 0 }
    }).lean();

    if (drinks.length !== drinkIds.length) {
      return res.status(400).json({
        message: 'Una o más bebidas no están disponibles o no tienen existencias.'
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
      locationType,
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

app.get('/api/inventory', auth, async (_req, res) => {
  try {
    const drinks = await Drink.find().sort({ name: 1 }).lean();
    const items = drinks.map(drink => ({
      ...drink,
      id: String(drink._id),
      status: inventoryStatus(drink)
    }));
    res.json({
      items,
      summary: {
        totalAvailable: items.reduce((sum, item) => sum + item.stock, 0),
        totalSold: items.reduce((sum, item) => sum + item.unitsSold, 0),
        productCount: items.length,
        lowStock: items.filter(item => item.status === 'Stock bajo').length,
        outOfStock: items.filter(item => item.status === 'Agotado').length
      }
    });
  } catch (error) {
    console.error('Error consultando inventario:', error);
    res.status(500).json({ message: 'No se pudo cargar el inventario.' });
  }
});

app.get('/api/inventory/movements', auth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const movements = await InventoryMovement.find()
      .populate('drink', 'name category')
      .populate('order', 'tableNumber')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(movements);
  } catch (error) {
    console.error('Error consultando movimientos:', error);
    res.status(500).json({ message: 'No se pudo cargar el historial de inventario.' });
  }
});

app.get('/api/inventory/sales', auth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const movements = await InventoryMovement.find({ type: 'venta', voidedAt: null })
      .populate('drink', 'name category price')
      .populate('order', 'tableNumber')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const sales = movements.map(movement => ({
      id: String(movement._id),
      drinkName: movement.drink?.name || 'Bebida eliminada',
      category: movement.drink?.category || '',
      quantity: movement.quantity,
      unitPrice: Number(movement.drink?.price || 0),
      total: Number(movement.drink?.price || 0) * movement.quantity,
      createdAt: movement.createdAt,
      source: movement.order ? 'Pedido' : 'Venta rápida',
      tableNumber: movement.order?.tableNumber || ''
    }));
    res.json({
      sales,
      summary: {
        totalUnits: sales.reduce((sum, sale) => sum + sale.quantity, 0),
        totalAmount: sales.reduce((sum, sale) => sum + sale.total, 0)
      }
    });
  } catch (error) {
    console.error('Error consultando ventas:', error);
    res.status(500).json({ message: 'No se pudo cargar el resumen de ventas.' });
  }
});

app.put('/api/inventory/sales/:movementId', auth, async (req, res) => {
  const quantity = Number(req.body?.quantity);
  if (!mongoose.isValidObjectId(req.params.movementId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    return res.status(400).json({ message: 'Indica una cantidad válida.' });
  }
  try {
    const sale = await InventoryMovement.findOne({ _id: req.params.movementId, type: 'venta', voidedAt: null }).lean();
    if (!sale) return res.status(404).json({ message: 'Venta no encontrada o ya anulada.' });
    if (sale.order) return res.status(409).json({ message: 'Las ventas de pedidos se editan desde el pedido original.' });
    const delta = quantity - sale.quantity;
    if (delta !== 0) {
      const drink = await Drink.findOneAndUpdate(
        delta > 0 ? { _id: sale.drink, stock: { $gte: delta } } : { _id: sale.drink },
        { $inc: { stock: -delta, unitsSold: delta }, $set: { inventoryUpdatedAt: new Date() } },
        { new: false }
      ).lean();
      if (!drink) {
        const current = await Drink.findById(sale.drink).lean();
        return res.status(409).json({ message: stockError(current, delta) });
      }
      await InventoryMovement.create({
        drink: sale.drink,
        type: delta > 0 ? 'venta' : 'devolucion',
        quantity: Math.abs(delta),
        previousStock: drink.stock,
        nextStock: drink.stock - delta,
        reason: 'Corrección de venta rápida',
        adminEmail: req.admin.email
      });
    }
    const updated = await InventoryMovement.findByIdAndUpdate(
      sale._id,
      { quantity },
      { new: true, runValidators: true }
    ).lean();
    res.json(updated);
  } catch (error) {
    console.error('Error editando venta:', error);
    res.status(500).json({ message: 'No se pudo editar la venta.' });
  }
});

app.delete('/api/inventory/sales/:movementId', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.movementId)) {
    return res.status(400).json({ message: 'ID de venta inválido.' });
  }
  try {
    const sale = await InventoryMovement.findOneAndUpdate(
      { _id: req.params.movementId, type: 'venta', voidedAt: null },
      { $set: { voidedAt: new Date(), voidedBy: req.admin.email, voidReason: 'Venta eliminada' } },
      { new: false }
    ).lean();
    if (!sale) return res.status(404).json({ message: 'Venta no encontrada o ya anulada.' });
    if (sale.order) return res.status(409).json({ message: 'Las ventas de pedidos se eliminan cancelando el pedido original.' });
    const drink = await Drink.findByIdAndUpdate(
      sale.drink,
      { $inc: { stock: sale.quantity, unitsSold: -sale.quantity }, $set: { inventoryUpdatedAt: new Date() } },
      { new: false }
    ).lean();
    if (!drink) return res.status(404).json({ message: 'Bebida asociada no encontrada.' });
    await InventoryMovement.create({
      drink: sale.drink,
      type: 'devolucion',
      quantity: sale.quantity,
      previousStock: drink.stock,
      nextStock: drink.stock + sale.quantity,
      reason: 'Venta eliminada',
      adminEmail: req.admin.email
    });
    res.json({ message: 'Venta anulada y unidades devueltas.' });
  } catch (error) {
    console.error('Error eliminando venta:', error);
    res.status(500).json({ message: 'No se pudo eliminar la venta.' });
  }
});

app.patch('/api/inventory/:drinkId', auth, async (req, res) => {
  const { drinkId } = req.params;
  const type = req.body?.type;
  const quantity = Number(req.body?.quantity);
  const reason = String(req.body?.reason || '').trim();
  const minimumStock = req.body?.minimumStock;
  if (!mongoose.isValidObjectId(drinkId)) return res.status(400).json({ message: 'ID de bebida inválido.' });
  const targetStock = Number(req.body?.targetStock);
  if (!['entrada', 'ajuste', 'venta', 'edicion'].includes(type) ||
      (type !== 'edicion' && (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10000)) ||
      (type === 'edicion' && (!Number.isInteger(targetStock) || targetStock < 0 || targetStock > 100000))) {
    return res.status(400).json({ message: 'Indica un tipo y una cantidad válida.' });
  }
  if (type === 'ajuste' && !reason) return res.status(400).json({ message: 'Indica el motivo del ajuste.' });
  if (minimumStock !== undefined && (!Number.isInteger(Number(minimumStock)) || Number(minimumStock) < 0)) {
    return res.status(400).json({ message: 'El stock mínimo debe ser un entero no negativo.' });
  }
  try {
    if (type === 'edicion') {
      const current = await Drink.findById(drinkId).lean();
      if (!current) return res.status(404).json({ message: 'Bebida no encontrada.' });
      const delta = targetStock - current.stock;
      if (delta !== 0) {
        const updated = await Drink.findOneAndUpdate(
          delta < 0 ? { _id: drinkId, stock: { $gte: Math.abs(delta) } } : { _id: drinkId },
          {
            $inc: { stock: delta },
            $set: { minimumStock: Number(minimumStock), inventoryUpdatedAt: new Date() }
          },
          { new: false }
        ).lean();
        if (!updated) {
          const latest = await Drink.findById(drinkId).lean();
          return res.status(409).json({ message: stockError(latest, Math.abs(delta)) });
        }
        await InventoryMovement.create({
          drink: drinkId,
          type: 'ajuste',
          quantity: Math.abs(delta),
          previousStock: updated.stock,
          nextStock: targetStock,
          reason: reason || 'Edición directa del inventario',
          adminEmail: req.admin.email
        });
      } else {
        await Drink.findByIdAndUpdate(drinkId, {
          minimumStock: Number(minimumStock),
          inventoryUpdatedAt: new Date()
        });
      }
      const result = await Drink.findById(drinkId).lean();
      return res.json({ ...result, id: String(result._id), status: inventoryStatus(result) });
    }

    if (type === 'venta') {
      const current = await Drink.findById(drinkId).lean();
      if (!current) return res.status(404).json({ message: 'Bebida no encontrada.' });
      const idempotencyKey = req.get('Idempotency-Key') || undefined;
      if (idempotencyKey) {
        const existing = await InventoryMovement.findOne({ idempotencyKey }).lean();
        if (existing) {
          const unchanged = await Drink.findById(drinkId).lean();
          return res.json({ ...unchanged, id: String(unchanged._id), status: inventoryStatus(unchanged) });
        }
      }
      const updated = await Drink.findOneAndUpdate(
        { _id: drinkId, stock: { $gte: quantity } },
        { $inc: { stock: -quantity, unitsSold: quantity }, $set: { inventoryUpdatedAt: new Date() } },
        { new: false }
      ).lean();
      if (!updated) {
        const latest = await Drink.findById(drinkId).lean();
        return res.status(409).json({ message: stockError(latest, quantity) });
      }
      await InventoryMovement.create({
        drink: drinkId,
        type: 'venta',
        quantity,
        previousStock: updated.stock,
        nextStock: updated.stock - quantity,
        reason: 'Venta rápida',
        adminEmail: req.admin.email,
        idempotencyKey
      });
      const result = await Drink.findById(drinkId).lean();
      return res.json({ ...result, id: String(result._id), status: inventoryStatus(result) });
    }

    const drink = await withTransaction(async session => {
      const current = await Drink.findById(drinkId).session(session);
      if (!current) throw Object.assign(new Error('Bebida no encontrada.'), { statusCode: 404 });
      const delta = type === 'entrada' ? quantity : (type === 'venta' || req.body.direction === 'salida' ? -quantity : quantity);
      await applyInventoryDelta(drinkId, delta, {
        type, reason: reason || (type === 'entrada' ? 'Reposición de inventario' : type === 'venta' ? 'Venta rápida' : 'Ajuste de inventario'),
        adminEmail: req.admin.email, idempotencyKey: req.get('Idempotency-Key') || undefined, session
      });
      if (minimumStock !== undefined) current.minimumStock = Number(minimumStock);
      await current.save({ session });
      return Drink.findById(drinkId).session(session).lean();
    });
    res.json({ ...drink, id: String(drink._id), status: inventoryStatus(drink) });
  } catch (error) {
    console.error('Error actualizando inventario:', error);
    res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({
      message: error.statusCode ? error.message : 'No se pudo actualizar el inventario.'
    });
  }
});

app.patch('/api/inventory/:drinkId/minimum', auth, async (req, res) => {
  const minimumStock = Number(req.body?.minimumStock);
  if (!mongoose.isValidObjectId(req.params.drinkId) || !Number.isInteger(minimumStock) || minimumStock < 0) {
    return res.status(400).json({ message: 'El stock mínimo debe ser un entero no negativo.' });
  }
  try {
    const drink = await Drink.findByIdAndUpdate(
      req.params.drinkId,
      { minimumStock, inventoryUpdatedAt: new Date() },
      { new: true, runValidators: true }
    ).lean();
    if (!drink) return res.status(404).json({ message: 'Bebida no encontrada.' });
    res.json({ ...drink, id: String(drink._id), status: inventoryStatus(drink) });
  } catch (error) {
    res.status(400).json({ message: 'No se pudo configurar el stock mínimo.' });
  }
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
  const { status } = req.body || {};

  if (!allowedOrderStatuses.includes(status)) {
    return res.status(400).json({
      message: 'Estado del pedido inválido.'
    });
  }

  try {
    const order = await withTransaction(async session => {
      const current = await Order.findById(req.params.id).session(session);
      if (!current) throw Object.assign(new Error('Pedido no encontrado.'), { statusCode: 404 });
      const previousState = current.inventoryState;
      const previousItems = current.items.map(item => item.toObject());
      current.status = status;
      await syncOrderInventory(current, previousItems, previousState, session, req.admin.email);
      await current.save({ session });
      return current;
    });
    res.json(order);
  } catch (error) {
    console.error('Error actualizando estado del pedido:', error);
    res.status(error.statusCode || (error.code === 11000 ? 409 : 400)).json({
      message: error.statusCode ? error.message : error.message || 'No se pudo actualizar el pedido.'
    });
  }
});

app.put('/api/orders/:id', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'ID de pedido inválido.' });
  }

  const locationType = typeof req.body?.locationType === 'string'
    ? req.body.locationType.trim()
    : '';
  const tableNumber = typeof req.body?.tableNumber === 'string'
    ? req.body.tableNumber.trim()
    : '';
  const requestedItems = req.body?.items;
  const { status } = req.body || {};

  if (!['mesa', 'mueble'].includes(locationType) || !tableNumber || tableNumber.length > 20) {
    return res.status(400).json({ message: 'Indica un número de mesa o mueble válido.' });
  }

  if (!Array.isArray(requestedItems) ||
      requestedItems.length === 0 ||
      requestedItems.length > 30) {
    return res.status(400).json({ message: 'El pedido debe incluir al menos una bebida.' });
  }

  if (!allowedOrderStatuses.includes(status)) {
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
    const order = await withTransaction(async session => {
      const currentOrder = await Order.findById(req.params.id).session(session);
      if (!currentOrder) throw Object.assign(new Error('Pedido no encontrado.'), { statusCode: 404 });

      const drinkIds = [...quantities.keys()];
      const drinks = await Drink.find({ _id: { $in: drinkIds } }).session(session).lean();
      if (drinks.length !== drinkIds.length) throw Object.assign(new Error('Una o más bebidas no existen.'), { statusCode: 400 });

      const drinksById = new Map(drinks.map(drink => [String(drink._id), drink]));
      const items = drinkIds.map(drinkId => {
        const drink = drinksById.get(drinkId);
        return { drinkId: drink._id, name: drink.name, price: drink.price, quantity: quantities.get(drinkId) };
      });
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

      const previousItems = currentOrder.items.map(item => item.toObject());
      const previousState = currentOrder.inventoryState;
      currentOrder.tableNumber = tableNumber;
      currentOrder.locationType = locationType;
      currentOrder.items = items;
      currentOrder.total = total;
      currentOrder.status = status;
      await syncOrderInventory(currentOrder, previousItems, previousState, session, req.admin.email);
      await currentOrder.save({ session });
      return currentOrder;
    });

    res.json(order);
  } catch (error) {
    console.error('Error editando pedido:', error);
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return res.status(400).json({ message: 'Datos del pedido inválidos.' });
    }
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'No se pudo actualizar el pedido.' });
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
