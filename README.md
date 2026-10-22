# Halloween Party — Menú digital con MongoDB

Menú web responsive con estética Halloween (negro/rojo), precios en pesos dominicanos (RD$), QR, búsqueda, categorías y panel privado en `/admin`.

## Tecnologías
- Frontend: React + Vite.
- API: Node.js + Express.
- Base de datos: MongoDB Atlas + Mongoose.
- Acceso privado: JWT. Solo el correo y la contraseña configurados en el backend pueden entrar al panel.
- QR: se genera a partir de la URL pública del menú.

## Estructura
- `src/`: aplicación React.
- `backend/server.js`: API REST y conexión a MongoDB.
- `backend/.env.example`: variables de entorno para la API.
- `.env.example`: URL de la API para el frontend.

## 1. Requisitos
Instala Node.js LTS en tu Mac y crea una cuenta/proyecto en MongoDB Atlas.

## 2. Configura MongoDB Atlas
1. Crea un cluster gratuito en https://www.mongodb.com/atlas.
2. En **Database Access**, crea un usuario y una contraseña de base de datos. No uses tu contraseña de acceso a MongoDB Atlas.
3. En **Network Access**, autoriza la conexión de tu entorno de desarrollo. Para pruebas puedes añadir tu IP actual; evita abrir el acceso a todo internet salvo que lo necesites y entiendas el riesgo.
4. En **Connect > Drivers**, copia la cadena de conexión. Cambia `USUARIO`, `CONTRASENA` y el nombre de base de datos por los tuyos. Si tu contraseña contiene caracteres especiales, debes codificarlos para la URI.

## 3. Configura el backend
En Terminal, desde la carpeta raíz del proyecto:

```bash
cd backend
cp .env.example .env
npm install
```

Abre `backend/.env` y configura:

```env
PORT=4000
MONGODB_URI=mongodb+srv://USUARIO:CONTRASENA@cluster.mongodb.net/halloween_party?retryWrites=true&w=majority
JWT_SECRET=pon_aqui_un_secreto_largo_aleatorio
ADMIN_EMAIL=tu-correo@example.com
ADMIN_PASSWORD=una_contrasena_larga_y_unica
CLIENT_ORIGIN=http://localhost:5173
```

Usa una contraseña fuerte para el administrador y un valor largo, aleatorio y distinto para `JWT_SECRET`. No compartas el archivo `.env` ni lo subas a GitHub. La colección `drinks` se crea automáticamente al guardar la primera bebida.

## 4. Ejecuta la API
Dentro de `backend/`:

```bash
npm run dev
```

Deja esa Terminal abierta. La API se ejecuta en `http://localhost:4000`.

## 5. Ejecuta el frontend
Abre una segunda pestaña de Terminal y vuelve a la carpeta raíz del proyecto (la que contiene el `package.json` principal):

```bash
cp .env.example .env
npm install
npm run dev
```

En `.env`, la variable local debe ser:

```env
VITE_API_URL=http://localhost:4000
```

Abre la URL local que indique Vite, normalmente `http://localhost:5173`. El menú se abre en `/` y el panel privado en `http://localhost:5173/admin`. Usa el correo y la contraseña configurados en `backend/.env`.

## 6. Publicarlo para que funcione el QR desde cualquier celular
Necesitas publicar por separado el frontend y el backend:

1. Sube el proyecto a GitHub, sin subir ningún archivo `.env`.
2. Publica el servicio de `backend/` en un proveedor de Node.js como Render. Configura allí `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Usa el puerto que el proveedor asigne si lo requiere.
3. En `CLIENT_ORIGIN`, coloca el dominio exacto del frontend publicado, por ejemplo `https://tu-menu.vercel.app`.
4. Publica el frontend en Vercel. Como **Root Directory** selecciona la carpeta raíz del proyecto y configura `VITE_API_URL` con la URL pública de la API, por ejemplo `https://tu-api.onrender.com` (sin barra final).
5. Cuando terminen ambos despliegues, abre la web pública y pulsa **Ver QR**. Prueba el QR con otro teléfono antes de imprimirlo.

El archivo `vercel.json` permite que la ruta `/admin` cargue la aplicación al entrar directamente desde el navegador.

## API disponible
- `GET /api/health`: estado de la API.
- `GET /api/drinks`: lista pública de bebidas.
- `POST /api/auth/login`: inicia sesión y entrega un JWT.
- `POST /api/drinks`: crea una bebida (requiere JWT).
- `PUT /api/drinks/:id`: edita una bebida (requiere JWT).
- `PATCH /api/drinks/:id`: cambia disponibilidad (requiere JWT).
- `DELETE /api/drinks/:id`: elimina una bebida (requiere JWT).

## Seguridad
- El frontend nunca contiene credenciales de MongoDB.
- Todas las operaciones de escritura de bebidas requieren un JWT válido.
- No existe registro público: las credenciales del único administrador se definen en las variables privadas del backend.
- El token del panel vence a las 8 horas.
- No subas `.env` ni compartas las claves.

## Nota
El proyecto queda preparado para configurarse y probarse localmente. El QR local no será accesible desde los teléfonos de los invitados hasta publicar el frontend y usar su URL pública.
