# Escuela de Artes · Demo de gestión

App web para una escuela de Modelaje, Costura y Cocina (niveles Básico, Intermedio y Avanzado). Reemplaza el Excel con un sistema de check-in, cobros, matrículas y reportes. Está diseñada primero para tablet y teléfono, con la interfaz en español de Puerto Rico.

Corre completa en el plan gratis de Cloudflare: **Pages** (frontend), **Pages Functions** (API) y **D1** (base de datos SQLite).

## Usuarios demo

| Usuario  | Contraseña   | Rol   | Nombre         |
|----------|--------------|-------|----------------|
| `admin`  | `Admin#2026` | admin | Administración |
| `staff`  | `Staff#2026` | staff | Carmen Rivera  |
| `staff2` | `Staff#2026` | staff | Luis Ortiz     |

Cambia estas contraseñas antes de usar la app con datos reales (pantalla **Usuarios**).

## Qué incluye

- **Check-in del día**: escoges la clase, tocas al estudiante, firma en pantalla (estudiante o encargado), escoges el método de pago (monto precargado) y confirmas la entrega de la banda. Son tres toques. Cada estudiante muestra si firmó, pagó y recibió banda, y se pone verde cuando completa todo. Si el pago o la banda quedan pendientes, se pueden completar después.
- **Inicio**: clases de hoy, asistentes, total cobrado por método y cobros de los últimos 7 días.
- **Estudiantes**: crear, editar, buscar, desactivar, encargados, matrículas e historial de asistencia y pagos (con la firma de cada día).
- **Cursos y matrículas**: programa, nivel, días, horario, precio por clase e instructor. Matricular y dar de baja.
- **Cuadre de caja**: totales del día por método y por staff, detalle de cada cobro, quién asistió sin pagar y comparación con el efectivo contado. Se puede imprimir con líneas de firma.
- **Reportes**: asistencia y pagos por rango de fechas y por curso. Exporta a CSV o Excel (.xlsx con varias hojas). El admin ve además la bitácora de auditoría.
- **Importar**: sube un Excel o CSV de estudiantes, asigna las columnas (se adivinan solas por el título), revisa la vista previa con errores y duplicados, y matricula a todos en un curso si quieres.
- **Usuarios** (solo admin) y botón **Resetear datos demo** (solo admin, con `DEMO_MODE = "true"`).

### Roles

- **Staff**: check-in, cobros, estudiantes, matrículas, cuadre, reportes e importación.
- **Admin**: todo lo anterior, más cursos, usuarios, anular pagos o check-ins, borrar registros, auditoría y reseteo del demo.

## Seguridad

- Contraseñas con PBKDF2-SHA256 (Web Crypto), salt único por usuario y 100,000 iteraciones (el máximo que permite Workers).
- Sesión en cookie `HttpOnly; Secure; SameSite=Strict` de 12 horas. En la base solo se guarda el hash SHA-256 del token.
- Rate limit de login: 5 intentos fallidos en 15 minutos por usuario y 20 por IP. Las tablets de una escuela suelen compartir la misma IP, por eso el límite por IP es más alto.
- Validación de todos los datos en el servidor y consultas parametrizadas en todo el código.
- Las acciones que cambian datos se rechazan si vienen de otro origen (además de SameSite).
- Headers: CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS y `Referrer-Policy`.
- Las páginas internas redirigen a `/login` si no hay sesión.
- Auditoría: logins (buenos y fallidos), check-ins, cobros, anulaciones y cambios a estudiantes, cursos y usuarios, con usuario, IP y hora.
- El CSV exportado neutraliza fórmulas (`=`, `+`, `-`, `@`) para evitar inyección en Excel.

## Estructura

```
escuela-demo/
├── wrangler.toml              # Configuración de Pages + binding D1 "DB"
├── migrations/0001_init.sql   # Esquema completo
├── functions/
│   ├── _middleware.js         # Headers de seguridad, Origin y protección de páginas
│   └── api/[[path]].js        # Punto de entrada de la API
├── src/
│   ├── api.js router.js http.js validate.js crypto.js auth.js audit.js time.js png.js
│   ├── seed.js                # Datos demo (se usa desde Node y desde el botón de reset)
│   └── routes/                # auth, users, checkin, students, courses, import, dashboard, reports, admin
├── public/                    # HTML + Tailwind (CDN) + Alpine.js
│   └── assets/                # app.js, app.css, signature.js
├── scripts/
│   ├── seed.mjs               # Genera seed/seed.sql
│   └── create-user.mjs        # Crea un usuario sin datos demo
└── tests/
    ├── api.test.mjs           # Pruebas de la API (node:test)
    └── ui-smoke.mjs           # Recorre todas las pantallas en tablet y teléfono (Playwright)
```

Detalles del modelo de datos:

- El dinero se guarda en centavos (enteros) para evitar errores de redondeo.
- Las fechas de clase usan la hora de Puerto Rico (AST, UTC-4, sin cambio de horario).
- Las sesiones de clase de hoy se crean solas según los días de cada curso.
- Un pago por asistencia y una banda por asistencia (restricción `UNIQUE`). Si dos tablets confirman al mismo tiempo, no se cobra doble.
- El color de la banda rota cada día (ej. `Azul-1118`), así no sirve la banda de ayer.

