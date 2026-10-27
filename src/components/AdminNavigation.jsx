import React, { memo } from 'react';
import { Package, ShoppingCart } from 'lucide-react';

function AdminNavigation({ section, navigate }) {
  return (
    <nav className="admin-nav" aria-label="Secciones de administración">
      <button className={section === 'menu' ? 'active' : ''} onClick={() => navigate('/admin')}>
        Bebidas y pedidos
      </button>
      <button className={section === 'sales' ? 'active' : ''} onClick={() => navigate('/admin/sales')}>
        <ShoppingCart size={15} /> Ventas rápidas
      </button>
      <button className={section === 'inventory' ? 'active' : ''} onClick={() => navigate('/admin/inventory')}>
        <Package size={15} /> Inventario
      </button>
    </nav>
  );
}

export default memo(AdminNavigation);
