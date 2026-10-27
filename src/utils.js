export const money = (value) =>
  new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 2
  }).format(Number(value || 0));

export const dragFileName = (name) =>
  `${String(name || 'bebida').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bebida'}.jpg`;

export function handleDrinkImageDrag(event, drink) {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/uri-list', drink.image_url);
  event.dataTransfer.setData('text/plain', drink.image_url);
  event.dataTransfer.setData(
    'DownloadURL',
    `image/jpeg:${dragFileName(drink.name)}:${drink.image_url}`
  );
}