## Correr en tu computadora

Necesitas Node.js 20 o más nuevo.

```bash
npm install
```

```bash
npm run setup:local
```

```bash
npm run dev
```

Abre http://localhost:8788 y entra con `admin` / `Admin#2026`.

`setup:local` aplica las migraciones a una base D1 local (en `.wrangler/`) y carga los datos demo: 30 estudiantes, 5 cursos y 2 semanas de clases con asistencia, firmas, pagos y bandas. Los horarios se acomodan para que siempre haya clases "hoy".

### Pruebas

Con `npm run dev` corriendo en otra terminal:

```bash
npm test
```

```bash
npm run test:ui
```

`npm test` corre las pruebas de la API (login, rate limit, permisos, check-in completo, cobro doble, validaciones, reportes e importación). Empieza reseteando los datos demo. `npm run test:ui` abre Chromium con Playwright, recorre las 8 pantallas en iPad y iPhone, hace un check-in completo y falla si hay errores de JavaScript o scroll horizontal. Las capturas quedan en `tests/screenshots/`. Necesita Playwright instalado (`npm i -D playwright` y `npx playwright install chromium`).

## Deploy en Cloudflare

### 1. Inicia sesión en Wrangler

```bash
npx wrangler login
```

### 2. Crea la base de datos D1

```bash
npx wrangler d1 create escuela-demo
```

Copia el `database_id` que te devuelve y ponlo en `wrangler.toml`, en lugar de `00000000-0000-0000-0000-000000000000`.

### 3. Aplica el esquema en la base remota

```bash
npm run db:migrate:remote
```

### 4. Carga los datos

Para el demo:

```bash
npm run seed:remote
```

Para producción, sin datos demo, crea solo tu admin:

```bash
npm run user:create -- tuusuario "Tu Nombre" admin "UnaClaveLarga2026" --remote
```

### 5. Crea el proyecto de Pages y publica

```bash
npx wrangler pages project create escuela-demo --production-branch main
```

```bash
npm run deploy
```

Wrangler lee `wrangler.toml` y conecta la base D1 (`DB`) y la variable `DEMO_MODE` al proyecto. Al terminar te da un URL `https://escuela-demo.pages.dev`.

Para publicar cambios después, solo corre `npm run deploy` otra vez. Si cambias el esquema, crea una migración nueva en `migrations/` y corre `npm run db:migrate:remote`.

### 6. Conecta tu dominio

1. En el dashboard de Cloudflare ve a **Workers & Pages → escuela-demo → Custom domains → Set up a custom domain**.
2. Escribe el dominio, por ejemplo `app.tuescuela.com`.
3. Si el dominio ya está en Cloudflare, el registro DNS se crea solo. Si el DNS está en otro proveedor, crea un **CNAME** de `app` hacia `escuela-demo.pages.dev`.
4. Espera a que el estado diga **Active**. El certificado SSL es automático.

Para usar el dominio raíz (`tuescuela.com` sin `app.`), el dominio tiene que estar administrado en Cloudflare, porque un CNAME en la raíz no funciona en la mayoría de los proveedores.

### Antes de usarlo con datos reales

- Pon `DEMO_MODE = "false"` en `wrangler.toml` y vuelve a publicar. Eso desactiva el botón de reset.
- Cambia o desactiva los usuarios demo.
- Haz backups de la base de vez en cuando:

```bash
npx wrangler d1 export escuela-demo --remote --output backup.sql
```

D1 también tiene **Time Travel**, que permite restaurar la base a cualquier momento de los últimos 30 días.

## Límites del plan gratis

- **D1**: 5 GB de almacenamiento, 5 millones de lecturas y 100,000 escrituras al día. Cada firma ocupa entre 5 y 20 KB, así que aguanta cientos de miles de check-ins.
- **Workers/Pages Functions**: 100,000 solicitudes al día y 10 ms de CPU por solicitud. El login usa PBKDF2 con 100,000 iteraciones, que está cerca de ese límite. Cloudflare suele permitir picos ocasionales, pero si alguna vez ves el error 1102 al entrar, tienes dos opciones: el plan Workers Paid ($5 al mes, 30 segundos de CPU) o bajar las iteraciones en `src/crypto.js`. Cada usuario guarda sus propias iteraciones, así que los hashes viejos siguen funcionando.

## Tecnología

- HTML + [Tailwind CSS v4](https://tailwindcss.com) (CDN) + [Alpine.js](https://alpinejs.dev) (CDN). No hay paso de build.
- [SheetJS](https://sheetjs.com) para leer y exportar Excel, cargado desde CDN solo en Importar y Reportes.
- Firma con `<canvas>` y pointer events (dedo, stylus o mouse), exportada a PNG en base64.
- API en JavaScript sobre Pages Functions con un router pequeño propio, sin dependencias de runtime.
