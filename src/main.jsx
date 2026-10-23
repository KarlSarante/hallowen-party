
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import {
  Skull, Search, LockKeyhole, LogOut, Plus, Pencil, Trash2,
  X, Check, QrCode, Flame, Martini, Ghost, ShoppingCart, Power
} from 'lucide-react';
import './styles.css';
import './poster.css';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const TOKEN_KEY = 'halloween_admin_token';

const getToken = () => localStorage.getItem(TOKEN_KEY);

const api = async (path, options = {}) => {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.message || 'Ocurrió un error al comunicarse con el servidor.');
  }

  return body;
};

const categories = [
  'Todas', 'Cócteles', 'Whisky', 'Ron', 'Vodka',
  'Cervezas', 'Vino', 'Sin alcohol', 'Otros'
];

const orderStatuses = [
  'Pendiente',
  'Preparando',
  'Listo para entregar',
  'Entregado'
];

const money = (value) =>
  new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const dragFileName = (name) =>
  `${String(name || 'bebida').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bebida'}.jpg`;

function handleDrinkImageDrag(event, drink) {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/uri-list', drink.image_url);
  event.dataTransfer.setData('text/plain', drink.image_url);
  event.dataTransfer.setData(
    'DownloadURL',
    `image/jpeg:${dragFileName(drink.name)}:${drink.image_url}`
  );
}

