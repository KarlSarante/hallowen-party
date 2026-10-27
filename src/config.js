export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
export const TOKEN_KEY = 'halloween_admin_token';

export const categories = [
  'Todas', 'Cócteles', 'Whisky', 'Ron', 'Vodka',
  'Cervezas', 'Vino', 'Sin alcohol', 'Otros'
];

export const orderStatuses = [
  'Pendiente',
  'Preparando',
  'Listo para entregar',
  'Entregado',
  'Cancelado'
];
