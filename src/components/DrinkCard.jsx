import React, { memo } from 'react';
import { Flame, Martini } from 'lucide-react';
import { handleDrinkImageDrag, money } from '../utils';

function DrinkCard({ drink, index, orderingEnabled, quantity, onQuantityChange }) {
  const stock = Number(drink.stock ?? 1);
  const soldOut = !drink.available || stock <= 0;
  const lowStock = !soldOut && stock <= Number(drink.minimumStock || 0);

  return (
    <article className={`drink-card ${soldOut ? 'unavailable' : ''}`}>
      <div className="drink-image">
        {drink.image_url ? (
          <img src={drink.image_url} alt={drink.name} loading="lazy" draggable="true"
            onDragStart={event => handleDrinkImageDrag(event, drink)}
            title="Arrastra para descargar en JPG" />
        ) : (
          <div className="image-placeholder">
            <Martini size={47} strokeWidth={1} />
            <span>HALLOWEEN<br />SPECIAL</span>
          </div>
        )}
        {drink.featured && <span className="featured-badge"><Flame size={13} /> DESTACADA</span>}
        {soldOut && <span className="sold-badge">AGOTADA</span>}
        <span className="card-index">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="drink-details">
        <div className="drink-category">{drink.category}</div>
        <h3>{drink.name}</h3>
        {drink.description && <p>{drink.description}</p>}
        <div className="drink-bottom">
          <strong>{money(drink.price)}</strong>
          <span className={soldOut ? 'status sold' : 'status'}>
            <i></i>{soldOut ? 'Agotada' : lowStock ? `Pocas unidades (${stock})` : 'Disponible'}
          </span>
        </div>
        {orderingEnabled && !soldOut && !String(drink.id).startsWith('demo') && (
          <div className="order-controls">
            <button type="button" className="icon-button" onClick={() => onQuantityChange(drink.id, -1)}
              aria-label={`Quitar ${drink.name}`}>−</button>
            <strong>{quantity || 0}</strong>
            <button type="button" className="icon-button" onClick={() => onQuantityChange(drink.id, 1)}
              disabled={quantity >= 50} aria-label={`Añadir ${drink.name}`}>+</button>
          </div>
        )}
      </div>
    </article>
  );
}

export default memo(DrinkCard);
