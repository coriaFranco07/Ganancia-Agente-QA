# Auditoria de Ganancias

Sistema de auditoria deterministica para controlar liquidaciones del Impuesto a
las Ganancias de 4ta categoria a partir de archivos Excel.

El sistema esta pensado para una empresa de liquidacion de sueldos: se carga un
Excel de un legajo, el backend lee acumuladores y datos extras, aplica
parametros normativos cargados, ejecuta los controles disponibles y guarda un
snapshot del analisis en MongoDB. El frontend muestra resultado, memoria de
calculo, datos faltantes y guias de correccion.

Importante: Gemini, si esta configurado, solo redacta explicaciones
accionables sobre hallazgos ya detectados por el motor. No calcula impuestos,
no cambia veredictos y no inventa datos.

## Arquitectura actual

```text
auditoria-ganancias/
  backend-node/       Backend principal NestJS + MongoDB
  frontend-angular/   Frontend principal Angular
  backend/            Backend Python legado, referencia/paridad
  frontend/           Frontend React legado, no usado para produccion nueva
  docs/               Documentacion tecnica y de aceptacion
  outputs/            Archivos de prueba generados localmente
```

Para despliegues nuevos usar:

- `backend-node/`
- `frontend-angular/`
- MongoDB

## Requisitos

- Node.js `18.14.x`.
- npm compatible con Node 18.
- MongoDB 6 o superior, local, Docker o Atlas.
- Git.
- Opcional para legado Python: Python 3.11+.

Verificar Node:

```powershell
node -v
npm -v
```

Si se usa `nvm`:

```powershell
nvm use 18.14.0
```

## Variables de entorno del backend

Crear `backend-node/.env` desde el ejemplo:

```powershell
cd backend-node
Copy-Item .env.example .env
```

Contenido base:

```env
PORT=8001
MONGODB_URI=mongodb://127.0.0.1:27017/auditoria_ganancias
MAX_UPLOAD_MB=20
TOLERANCIA_REDONDEO=0.05
NODE_ENV=development
JWT_SECRET=cambiar-por-una-clave-larga-de-32-caracteres-minimo
SESSION_HOURS=8

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
GEMINI_MODELOS=gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite
GEMINI_TIMEOUT_MS=45000
GEMINI_REINTENTOS=3
GEMINI_REINTENTO_BASE_MS=1200
```

No commitear `.env` ni claves reales.

`JWT_SECRET` se usa para firmar la cookie de sesion. En produccion debe ser una
clave larga, privada y distinta a la del ejemplo.

## Login y usuarios

El sistema usa login simple con correo y contrasena. Los usuarios se guardan en
MongoDB en la coleccion `usuarios`.

Importante:

- La contrasena real no se guarda.
- El backend guarda `password_hash`.
- El frontend no guarda claves ni tokens en `localStorage`.
- La sesion viaja en una cookie `HttpOnly`.

Crear o actualizar un usuario:

```powershell
cd backend-node
npm run usuario:crear -- --correo usuario@empresa.com
```

El script pide:

```text
Contrasena:
Confirmar contrasena:
```

Luego se ingresa desde el frontend con:

```text
http://localhost:4200/login
```

Endpoints publicos:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/health`
- `GET /api/version`

El resto de endpoints del sistema requiere sesion iniciada.

## Levantar MongoDB

### Opcion A: MongoDB local

Verificar si Mongo responde:

```powershell
mongosh "mongodb://127.0.0.1:27017/auditoria_ganancias" --eval "db.runCommand({ ping: 1 })"
```

URI:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/auditoria_ganancias
```

### Opcion B: Docker

Desde `backend-node/`:

```powershell
docker compose -f docker-compose.mongodb.yml up -d
```

Verificar:

```powershell
docker ps
docker logs auditoria-ganancias-mongodb
```