function App() {
  const [drinks, setDrinks] = useState([]);
  const [session, setSession] = useState(Boolean(getToken()));
  const [category, setCategory] = useState('Todas');
  const [query, setQuery] = useState('');
  const [adminMode, setAdminMode] = useState(
    location.pathname.replace(/\/$/, '') === '/admin'
  );
  const [showQR, setShowQR] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Estado del carrito y de los pedidos
  const [cart, setCart] = useState({});
  const [tableNumber, setTableNumber] = useState('');
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderEditing, setOrderEditing] = useState(null);
  const [orderDraft, setOrderDraft] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderingEnabled, setOrderingEnabled] = useState(false);
  const [updatingOrderAccess, setUpdatingOrderAccess] = useState(false);

  const demoDrinks = [
    {
      id: 'demo1',
      name: 'Sangre de Vampiro',
      category: 'Cócteles',
      price: 350,
      description: 'Cóctel especial de la noche',
      image_url: '',
      available: true,
      featured: true
    },
    {
      id: 'demo2',
      name: 'Elixir Maldito',
      category: 'Cócteles',
      price: 300,
      description: 'Una mezcla misteriosa',
      image_url: '',
      available: true,
      featured: false
    },
    {
      id: 'demo3',
      name: 'Poción de Bruja',
      category: 'Sin alcohol',
      price: 150,
      description: 'Refresco especial sin alcohol',
      image_url: '',
      available: true,
      featured: false
    }
  ];

  async function loadDrinks() {
    try {
      const data = await api('/api/drinks');
      setDrinks(data);
      setNotice('');
    } catch (error) {
      setDrinks(demoDrinks);
      setNotice(`No se pudo conectar con el servidor: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadOrderSettings() {
    try {
      const settings = await api('/api/settings/orders');
      setOrderingEnabled(settings.orderingEnabled === true);
    } catch (error) {
      setOrderingEnabled(false);
      setNotice(`No se pudo consultar si los pedidos están habilitados: ${error.message}`);
    }
  }

  function changeQuantity(drinkId, delta) {
    setCart(current => {
      const nextQuantity = (current[drinkId] || 0) + delta;
      const next = { ...current };

      if (nextQuantity <= 0) {
        delete next[drinkId];
      } else if (nextQuantity <= 50) {
        next[drinkId] = nextQuantity;
      }

      return next;
    });
  }

  async function submitOrder() {
    if (!orderingEnabled) {
      setOrderError('Los pedidos están desactivados temporalmente.');
      return;
    }

    const table = tableNumber.trim();

    if (!table) {
      setOrderError('Introduce tu número de mesa.');
      return;
    }

    const items = Object.entries(cart).map(([drinkId, quantity]) => ({
      drinkId,
      quantity
    }));

    if (items.length === 0) {
      setOrderError('Añade al menos una bebida al pedido.');
      return;
    }

    if (items.some(item => item.drinkId.startsWith('demo'))) {
      setOrderError(
        'El menú de demostración no permite realizar pedidos. Intenta de nuevo cuando se conecte el servidor.'
      );
      return;
    }

    setSubmittingOrder(true);
    setOrderError('');

    try {
      const result = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          tableNumber: table,
          items
        })
      });

      setCart({});
      setTableNumber('');
      setNotice(result.message || '¡Pedido enviado correctamente!');
    } catch (error) {
      setOrderError(error.message);
    } finally {
      setSubmittingOrder(false);
    }
  }

  async function toggleOrdering() {
    setUpdatingOrderAccess(true);
    try {
      const settings = await api('/api/settings/orders', {
        method: 'PUT',
        body: JSON.stringify({ orderingEnabled: !orderingEnabled })
      });
      setOrderingEnabled(settings.orderingEnabled === true);
      if (!settings.orderingEnabled) {
        setCart({});
        setTableNumber('');
        setOrderError('');
      }
      setNotice(
        settings.orderingEnabled
          ? 'Pedidos habilitados para los invitados.'
          : 'Pedidos deshabilitados. El menú está en modo consulta.'
      );
    } catch (error) {
      setNotice(error.message || 'No se pudo cambiar el acceso a pedidos.');
    } finally {
      setUpdatingOrderAccess(false);
    }
  }

  async function loadOrders() {
    setLoadingOrders(true);

    try {
      const data = await api('/api/orders');
      setOrders(data);
    } catch (error) {
      setNotice(error.message || 'No se pudieron cargar los pedidos.');
    } finally {
      setLoadingOrders(false);
    }
  }

  async function updateOrderStatus(orderId, status) {
    try {
      const updatedOrder = await api(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });

      setOrders(current =>
        current.map(order => order._id === orderId ? updatedOrder : order)
      );
      setNotice('Estado del pedido actualizado.');
    } catch (error) {
      setNotice(error.message || 'No se pudo actualizar el pedido.');
    }
  }

  async function deleteOrder(orderId) {
    if (!window.confirm('¿Seguro que quieres eliminar este pedido? Esta acción no se puede deshacer.')) {
      return;
    }

    try {
      await api(`/api/orders/${orderId}`, { method: 'DELETE' });
      setOrders(current => current.filter(order => order._id !== orderId));
      if (orderEditing?._id === orderId) {
        cancelOrderEditing();
      }
      setNotice('Pedido eliminado correctamente.');
    } catch (error) {
      setNotice(error.message || 'No se pudo eliminar el pedido.');
    }
  }

  function startOrderEditing(order) {
    setOrderEditing(order);
    setOrderDraft({
      tableNumber: order.tableNumber,
      status: order.status,
      items: (order.items || []).map(item => ({
        drinkId: String(item.drinkId),
        name: item.name,
        price: Number(item.price),
        quantity: Number(item.quantity)
      }))
    });
  }

  function cancelOrderEditing() {
    setOrderEditing(null);
    setOrderDraft(null);
  }

  function updateOrderDraft(changes) {
    setOrderDraft(current => ({ ...current, ...changes }));
  }

  function updateOrderItemQuantity(drinkId, quantity) {
    const nextQuantity = Number(quantity);
    setOrderDraft(current => ({
      ...current,
      items: current.items.map(item =>
        item.drinkId === drinkId
          ? { ...item, quantity: Number.isInteger(nextQuantity) ? nextQuantity : quantity }
          : item
      )
    }));
  }

  function addOrderItem(drinkId) {
    const drink = drinks.find(item => item.id === drinkId);
    if (!drink) return;

    setOrderDraft(current => {
      const existing = current.items.find(item => item.drinkId === drinkId);
      if (existing) {
        return {
          ...current,
          items: current.items.map(item =>
            item.drinkId === drinkId
              ? { ...item, quantity: Math.min(50, item.quantity + 1) }
              : item
          )
        };
      }

      return {
        ...current,
        items: [
          ...current.items,
          { drinkId, name: drink.name, price: Number(drink.price), quantity: 1 }
        ]
      };
    });
  }

  function removeOrderItem(drinkId) {
    setOrderDraft(current => ({
      ...current,
      items: current.items.filter(item => item.drinkId !== drinkId)
    }));
  }

  async function saveOrderEdit(event) {
    event.preventDefault();
    if (!orderEditing || !orderDraft) return;

    const table = orderDraft.tableNumber.trim();
    const items = orderDraft.items.map(item => ({
      drinkId: item.drinkId,
      quantity: Number(item.quantity)
    }));

    if (!table || table.length > 20) {
      setNotice('Indica un número de mesa válido.');
      return;
    }
    if (items.length === 0) {
      setNotice('El pedido debe incluir al menos una bebida.');
      return;
    }
    if (items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50)) {
      setNotice('Las cantidades deben ser enteros entre 1 y 50.');
      return;
    }

    setSavingOrder(true);
    try {
      const updatedOrder = await api(`/api/orders/${orderEditing._id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tableNumber: table,
          items,
          status: orderDraft.status
        })
      });

      setOrders(current =>
        current.map(order =>
          order._id === updatedOrder._id ? updatedOrder : order
        )
      );
      cancelOrderEditing();
      setNotice('Pedido actualizado correctamente.');
    } catch (error) {
      setNotice(error.message || 'No se pudo actualizar el pedido.');
    } finally {
      setSavingOrder(false);
    }
  }

  useEffect(() => {
    loadDrinks();
    loadOrderSettings();
  }, []);

  useEffect(() => {
    const onRoute = () =>
      setAdminMode(location.pathname.replace(/\/$/, '') === '/admin');

    window.addEventListener('popstate', onRoute);
    return () => window.removeEventListener('popstate', onRoute);
  }, []);

  useEffect(() => {
    if (adminMode && session) {
      loadOrders();
    }
  }, [adminMode, session]);

  const visibleDrinks = useMemo(
    () =>
      drinks.filter(d =>
        (category === 'Todas' || d.category === category) &&
        `${d.name} ${d.description || ''} ${d.category}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [drinks, category, query]
  );

  const cartDrinks = drinks.filter(
    drink => (cart[drink.id] || 0) > 0
  );

  const cartTotal = cartDrinks.reduce(
    (total, drink) => total + drink.price * cart[drink.id],
    0
  );

  async function signIn(e) {
    e.preventDefault();
    setBusy(true);

    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword
        })
      });

      localStorage.setItem(TOKEN_KEY, result.token);
      setSession(true);
      setLoginPassword('');
      setNotice('Sesión iniciada.');
      await loadDrinks();
    } catch (error) {
      setNotice(error.message || 'No se pudo iniciar sesión. Revisa tus credenciales.');
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    setSession(false);
    setOrders([]);
    navigate('/');
    setNotice('Sesión cerrada.');
  }

  async function saveDrink(e) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);

    const payload = {
      name: String(form.get('name')).trim(),
      category: String(form.get('category')),
      price: Number(form.get('price')),
      image_url: String(form.get('image_url') || '').trim(),
      description: String(form.get('description') || '').trim(),
      available: form.get('available') === 'on',
      featured: form.get('featured') === 'on'
    };

    if (!payload.name || !Number.isFinite(payload.price) || payload.price < 0) {
      setNotice('Escribe un nombre y un precio válido.');
      return;
    }

    setBusy(true);

    try {
      if (editing?.id) {
        await api(`/api/drinks/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await api('/api/drinks', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      setEditing(null);
      setNotice('¡Bebida guardada!');
      await loadDrinks();
    } catch (error) {
      setNotice(error.message || 'No se pudo guardar la bebida.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteDrink(id) {
    if (!confirm('¿Seguro que quieres eliminar esta bebida?')) return;

    try {
      await api(`/api/drinks/${id}`, { method: 'DELETE' });
      setNotice('Bebida eliminada.');
      await loadDrinks();
    } catch (error) {
      setNotice(error.message || 'No se pudo eliminar la bebida.');
    }
  }

  async function toggleAvailability(drink) {
    try {
      await api(`/api/drinks/${drink.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ available: !drink.available })
      });

      await loadDrinks();
    } catch (error) {
      setNotice(error.message || 'No se pudo actualizar la disponibilidad.');
    }
  }

  function navigate(path) {
    if (location.pathname !== path) {
      history.pushState({}, '', path);
    }

    setAdminMode(path === '/admin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const publicUrl = `${location.origin}/`;
  const openAdmin = () => navigate('/admin');
  const closeAdmin = () => navigate('/');

  return (
    <div className="app-shell">
      <div className="ambient ambient-one"></div>
      <div className="ambient ambient-two"></div>

      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={e => {
            e.preventDefault();
            closeAdmin();
          }}
        >
          <span className="brand-mark"><Skull size={23} /></span>
          <span>
            HALLOWEEN<span className="red"> PARTY</span>
            <small>MENÚ DIGITAL · 2026</small>
          </span>
        </a>

        <div className="top-actions">
          <button
            className="icon-button"
            onClick={() => setShowQR(!showQR)}
            aria-label="Ver código QR"
          >
            <QrCode size={18} />
            <span>Ver QR</span>
          </button>
          <button className="admin-link" onClick={openAdmin}>
            <LockKeyhole size={16} /> Admin
          </button>
        </div>
      </header>

      {adminMode ? (
        <main className="admin-page">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ZONA PRIVADA</span>
              <h1>Panel de <span className="red">control</span></h1>
              <p>Administra las bebidas, los precios y los pedidos.</p>
            </div>

            {session && (
              <button className="button ghost" onClick={signOut}>
                <LogOut size={16} /> Cerrar sesión
              </button>
            )}
          </div>

          {!session ? (
            <form className="login-card" onSubmit={signIn}>
              <div className="login-icon"><LockKeyhole size={25} /></div>
              <h2>Acceso de administrador</h2>
              <p>Solo tú puedes administrar el menú.</p>

              <label>
                Correo electrónico
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="tu correo"
                />
              </label>

              <label>
                Contraseña
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Tu contraseña"
                />
              </label>

              <button className="button primary full" disabled={busy}>
                {busy ? 'Entrando…' : 'Entrar al panel'}
              </button>
            </form>
          ) : (
            <>
              <div className="admin-toolbar">
                <div className="admin-count">
                  <strong>{drinks.length}</strong>
                  <span>bebidas en el menú</span>
                </div>
                <div className="admin-toolbar-actions">
                  <button
                    className={`button ${orderingEnabled ? 'primary' : 'ghost'}`}
                    onClick={toggleOrdering}
                    disabled={updatingOrderAccess}
                  >
                    <Power size={16} />
                    {updatingOrderAccess
                      ? 'Actualizando…'
                      : orderingEnabled
                        ? 'Pedidos habilitados'
                        : 'Habilitar pedidos'}
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setEditing({})}
                  >
                    <Plus size={17} /> Añadir bebida
                  </button>
                </div>
              </div>

              {editing && (
                <form className="edit-form" onSubmit={saveDrink}>
                  <div className="form-title">
                    <h2>{editing.id ? 'Editar bebida' : 'Nueva bebida'}</h2>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setEditing(null)}
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="form-grid">
                    <label>
                      Nombre
                      <input
                        name="name"
                        required
                        defaultValue={editing.name || ''}
                        placeholder="Ej. Sangre de Vampiro"
                      />
                    </label>

                    <label>
                      Categoría
                      <select name="category" defaultValue={editing.category || 'Cócteles'}>
                        {categories.filter(c => c !== 'Todas').map(c => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Precio (RD$)
                      <input
                        name="price"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        defaultValue={editing.price ?? ''}
                        placeholder="350"
                      />
                    </label>

                    <label>
                      URL de fotografía
                      <input
                        name="image_url"
                        type="url"
                        defaultValue={editing.image_url || ''}
                        placeholder="https://..."
                      />
                    </label>

                    <label className="wide">
                      Descripción
                      <input
                        name="description"
                        defaultValue={editing.description || ''}
                        placeholder="Descripción breve"
                      />
                    </label>

                    <div className="check-row">
                      <label>
                        <input
                          name="available"
                          type="checkbox"
                          defaultChecked={editing.available ?? true}
                        /> Disponible
                      </label>
                      <label>
                        <input
                          name="featured"
                          type="checkbox"
                          defaultChecked={editing.featured ?? false}
                        /> Destacada
                      </label>
                    </div>
                  </div>

                  <button className="button primary" disabled={busy}>
                    <Check size={17} />
                    {busy ? 'Guardando…' : 'Guardar bebida'}
                  </button>
                </form>
              )}

              <div className="admin-list">
                {drinks.map(d => (
                  <article className="admin-item" key={d.id}>
                    <div className="mini-thumb">
                      {d.image_url ? <img src={d.image_url} alt="" /> : <Martini />}
                    </div>

                    <div className="admin-item-info">
                      <strong>{d.name}</strong>
                      <span>
                        {d.category} · {money(d.price)} · {d.available ? 'Disponible' : 'Agotada'}
                      </span>
                    </div>

                    <button
                      className="icon-button"
                      title="Cambiar disponibilidad"
                      onClick={() => toggleAvailability(d)}
                    >
                      {d.available ? '✓' : '×'}
                    </button>

                    <button
                      className="icon-button"
                      title="Editar"
                      onClick={() => setEditing(d)}
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      className="icon-button danger"
                      title="Eliminar"
                      onClick={() => deleteDrink(d.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </article>
                ))}
              </div>

              {/* PANEL DE PEDIDOS */}
              <section className="orders-panel">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">PEDIDOS DE LOS INVITADOS</span>
                    <h2>Pedidos <span className="red">recibidos</span></h2>
                    <p>Consulta las mesas y actualiza el estado de cada pedido.</p>
                  </div>

                  <button
                    className="button ghost"
                    onClick={loadOrders}
                    disabled={loadingOrders}
                  >
                    {loadingOrders ? 'Actualizando…' : 'Actualizar pedidos'}
                  </button>
                </div>

                {orderEditing && orderDraft && (
                  <form className="order-edit-form" onSubmit={saveOrderEdit}>
                    <div className="form-title">
                      <div>
                        <span className="eyebrow">EDITANDO PEDIDO</span>
                        <h2>Mesa y <span className="red">bebidas</span></h2>
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={cancelOrderEditing}
                        aria-label="Cancelar edición del pedido"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div className="form-grid">
                      <label>
                        Número de mesa
                        <input
                          value={orderDraft.tableNumber}
                          onChange={event => updateOrderDraft({
                            tableNumber: event.target.value
                          })}
                          maxLength={20}
                          required
                        />
                      </label>

                      <label>
                        Estado del pedido
                        <select
                          value={orderDraft.status}
                          onChange={event => updateOrderDraft({
                            status: event.target.value
                          })}
                        >
                          {orderStatuses.map(status => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="order-edit-items">
                      {orderDraft.items.map(item => (
                        <div className="order-edit-item" key={item.drinkId}>
                          <div>
                            <strong>{item.name}</strong>
                            <span>{money(item.price)} por unidad</span>
                          </div>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            step="1"
                            value={item.quantity}
                            onChange={event => updateOrderItemQuantity(
                              item.drinkId,
                              event.target.value
                            )}
                            aria-label={`Cantidad de ${item.name}`}
                          />
                          <strong>{money(item.price * item.quantity)}</strong>
                          <button
                            type="button"
                            className="icon-button danger"
                            onClick={() => removeOrderItem(item.drinkId)}
                            aria-label={`Quitar ${item.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="order-add-item">
                      <select
                        defaultValue=""
                        onChange={event => {
                          if (event.target.value) addOrderItem(event.target.value);
                          event.target.value = '';
                        }}
                        aria-label="Añadir bebida al pedido"
                      >
                        <option value="">Añadir bebida…</option>
                        {drinks.map(drink => (
                          <option key={drink.id} value={drink.id}>
                            {drink.name} · {money(drink.price)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="order-edit-total">
                      <span>Total actualizado</span>
                      <strong>
                        {money(orderDraft.items.reduce(
                          (total, item) => total + item.price * Number(item.quantity || 0),
                          0
                        ))}
                      </strong>
                    </div>

                    <div className="order-edit-actions">
                      <button
                        type="button"
                        className="button ghost"
                        onClick={cancelOrderEditing}
                        disabled={savingOrder}
                      >
                        Cancelar
                      </button>
                      <button className="button primary" disabled={savingOrder}>
                        <Check size={17} />
                        {savingOrder ? 'Guardando…' : 'Guardar cambios'}
                      </button>
                    </div>
                  </form>
                )}

                {loadingOrders && orders.length === 0 ? (
                  <p className="empty-state">Cargando pedidos…</p>
                ) : orders.length === 0 ? (
                  <div className="empty-state">
                    <Ghost size={30} />
                    <h3>No hay pedidos todavía</h3>
                    <p>Los pedidos de los invitados aparecerán aquí.</p>
                  </div>
                ) : (
                  <div className="orders-list">
                    {orders.map(order => (
                      <article className="order-card" key={order._id}>
                        <div className="order-card-heading">
                          <div>
                            <span className="eyebrow">MESA</span>
                            <h3>{order.tableNumber}</h3>
                          </div>
                          <strong>{money(order.total)}</strong>
                        </div>

                        <p className="order-time">
                          {order.createdAt
                            ? new Date(order.createdAt).toLocaleString('es-DO')
                            : 'Hora no disponible'}
                        </p>

                        <div className="order-items-list">
                          {(order.items || []).map((item, index) => (
                            <div
                              className="order-summary-item"
                              key={`${order._id}-${index}`}
                            >
                              <span>{item.name} × {item.quantity}</span>
                              <strong>{money(item.price * item.quantity)}</strong>
                            </div>
                          ))}
                        </div>

                        <label>
                          Estado del pedido
                          <select
                            value={order.status}
                            onChange={e => updateOrderStatus(order._id, e.target.value)}
                          >
                            {orderStatuses.map(status => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="button ghost order-edit-button"
                          onClick={() => startOrderEditing(order)}
                          type="button"
                        >
                          <Pencil size={15} /> Editar pedido
                        </button>
                        <button
                          className="button ghost danger-button order-edit-button"
                          onClick={() => deleteOrder(order._id)}
                          type="button"
                        >
                          <Trash2 size={15} /> Eliminar pedido
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      ) : (
        <main>
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="eyebrow-line"></span> UNA NOCHE · MIL SECRETOS
              </span>

              <h1>
                EL LADO<br />
                <span className="outline">OSCURO</span> <span className="red">DEL</span><br />
                SABOR.
              </h1>

              <p>
                Tragos misteriosos, espíritus libres y una noche que no olvidarás.
                Explora la carta y encuentra tu próxima tentación.
              </p>

              <a href="#menu" className="button primary">
                Explorar bebidas <Flame size={17} />
              </a>

              <div className="hero-note">
                <span className="pulse"></span> HALLOWEEN PARTY · 2026
              </div>
            </div>

            <div className="hero-art">
              <div className="moon"></div>
              <div className="art-ring ring-one"></div>
              <div className="art-ring ring-two"></div>
              <div className="art-skull">
                <Skull size={150} strokeWidth={1.1} />
              </div>
              <span className="art-stamp">FEAR<br />THE<br /><b>FLAVOR</b></span>
              <span className="art-side">NOCTURNAL EDITION · 31 OCT</span>
            </div>
          </section>

          <section id="menu" className="menu-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">LA CARTA PROHIBIDA</span>
                <h2>Elige tu <span className="red">veneno.</span></h2>
                <p>Todos los precios están expresados en pesos dominicanos.</p>
              </div>
              <div className="menu-total">
                <span>{visibleDrinks.length.toString().padStart(2, '0')}</span> BEBIDAS
              </div>
            </div>

            <div className="menu-tools">
              <div className="search-box">
                <Search size={18} />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar una bebida…"
                />
              </div>

              <div className="categories">
                {categories.map(c => (
                  <button
                    key={c}
                    className={category === c ? 'active' : ''}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="empty-state">Preparando la carta…</div>
            ) : visibleDrinks.length === 0 ? (
              <div className="empty-state">
                <Ghost size={35} />
                <h3>No hay bebidas aquí… todavía.</h3>
                <p>Vuelve a mirar cuando caiga la noche.</p>
              </div>
            ) : (
              <div className="drink-grid">
                {visibleDrinks.map((d, i) => (
                  <article
                    className={`drink-card ${!d.available ? 'unavailable' : ''}`}
                    key={d.id}
                  >
                    <div className="drink-image">
                      {d.image_url ? (
                        <img
                          src={d.image_url}
                          alt={d.name}
                          loading="lazy"
                          draggable="true"
                          onDragStart={event => handleDrinkImageDrag(event, d)}
                          title="Arrastra para descargar en JPG"
                        />
                      ) : (
                        <div className="image-placeholder">
                          <Martini size={47} strokeWidth={1} />
                          <span>HALLOWEEN<br />SPECIAL</span>
                        </div>
                      )}

                      {d.featured && (
                        <span className="featured-badge">
                          <Flame size={13} /> DESTACADA
                        </span>
                      )}

                      {!d.available && <span className="sold-badge">AGOTADA</span>}
                      <span className="card-index">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    </div>

                    <div className="drink-details">
                      <div className="drink-category">{d.category}</div>
                      <h3>{d.name}</h3>
                      {d.description && <p>{d.description}</p>}

                      <div className="drink-bottom">
                        <strong>{money(d.price)}</strong>
                        <span className={d.available ? 'status' : 'status sold'}>
                          <i></i>{d.available ? 'Disponible' : 'Agotada'}
                        </span>
                      </div>

                      {orderingEnabled && d.available && !String(d.id).startsWith('demo') && (
                        <div className="order-controls">
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => changeQuantity(d.id, -1)}
                            aria-label={`Quitar ${d.name}`}
                          >
                            −
                          </button>

                          <strong>{cart[d.id] || 0}</strong>

                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => changeQuantity(d.id, 1)}
                            disabled={(cart[d.id] || 0) >= 50}
                            aria-label={`Añadir ${d.name}`}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {!orderingEnabled && (
            <section className="orders-disabled-notice" aria-live="polite">
              <ShoppingCart size={20} />
              <div>
                <strong>Pedidos temporalmente desactivados</strong>
                <span>El menú está disponible solo para consulta.</span>
              </div>
            </section>
          )}

          {/* RESUMEN DEL CARRITO: FUERA DE menu-section */}
          {orderingEnabled && cartDrinks.length > 0 && (
            <section className="order-summary" aria-label="Tu pedido">
              <span className="eyebrow">TU PEDIDO</span>
              <h2>Una ronda más...</h2>

              <div className="order-summary-items">
                {cartDrinks.map(drink => (
                  <div className="order-summary-item" key={drink.id}>
                    <span>
                      {drink.name} × {cart[drink.id]}
                    </span>
                    <strong>{money(drink.price * cart[drink.id])}</strong>
                  </div>
                ))}
              </div>

              <div className="order-total">
                <span>Total estimado</span>
                <strong>{money(cartTotal)}</strong>
              </div>

              <form onSubmit={e => {
                e.preventDefault();
                submitOrder();
              }}>
                <label>
                  Número de mesa
                  <input
                    value={tableNumber}
                    onChange={e => setTableNumber(e.target.value)}
                    placeholder="Ej. Mesa 12"
                    maxLength={20}
                    required
                  />
                </label>

                {orderError && <p role="alert">{orderError}</p>}

                <button
                  type="submit"
                  className="button primary full"
                  disabled={submittingOrder}
                >
                  {submittingOrder ? 'Enviando pedido…' : 'Confirmar pedido'}
                </button>
              </form>
            </section>
          )}

          <section className="closing-banner">
            <Skull size={27} />
            <div>
              <span>LA NOCHE ES JOVEN</span>
              <h2>¿TE ATREVES A <em>PROBAR?</em></h2>
            </div>
            <span className="closing-year">2026</span>
          </section>

          <section className="sponsors" aria-label="Patrocinadores oficiales">
            <span className="sponsors-label">PATROCINADORES OFICIALES</span>
            <div className="sponsor-list">
              <div className="sponsor">
                <span className="sponsor-mark">◇</span>
                <strong>CABRAL</strong>
                <small>JOYERÍA</small>
              </div>
              <div className="sponsor-divider"></div>
              <div className="sponsor">
                <span className="sponsor-mark">✚</span>
                <strong>FARMACIA</strong>
                <small>TAYUBA</small>
              </div>
              <div className="sponsor-divider"></div>
              <div className="sponsor sponsor-icon-only" aria-label="Patrocinador oficial">
                <span className="sponsor-bars"></span>
              </div>
            </div>
          </section>
        </main>
      )}

      <footer>
        <div className="footer-brand">
          <Skull size={18} /> HALLOWEEN <span className="red">PARTY</span>
        </div>
        <span>HECHO PARA UNA NOCHE EXTRAORDINARIA · 2026</span>
        <button onClick={openAdmin}>Acceso privado</button>
      </footer>

      {showQR && (
        <div className="modal-backdrop" onClick={() => setShowQR(false)}>
          <div className="qr-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowQR(false)}>
              <X />
            </button>

            <div className="qr-icon"><QrCode size={25} /></div>
            <span className="eyebrow">ESCANEA Y DESCUBRE</span>
            <h2>Entra en la <span className="red">noche.</span></h2>

            <div className="qr-box">
              <QRCodeSVG value={publicUrl} size={210} level="H" includeMargin />
            </div>

            <p>Escanea este código para abrir el menú digital.</p>
            <small>{publicUrl}</small>

            <button
              className="button primary full"
              onClick={() => window.print()}
            >
              Imprimir / guardar QR
            </button>

            <p className="qr-tip">
              El QR usará esta dirección. Para compartirlo fuera de tu
              dispositivo, primero publica la web y usa la URL pública.
            </p>
          </div>
        </div>
      )}

      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
