# Runway Center · Sistema de recepción y cobros

App web para **Runway Center**, Centro de Creatividad y Desarrollo de Talentos (Modelaje, Costura y Cocina; niveles Básico, Intermedio y Avanzado). Reemplaza el Excel con un sistema de check-in, cobros, matrículas y reportes. Está diseñada primero para tablet y teléfono, con la interfaz en español de Puerto Rico.

Corre completa en el plan gratis de Cloudflare: un **Worker** con archivos estáticos (pantallas y API) y **D1** (base de datos SQLite).

## Marca

- Logo en `public/brand/` (`logo.webp` completo y `rc.webp` solo las letras), con fondo transparente.
- Colores: negro `#141414` para botones y barra superior, dorado `#d4a62a` para resaltar y dorado oscuro `#8c6d15` para texto y enlaces (cumple contraste AA sobre blanco). Se cambian en `public/assets/app.css` (`:root`).
- Letras: Montserrat para títulos e Inter para el texto.
- Íconos de la tablet y del navegador: `public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` y `favicon.png`.

## Usuarios demo

| Usuario  | Contraseña   | Rol   | Nombre         |
|----------|--------------|-------|----------------|
| `admin`  | `Admin#2026` | admin | Administración |
| `staff`  | `Staff#2026` | staff | Carmen Rivera  |
| `staff2` | `Staff#2026` | staff | Luis Ortiz     |

Cambia estas contraseñas antes de usar la app con datos reales (pantalla **Usuarios**).

## Qué incluye

- **Recepción** (la única pantalla del staff, hecha para gente que no sabe de computadoras):
  1. La pantalla dice en grande **"Pase la chapita"**.
  2. El estudiante pasa la chapita y sale su **foto, nombre, clase y precio**, con avisos en rojo si **debe** algo y en verde si tiene **saldo a favor**.
  3. Un toque cobra: **Efectivo**, **ATH Móvil** o **Tarjeta**. El monto se puede cambiar, y se puede **cobrar también lo que debe**. Si no tiene dinero, **Paga después** y la clase queda como deuda.
  4. Pantalla verde (o amarilla si quedó debiendo): **"Entrégale la banda ROSA"**. Vuelve sola al inicio.
  - **Olvidó la chapita**: se busca por nombre.
  - **Otro cobro**: examen, matrícula, pagar deuda, pago adelantado u otro. Se puede cobrar en el momento o dejar como deuda.
  - Si el estudiante no tiene clase ese día, igual se le puede cobrar una deuda, un examen o la matrícula.
  - Los errores salen en palabras simples (*"Esta chapita no está registrada. Llama a la administración."*).
  - Se puede añadir a la pantalla de inicio de la tablet como una app, y la sesión se queda abierta 30 días.
- **Cuenta de cada estudiante**: cargos (clases, examen, matrícula, otros) y pagos. Lo que sobra de un pago queda como **saldo a favor** y paga solo las próximas clases (pago adelantado). Cada curso tiene precio por clase, costo de examen y costo de matrícula; al matricular a alguien se le carga la matrícula.
- **Asistencia del día** (admin): lista por clase con quién llegó, pagó y recibió banda.
- **Lista imprimible por clase**: hoja con los matriculados y columnas de hora, firma y pago, para la administración que quiere mantener la firma en papel. Se imprime desde Asistencia (con la fecha de esa clase) o desde Cursos (con la fecha en blanco).
- **Inicio**: clases de hoy, asistentes, total cobrado por método, total por cobrar y cobros de los últimos 7 días.
- **Estudiantes**: crear, editar, buscar, desactivar, encargados, matrículas e pestaña **Cuenta** (añadir cargo, recibir pago, anular), asistencia. Cada ficha tiene **foto** (se toma con la cámara de la tablet) y botones para **asignar, cambiar o quitar la chapita**.
- **Cursos y matrículas**: programa, nivel, días, horario, precio por clase, costo de examen, costo de matrícula e instructor. Matricular y dar de baja.
- **Cuadre de caja**: totales del día por método y por staff, detalle de cada cobro, en qué se aplicó (clase, examen, matrícula, saldo a favor), quién quedó debiendo y comparación con el efectivo contado. Se puede imprimir con líneas de firma.
- **Reportes**: asistencia, pagos, resumen por curso (facturado, cobrado y pendiente) y **Deudas** (quién debe y quién tiene saldo a favor). Exporta a CSV o Excel (.xlsx con varias hojas). El admin ve además la bitácora de auditoría.
- **Importar**: sube un Excel o CSV de estudiantes, asigna las columnas (se adivinan solas por el título), revisa la vista previa con errores y duplicados, y matricula a todos en un curso si quieres.
- **Usuarios** (solo admin) y botón **Resetear datos demo** (solo admin, con `DEMO_MODE = "true"`).