URI:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/auditoria_ganancias
```

### Opcion C: MongoDB Atlas

Usar la URI de Atlas en `backend-node/.env`:

```env
MONGODB_URI=mongodb+srv://USUARIO:CLAVE@cluster/DB?retryWrites=true&w=majority
```

Recomendaciones:

- No commitear credenciales.
- Usar variables protegidas en GitLab CI/CD.
- Restringir IPs permitidas en Atlas.
- Crear un usuario con permisos limitados a la base del proyecto.

## Levantar backend Node

```powershell
cd backend-node
nvm use 18.14.0
npm install
npm run build
npm run start:dev
```

El backend queda disponible en:

```text
http://localhost:8001/api
```

Endpoints principales:

- `POST /api/analisis/excel`: carga y analiza Excel.
- `GET /api/analisis`: historial.
- `GET /api/analisis/:id`: obtener analisis.
- `GET /api/analisis/:id/json`: descargar JSON.
- `DELETE /api/analisis/:id`: eliminacion logica del historial.
- `POST /api/analisis/:id/explicacion-ia`: explicacion accionable opcional.
- `GET /api/diagnosticos/resumen`: resumen diagnostico.

## Levantar frontend Angular

En otra terminal:

```powershell
cd frontend-angular
nvm use 18.14.0
npm install
npm start
```

Abrir:

```text
http://localhost:4200
```

En desarrollo Angular consume:

```text
http://localhost:8001/api
```

La configuracion esta en:

- `frontend-angular/src/environments/environment.ts`
- `frontend-angular/src/environments/environment.prod.ts`

En produccion `environment.prod.ts` usa:

```ts
apiUrl: '/api'
```

Por eso el deploy debe publicar Angular y enrutar `/api` al backend Node.

## Orden recomendado para levantar localmente

1. Levantar MongoDB.
2. Levantar backend Node en `http://localhost:8001/api`.
3. Levantar frontend Angular en `http://localhost:4200`.
4. Cargar un Excel desde la pantalla `Cargar Excel`.
5. Revisar `Analisis`, `Calculo`, `Diagnosticos` e `Historial`.

## Validaciones antes de subir o entregar

Backend:

```powershell
cd backend-node
nvm use 18.14.0
npm install
npm run build
npm run test
npm run test:golden
npm run test:mongo
```

Frontend:

```powershell
cd frontend-angular
nvm use 18.14.0
npm install
npm run build
```

QA Playwright:

```powershell
cd backend-node
$env:AUDITORIA_QA_EXCEL_DIR="C:\Users\Lenovo Ideapad\Downloads"
npm run qa:playwright
```

La guia completa esta en `docs/qa_playwright.md`.

Si hay Chrome disponible:

```powershell
npm run test
```

Python legado, solo si se quiere verificar paridad antigua:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
cd backend
..\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider
```

## Validar MongoDB real

Con `MONGODB_URI` configurada:

```powershell
cd backend-node
npm run test:mongo
```

Este test debe:

- conectarse a `MONGODB_URI`;
- crear un snapshot de prueba;
- leerlo;
- validar campos principales;
- eliminarlo;
- fallar claramente si MongoDB no esta disponible.

Nota: `npm run test:golden` ejecuta la paridad completa solo si existen los
fixtures privados en `backend-node/test/fixtures` y los golden privados en
`backend-node/test/golden`. Esos archivos no se versionan en GitHub porque
pueden contener datos de legajos. Si no estan presentes, esos casos se saltan.

Tambien se puede validar manualmente:

```powershell
mongosh "mongodb://127.0.0.1:27017/auditoria_ganancias"
show collections
db.analisis_snapshots.find().sort({fecha_analisis:-1}).limit(3)
```

## Probar carga por curl

Con backend levantado:

```powershell
curl.exe -X POST "http://localhost:8001/api/analisis/excel" `
  -F "archivo=@C:\ruta\al\archivo.xlsx"
```

Si el Excel requiere datos complementarios:

```powershell
curl.exe -X POST "http://localhost:8001/api/analisis/excel" `
  -F "archivo=@C:\ruta\al\archivo.xlsx" `
  -F "contexto={\"datos_cliente\":{\"modo_saldo_favor\":\"compensar\"}}"
```

## Datos extras esperados en Excel

El sistema puede leer una hoja o tabla de datos extras con claves tecnicas. Las
claves no deben humanizarse.

Claves usadas actualmente como datos complementarios influyentes:

```text
cliente_cuit
modalidad_sac
modo_saldo_favor
zona_geografica_default
legajo_numero
empleado_cuil
fecha_ingreso
fecha_egreso
zona_geografica
cargas_familia_conyuge
cargas_familia_cant_hijos
cargas_familia_otras
tiene_otros_empleadores
```

Formato recomendado:

| grupo | campo | valor |
|---|---|---|
| datos_cliente | cliente_cuit | 20205889522 |
| datos_cliente | modalidad_sac | devengado |
| datos_cliente | modo_saldo_favor | compensar |
| datos_legajo | legajo_numero | 53 |
| datos_legajo | cargas_familia_cant_hijos | 2 |

Regla importante: las columnas tecnicas como `campo`, `acumulador` y claves del
spec deben mantenerse en `snake_case`. Ejemplo correcto:

```text
deducciones_personales
ganancia_neta_fila35
retencion_practicada
doceava_parte_art30
```

No usar como clave tecnica:

```text
Deducciones Personales
Ganancia Neta
Retencion Practicada
```

Los nombres visibles en pantalla si pueden ser humanizados; las claves del Excel
no.

## Que guarda MongoDB

Coleccion principal:

```text
analisis_snapshots
```

Cada carga genera un snapshot con:

- metadata del archivo;
- cliente, legajo y periodo;
- resultado del motor;
- memoria de calculo;
- validaciones;
- datos faltantes;
- advertencias;
- JSON original del analisis.

La eliminacion desde la UI es logica: no borra el Excel original del equipo del
usuario.

## Build para produccion

Backend:

```powershell
cd backend-node
nvm use 18.14.0
npm ci
npm run build
npm run start
```

Frontend:

```powershell
cd frontend-angular
nvm use 18.14.0
npm ci
npm run build
```

Artefacto Angular:

```text
frontend-angular/dist/
```

El servidor web o proxy debe:

- servir el build de Angular;
- redirigir `/api` al backend Node;
- permitir uploads XLSX hasta `MAX_UPLOAD_MB`;
- mantener las variables secretas solo en backend.

Ejemplo conceptual de proxy:

```text
/       -> frontend Angular estatico
/api    -> backend Node http://backend-node:8001/api
```

## Checklist de entrega para GitLab/deploy

Antes de hacer el corte:

- [ ] `backend-node/.env.example` actualizado sin secretos.
- [ ] `frontend-angular/src/environments/environment.prod.ts` apunta a `/api`.
- [ ] MongoDB disponible y validado.
- [ ] `npm run build` del backend OK.
- [ ] `npm run test` del backend OK.
- [ ] `npm run test:golden` OK o salteado por falta de fixtures privados.
- [ ] `npm run test:mongo` OK en entorno con Mongo real.
- [ ] `npm run build` de Angular OK.
- [ ] Carga real de Excel desde Angular OK.
- [ ] Historial recupera snapshots desde MongoDB.
- [ ] Descarga JSON funciona.
- [ ] Eliminacion logica funciona.
- [ ] Gemini probado o explicitamente deshabilitado.
- [ ] No hay `.env` ni claves en Git.

## Comandos rapidos

Terminal 1:

```powershell
cd backend-node
npm run start:dev
```

Terminal 2:

```powershell
cd frontend-angular
npm start
```

Abrir:

```text
http://localhost:4200
```

## Alcance funcional actual

El backend:

- lee Excel de acumuladores;
- reconoce datos extras;
- detecta modalidad SAC;
- aplica escala Art. 94 parametrizada;
- aplica deducciones Art. 30 cargadas;
- calcula memoria de calculo;
- controla V disponibles segun datos reales;
- marca como pendiente/no evaluada una validacion si falta informacion;
- guarda historial en MongoDB;
- permite explicacion accionable con Gemini si hay clave.

El frontend:

- carga Excel;
- permite completar datos complementarios;
- muestra resultado;
- muestra memoria de calculo;
- muestra validaciones y errores explicados;
- muestra datos faltantes;
- muestra historial;
- descarga JSON;
- permite eliminacion logica.

## Limitaciones conocidas

- El sistema no debe inventar datos que no vengan del Excel o del contexto
  complementario.
- Algunas validaciones del spec quedan pendientes si el Excel no trae el dato
  necesario.
- Gemini es auxiliar de explicacion; el calculo siempre es del backend.
- Las tablas laterales/manuales usadas para pruebas no son fuente contractual
  del sistema.

## Documentacion adicional

- `docs/validacion_mongodb_local.md`
- `docs/acta_aceptacion_migracion.md`
- `backend/docs/alcance_mvp.md`
- `backend-node/README.md`
- `frontend-angular/README.md`