### Roles

- **Staff**: solo ve **Recepción** (y la lista imprimible). Cualquier otra página lo devuelve a Recepción.
- **Admin**: todo: Recepción, estudiantes, chapitas, fotos, cursos, cuadre, reportes, importación, usuarios, anulaciones, auditoría y reseteo del demo.

## Lectores de chapitas NFC

La app funciona con dos tipos de lector:

| Tablet | Qué se necesita | Cómo se usa |
|---|---|---|
| **Android con NFC** (en Chrome) | Nada adicional | En Recepción se toca **Activar lector** una vez y se acerca la chapita a la parte de atrás de la tablet. |
| **iPad** (no tiene NFC) o computadora | Lector NFC USB que funcione **"como teclado"** (keyboard emulation / HID), compatible con chapitas de 13.56 MHz (NTAG/MIFARE) | Se conecta y listo. La chapita se pasa por encima del lector. |

En el lector USB conviene que esté configurado para escribir el número y un **Enter** al final, que es lo normal en estos lectores. La app distingue la chapita de una persona escribiendo por la velocidad.

Hay que usar el mismo tipo de lector para asignar las chapitas y para el check-in. Algunos lectores USB escriben el número en otro formato que el NFC de Android, así que una chapita asignada con un tipo de lector puede no reconocerse con el otro.

## Seguridad

- Contraseñas con PBKDF2-SHA256 (Web Crypto), salt único por usuario y 100,000 iteraciones (el máximo que permite Workers).
- Sesión en cookie `HttpOnly; Secure; SameSite=Strict` de 12 horas, o 30 días si se marca **Mantener abierta en esta tablet**. En la base solo se guarda el hash SHA-256 del token.
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
├── wrangler.toml              # Configuración del Worker, archivos de public/ y binding D1 "DB"
├── migrations/0001_init.sql   # Esquema completo
├── src/
│   ├── worker.js              # Punto de entrada: /api/* va a la API, lo demás a public/
│   ├── middleware.js          # Headers de seguridad, Origin y protección de páginas
│   ├── api.js router.js http.js validate.js crypto.js auth.js audit.js time.js
│   ├── ledger.js              # Cuenta del estudiante: cargos, pagos y saldo a favor
│   ├── seed.js                # Datos demo (se usa desde Node y desde el botón de reset)
│   └── routes/                # auth, users, checkin, account, students, courses, import, dashboard, reports, admin
├── public/                    # HTML + Tailwind (CDN) + Alpine.js
│   └── assets/                # app.js, app.css, nfc.js
├── setup/consola-d1.sql       # Tablas + usuarios demo para pegar en la consola de D1
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
- Cada chapita tiene un número único de fábrica (UID). No hay que programarla: se asigna pasándola por el lector desde la ficha del estudiante. Una chapita solo puede pertenecer a un estudiante; si se pasa a otro, la app pide confirmación y se la quita al anterior.
- Si un estudiante tiene varias clases el mismo día, la chapita lo marca en la que está en curso o en la más cercana a la hora actual.
- Cada asistencia crea un **cargo** por el precio de la clase. Los **pagos** se reparten entre cargos (`payment_allocations`): primero el que se está cobrando y después los más viejos. Lo que sobra es **saldo a favor** y se aplica solo al próximo cargo.
- Cada pago lleva una referencia única del botón que lo generó. Si se toca dos veces o la red reintenta, no se cobra doble.
- Una banda por asistencia.
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

`setup:local` aplica las migraciones a una base D1 local (en `.wrangler/`) y carga los datos demo: 30 estudiantes, 5 cursos y 2 semanas de clases con asistencia, pagos y bandas. Todos tienen chapita de prueba menos 2 (para probar **Asignar chapita**). En modo demo, el check-in tiene un botón **Simular chapita** para probar sin lector. Los horarios se acomodan para que siempre haya clases "hoy".

### Pruebas

Con `npm run dev` corriendo en otra terminal:

```bash
npm test
```

```bash
npm run test:ui
```

`npm test` corre las pruebas de la API (login, rate limit, permisos, check-in completo, cobro doble, validaciones, reportes e importación). Empieza reseteando los datos demo. `npm run test:ui` abre Chromium con Playwright, recorre las 8 pantallas en iPad y iPhone, hace un check-in completo y falla si hay errores de JavaScript o scroll horizontal. Las capturas quedan en `tests/screenshots/`. Necesita Playwright instalado (`npm i -D playwright` y `npx playwright install chromium`).

## Deploy desde el navegador (sin instalar nada)

1. **Base de datos:** en el dashboard de Cloudflare ve a **Storage & Databases → D1 SQL Database → Create Database**, con el nombre `escuela-demo`. Copia el **Database ID**.
2. **Tablas y usuarios:** abre la pestaña **Console** de la base. Pega todo el contenido de [`setup/consola-d1.sql`](setup/consola-d1.sql) y presiona **Execute**. Ese archivo crea las tablas y los 3 usuarios demo. Se regenera con `npm run console-sql` si cambian las migraciones.
3. **ID en la configuración:** en GitHub edita `wrangler.toml` y pon tu ID en `database_id`.
4. **Worker:** ve a **Workers & Pages → Create application → Continue with GitHub**, escoge este repositorio y deja el **Deploy command** en `npx wrangler deploy`. Presiona **Deploy**. Cloudflare publica la rama `main` y vuelve a publicar sola cada vez que cambia.
5. **Datos demo:** entra con `admin` y presiona **Resetear datos demo** en Inicio.

Cada cambio que se suba a la rama se publica solo.

## Deploy con Wrangler (desde una computadora)

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

### 5. Publica el Worker

```bash
npm run deploy
```

Wrangler lee `wrangler.toml` y conecta la base D1 (`DB`), los archivos de `public/` y la variable `DEMO_MODE`. Al terminar te da un URL `https://escuela-demo.<tu-cuenta>.workers.dev`.

Para publicar cambios después, solo corre `npm run deploy` otra vez. Si cambias el esquema, crea una migración nueva en `migrations/` y corre `npm run db:migrate:remote`.

### 6. Conecta tu dominio

1. En el dashboard de Cloudflare ve a **Workers & Pages → escuela-demo → Settings → Domains & Routes → Add → Custom domain**.
2. Escribe el dominio, por ejemplo `app.tuescuela.com`.
3. El dominio tiene que estar administrado en Cloudflare (sus DNS apuntando a Cloudflare). El registro DNS y el certificado SSL se crean solos.
4. Espera a que el estado diga **Active**.

### Antes de usarlo con datos reales

- Pon `DEMO_MODE = "false"` en `wrangler.toml` y vuelve a publicar. Eso desactiva el botón de reset.
- Cambia o desactiva los usuarios demo.
- Haz backups de la base de vez en cuando:

```bash
npx wrangler d1 export escuela-demo --remote --output backup.sql
```

D1 también tiene **Time Travel**, que permite restaurar la base a cualquier momento de los últimos 30 días.

## Límites del plan gratis

- **Consultas por solicitud**: el plan gratis permite unas 50 consultas a D1 por solicitud. La app está hecha para quedarse por debajo: el reset del demo va en 3 pasos y la importación se envía en grupos de 40 estudiantes.

- **D1**: 5 GB de almacenamiento, 5 millones de lecturas y 100,000 escrituras al día. Cada foto ocupa unos 30 a 50 KB, así que caben miles de estudiantes con foto.
- **Workers**: 100,000 solicitudes al día y 10 ms de CPU por solicitud. El login usa PBKDF2 con 100,000 iteraciones, que está cerca de ese límite. Cloudflare suele permitir picos ocasionales, pero si alguna vez ves el error 1102 al entrar, tienes dos opciones: el plan Workers Paid ($5 al mes, 30 segundos de CPU) o bajar las iteraciones en `src/crypto.js`. Cada usuario guarda sus propias iteraciones, así que los hashes viejos siguen funcionando.

## Tecnología

- HTML + [Tailwind CSS v4](https://tailwindcss.com) (CDN) + [Alpine.js](https://alpinejs.dev) (CDN). No hay paso de build.
- [SheetJS](https://sheetjs.com) para leer y exportar Excel, cargado desde CDN solo en Importar y Reportes.
- Chapitas NFC con Web NFC (Android) o con lector USB tipo teclado (`public/assets/nfc.js`).
- API en JavaScript sobre Cloudflare Workers con un router pequeño propio, sin dependencias de runtime.
