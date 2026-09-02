# Contexto para agentes

Este documento existe para que un agente que pierde el contexto de la conversación pueda retomar el sistema sin tener que re-explorar todo desde cero. Está escrito a partir de una revisión real del código al momento de escribirlo — no asumas que sigue siendo 100% exacto sin verificar, sobre todo si pasó tiempo: **este es un entorno de desarrollo compartido, hay más de una persona tocando el mismo repo y la misma base de datos al mismo tiempo.**

## 1. Qué es este sistema

**Auditoría de Ganancias** — sistema determinístico para controlar liquidaciones del Impuesto a las Ganancias de 4ta categoría a partir de Excels de liquidación de sueldos. Se carga un Excel de un legajo, el backend lee acumuladores y datos extra, aplica parámetros normativos, corre validaciones, y guarda un snapshot del análisis. El frontend muestra el resultado, memoria de cálculo, datos faltantes y guías de corrección.

Principio explícito del sistema, repetido en varios lugares del código y la documentación: **la IA (Gemini) solo redacta explicaciones sobre hallazgos ya detectados por el motor determinístico — nunca calcula, nunca decide un veredicto, nunca inventa datos.** Este principio se extendió durante esta sesión al diseño de la Suite de Calidad de QA (ver §6.5).

Sobre ese núcleo de negocio se construyó, en paralelo, un ecosistema grande de **herramientas de QA** (varias personas trabajando sobre distintas partes) que es hoy la mitad del código del repo.

## 2. Stack y arquitectura

```
backend-node/    NestJS + Mongoose + MongoDB — API en /api, puerto 8001
frontend-angular/  Angular (NgModules clásicos, no standalone) — puerto 4200
docs/            Documentación técnica (este archivo incluido)
outputs/         Capturas y reportes que dejan los runners de Playwright (servido por el backend en /api/outputs/)
```

Legado, no tocar salvo que se pida explícitamente: `backend/` (Python) y `frontend/` (React) pueden existir en checkouts históricos — no son el sistema activo.

- **Backend**: un solo `AppModule` plano (`backend-node/src/app.module.ts`), sin módulos por feature de Nest. Todo controller/service/schema se registra ahí a mano. Esto es una decisión del proyecto, no una omisión — seguí el mismo patrón al agregar algo nuevo.
- **Frontend**: un solo `AppModule` (`frontend-angular/src/app/app.module.ts`), escrito en una sola línea larga por archivo (imports y `@NgModule({...})` sin saltos de línea). Es el estilo real del proyecto, no lo reformatees.
- **Node**: `package.json` del backend declara `"engines": {"node": "18.14.x"}`, pero **`playwright-core` (usado por varios módulos de QA) exige Node 20+**. Con Node 18 el backend no levanta si algo importa `playwright-core` en el árbol de módulos activos. En esta máquina hay nvm con varias versiones; usar `~/.nvm/versions/node/v20.20.2/bin` para correr backend, scripts de Playwright y `ng build`/`ng serve`.

## 3. Autenticación

- Login simple por correo + contraseña. Usuarios en la colección `usuarios` (`correo`, `password_hash`).
- Hash: PBKDF2-SHA256, 210.000 iteraciones, formato `pbkdf2$<iteraciones>$<salt>$<hash>` (ver `backend-node/src/modules/auth/auth.crypto.ts`).
- Sesión: HMAC-SHA256 firmado, viaja en cookie **HttpOnly** (`auth.service.ts`, constante `COOKIE_SESION`). El frontend nunca guarda tokens en `localStorage`.
- `AuthGuard` (`backend-node/src/modules/auth/auth.guard.ts`) lee la cookie, verifica la firma, inyecta `request.usuario: { id, correo }`. Se aplica con `@UseGuards(AuthGuard)` a nivel de clase en casi todos los controllers.
- Usuario de pruebas usado en todos los runners de Playwright de este proyecto: `qa-local@auditoria.test` / `qa-local-123456` (configurable por `AUDITORIA_QA_CORREO`/`AUDITORIA_QA_PASSWORD`). Los runners hacen upsert de este usuario en `usuarios` al arrancar (`asegurarUsuario()`), así que nunca hace falta crearlo a mano.
- Selectores de login estables usados por todos los scripts de Playwright: `[data-testid="auth-email-input"]`, `[data-testid="auth-password-input"]`, `[data-testid="auth-submit-button"]`. Tras login exitoso, la app redirige a `/inicio`.

## 4. Motor de negocio (`backend-node/src/modules/motor-ganancias/`)

Núcleo determinístico de cálculo de retención. Piezas principales:

- `dominio.ts` — tipos centrales (`AcumuladorMensual`, `PapelTrabajoAsis`, `ConfigCliente`, etc.), usa `Decimal.js` para toda la aritmética (nunca `number` plano para montos).
- `motor-ganancias.service.ts` — orquestador del cálculo.
- `escala-art94.service.ts` — escala del art. 94 de la ley de Ganancias.
- `detector-sac.service.ts` — detección de SAC (aguinaldo).
- `validaciones.service.ts` / `catalogo-validaciones.service.ts` — catálogo de validaciones de negocio (V10_RETENCION, etc. — son las mismas validaciones que después consumen los datasets de QA).
- `snapshot.service.ts` — persiste el resultado del análisis en `analisis_snapshots`.
- `motor-referencia-ganancias.service.ts` — motor de referencia usado para paridad/comparación.

Flujo real: `POST /api/analisis/excel` (carga el Excel) → `AnalisisService` orquesta parseo (`SheetjsExcelService`, `ParserReporteExtendidoService`) → motor calcula → se guarda snapshot → frontend lo consulta por `GET /api/analisis/:id`.

## 5. API completa del backend (prefijo global `/api`)

| Controller | Base | Endpoints |
|---|---|---|
| `HealthController` | `/salud` | `GET` |
| `VersionController` | `/version` | `GET` |
| `AuthController` | `/auth` | `POST /login`, `GET /me`, `POST /logout` |
| `AnalisisController` | `/analisis` | `POST /excel`, `GET`, `GET /:id`, `GET /:id/json`, `POST /:id/explicacion-ia`, `POST /:id/contexto-complementario`, `DELETE /:id` |
| `DiagnosticosController` | `/diagnosticos` | `GET /resumen` |
| `ConfiguracionController` | `/configuracion` | `GET` |
| `QaCasosController` | `/qa/casos` | `GET`, `GET /fuentes`, `GET /:id`, `POST`, `POST /importar`, `DELETE /:id` |
| `QaRunnerController` | `/qa` | `POST /casos/:id/ejecutar`, `GET /ejecuciones/ultimas`, `GET /ejecuciones/:id`, `GET /ejecuciones/:id/capturas/:index` |
| `QaHallazgosController` | `/qa/hallazgos` | `GET`, `GET /:id`, `POST /:id/estado` |
| `QaDatasetsController` | `/qa/datasets` | `GET`, `GET /:codigo` |
| `QaDefinicionesTecnicasController` | `/qa/definiciones-tecnicas` | `GET`, `GET /:codigo/estado`, `GET /:codigo`, `POST` |
| `QaAsistenteController` | `/qa/asistente` | `GET /contexto`, `POST /mensajes`, `POST /planes`, `GET /planes/:id`, `POST /planes/:id/aprobar`, `POST /planes/:id/ejecutar` |
| `QaSopLoomController` | `/qa/sop-loom` | `POST /inspeccionar`, `GET /inspecciones/:id/captura`, `GET /aprendizajes`, `GET /aprendizajes/:id`, `POST /aprendizajes`, `POST /aprendizajes/:id/firmar/:tipo`, `POST /aprendizajes/:id/ejecutar`, `DELETE /aprendizajes/:id` |
| `QaReglasValidacionController` | `/qa/reglas-validacion` | `GET /catalogo`, `GET`, `POST`, `DELETE /:id` |
| `QaSuiteController` | `/qa/suite` | `GET /aprendizajes`, `POST /vista-previa`, `POST /corridas`, `GET /corridas`, `GET /corridas/:id` |

Todos menos `auth` llevan `AuthGuard`.

## 6. El módulo QA — mapa completo

Esto es lo más grande e importante de entender. Hay **múltiples sub-sistemas de QA independientes**, construidos en momentos distintos por distintas personas, que comparten el prefijo `qa/` pero **no comparten datos entre sí** salvo donde se documenta explícitamente.

### 6.1 Validación de negocio (`qa_casos` / `qa_ejecuciones` / `qa_hallazgos`)

El más viejo y el único que valida **cálculos de negocio reales** (no requisitos técnicos).

- `qa_casos` — casos de prueba con forma de negocio: `id`, `dataset_codigo`, `definicion_tecnica_codigo`, `periodo`, `contexto` (objeto libre, la forma depende de qué pantalla lo generó), `resultado_esperado`, `assertions`, `origen`, `activo` (soft-delete).
- Pantalla `/qa/casos` (`QaCasosComponent`) es una **tabla unificada** que agrega casos de *distintas pantallas de origen*. El catálogo de qué pantallas aportan casos y cómo mapear sus campos vive en `qa-catalogo-elementos.ts` (`fuente_casos` por pantalla — hoy solo Pantalla 1 y Pantalla 3 la declaran; Pantalla 1 es la única con `ejecutable: true`).
- Ejecutar un caso (`POST /api/qa/casos/:id/ejecutar`, solo Pantalla 1) dispara `scripts/run-qa-cases-playwright.mjs`: login → carga el Excel del caso → compara resultado calculado vs `resultado_esperado` con tolerancia. **Es el único runner que sí usa datos de negocio reales** — el resto de los runners de QA (Suite, SOP Loom) están diseñados para no depender de esto.
- Resultado va a `qa_ejecuciones` (`QaEjecucion`: `caso_id`, `modo: 'rapido'|'demo'`, `estado: 'corriendo'|'verde'|'rojo'`, stdout/stderr tail, capturas, evidencia rica con dataset/definición técnica/validaciones).
- De ahí se derivan `qa_hallazgos` (`QaHallazgo`: `caso_id`, `ejecucion_id`, `tipo: 'negocio'|'estructural'|'precondicion'|'entorno'`, `severidad: 'info'|'baja'|'media'|'alta'|'critica'`, `estado: 'abierto'|'resuelto'|'descartado'`, `propuesta`, `evidencia`). Es un ledger transversal — no es de una sola pantalla.

**Principio explícito y documentado en el código** (`qa-catalogo-elementos.ts` y `qa-sop-loom.service.ts`): *"El sistema tampoco inventa valores de prueba: los datos salen de los casos QA cargados en la pantalla correspondiente."* Esto aplica a la validación de **negocio**. No aplica a la Suite de Calidad (§6.5), donde se decidió a propósito lo contrario — ver por qué ahí.

### 6.2 Catálogo declarativo de pantallas (`qa-catalogo-elementos.ts`)

Fuente de verdad reusada por casi todo el resto del módulo QA. Por cada pantalla instrumentada declara: `campos` (`CampoCatalogo`: `clave`, `etiqueta`, `testid`, `tipo: 'texto'|'numero'|'fecha'|'archivo'|'select'`, `obligatorio`, `restriccion?`), `acciones` (`AccionCatalogo`), `selectores`, y opcionalmente `fuente_casos` (ver §6.1). `aplicarReglasCampos()` combina el default de fábrica de cada campo con lo que haya en `qa_reglas_validacion` (§6.3).

### 6.3 Reglas de validación (`qa_reglas_validacion`) — módulo de Franco

Ajustes manuales a las restricciones de un campo (`largo_exacto`, `valor_minimo/maximo`, `patron`, `dias_atras/adelante_max`), por pantalla puntual o global. No reemplaza el catálogo — lo pisa selectivamente. Pantalla `/qa/validaciones`.

### 6.4 SOP Loom — flujos aprendidos (`qa_sop_loom_aprendizajes`)

El sub-sistema más elaborado. Un "aprendizaje" es un flujo grabado en Loom, transcripto, compilado a pasos ejecutables por Playwright, y **aprobado por doble firma humana** (negocio + técnica) antes de poder ejecutarse.

Campos clave del documento `QaSopLoomAprendizaje`:
- `campos` — **nivel raíz del documento**, forma `{nombre, etiqueta, tipo, obligatorio, testid, restriccion?}` (`nombre`, no `clave` — distinto del `CampoCatalogo` del catálogo general; hay que mapear si se reusa en otro lado — ver §9, "gotcha" ya encontrado una vez).
- `definicion_ejecutable` — objeto compilado con `pasos_ejecutables` (`PasoEjecutable`: `tipo: 'navegar'|'completar'|'click'|'verificar'|'verificar_fila'`, `campo?`, `selector?`, `valor?`), `casos` (snapshot congelado de `qa_casos` en el momento de aprobar — **solo para la ejecución de negocio SOP Loom clásica**, no para la Suite), `rutas.pantalla_objetivo`.
- `estado: 'borrador'|'revisar'|'listo'|'aprobado'`. Solo `aprobado` es ejecutable.
- `aprobacion.hash_definicion` / `aprobacion.hash_navegacion` — hashes SHA-256 congelados al aprobar. `inspeccion_navegacion.hash` es el hash actual de lo que Playwright ve en vivo. **Antes de ejecutar cualquier cosa sobre un aprendizaje, hay que revalidar ambos hashes y volver a inspeccionar la pantalla real** — si algo cambió desde la aprobación, la ejecución se corta con el detalle de qué cambió (esto está en `qa-sop-loom.service.ts` `ejecutar()`, y se **reimplementó igual** para la Suite en `scripts/lib/qa-suite-comun.mjs` `validarNavegacionAprobada()` — no se debe saltear este chequeo nunca).
- Ejecución clásica (`POST /qa/sop-loom/aprendizajes/:id/ejecutar`) SÍ usa `casos` congelados de `qa_casos` (revalida que no cambiaron con `revalidarCasosCongelados`) → corre `scripts/run-qa-sop-loom-playwright.mjs`.

### 6.5 Suite de Calidad — Pantalla 4 (lo más nuevo, construido en esta sesión)

Corre pasadas automatizadas de **funcional / seguridad / accesibilidad** sobre aprendizajes de SOP Loom aprobados. Decisión de diseño central, discutida y confirmada explícitamente con el usuario: **no depende de `qa_casos` para nada, ni siquiera por debajo.** Los valores de prueba se derivan de las restricciones reales declaradas en `aprendizaje.campos` — nunca de datos de negocio. Esto es intencional y contrario al principio de §6.1 a propósito: la Suite no valida negocio, valida requisitos técnicos, y para eso el dato controlado es el método correcto.

**Módulo backend** (`backend-node/src/modules/qa/suite/`):
- `qa-suite-payloads.ts` + `qa-suite-derivador.service.ts` (`QaSuiteDerivadorService.derivarEscenarios(aprendizajeId, pasos, campos, categoria)`) — motor determinístico. Estrategia "una variable a la vez": cada escenario varía un solo campo (con un candidato por restricción/payload) y completa el resto con un valor funcional seguro, para que el flujo pueda avanzar. Mismo aprendizaje + misma categoría → mismos escenarios, siempre (hay tests que lo verifican).
  - `funcional`: valores VÁLIDOS en los bordes de la restricción real (`largo_exacto`, `valor_minimo/maximo`, `dias_atras/adelante_max`). Si no hay restricción declarada, usa un valor típico razonable.
  - `seguridad`: valores que violan la restricción a propósito + payloads de inyección (SQLi, NoSQLi, XSS, path traversal, template injection).
  - `accesibilidad`: un único escenario con los valores "seguros" de funcional en todos los campos — no varía nada, solo necesita llegar al estado para auditar.
- **Espejo en JS plano** de ese motor en `backend-node/scripts/lib/qa-suite-derivador.mjs` — los scripts de Playwright no importan TypeScript compilado, son procesos Node autónomos (mismo patrón que el resto del proyecto). **Si se cambia el algoritmo en el `.service.ts`, hay que replicarlo a mano en el `.mjs`** — no hay una sola fuente de verdad, es una duplicación deliberada.
- `qa-suite-runner.service.ts` — orquesta: valida el gate heredado de SOP Loom (aprobado + hashes + revalidación en vivo, **sin** `revalidarCasosCongelados`), spawnea el script de la categoría, parsea su stdout/evidencia, arma hallazgos y el informe consolidado de la corrida.
- Scripts: `run-qa-suite-funcional.mjs`, `run-qa-suite-seguridad.mjs` (implementa 2 de 7 frentes de seguridad diseñados: sesión sin cookie, e inyección+verificación de sanitización interceptando la red saliente — los otros 5 —IDOR, manipulación de parámetros de negocio, exposición de datos, carga de archivos, cabeceras de transporte— quedaron documentados como pendientes en el propio archivo, no implementados a medias), `run-qa-suite-accesibilidad.mjs` (audita con **axe-core** — WCAG 2.0/2.1 A/AA — inyectado de cero para este módulo, no reutiliza nada de código previo).
- Helper compartido `scripts/lib/qa-suite-comun.mjs`: login, conexión Mongo, `cargarAprendizaje()` (valida hashes), `validarNavegacionAprobada()`, `ejecutarPaso()` (adaptado del ejecutor de pasos de SOP Loom, sin `caso` — `verificar_fila` se reporta `omitido` porque depende de un caso QA que la Suite no usa), `mapearCampos()` (adapta `{nombre,...}` de `doc.campos` a la forma `{clave,...}` que espera el derivador — **este mapeo existe porque en algún momento se leyó mal la ubicación real de los campos; ver §9**).

**Colecciones propias** (todas nuevas, ninguna comparte schema con lo viejo):
- `qa_suite_ejecuciones` — una corrida de una categoría sobre un aprendizaje. `aprendizaje_id`, `categoria: 'funcional'|'seguridad'|'accesibilidad'`, `modo: 'rapido'|'demo'`, `estado`.
- `qa_suite_hallazgos` — **colección separada de `qa_hallazgos`**, a propósito (decisión explícita del usuario: no tocar el ledger de negocio existente). Misma forma que `QaHallazgo` pero con `aprendizaje_id` en vez de `caso_id`, y `categoria_prueba` obligatoria.
- `qa_suite_corridas` — agrupa N ejecuciones (aprendizajes × categorías) de una corrida disparada junto. `estado_consolidado: 'corriendo'|'verde'|'amarillo'|'rojo'` (rojo si hay hallazgo alta/crítica, amarillo si hay hallazgos pero ninguno grave, verde si no hay nada). `informe.por_aprendizaje[id]` trae ficha, semáforo, tabla por categoría, hallazgos priorizados, evidencia, comparación contra la corrida anterior sobre el mismo aprendizaje.

**Frontend**: `QaPantalla4Component` (`frontend-angular/src/app/pages/qa-pantalla-4/`), servicio `qa-suite.service.ts`. Flujo de la UI: elegir aprendizajes aprobados + categorías + modo → botón "Correr suite" abre un **modal de vista previa** (`QaSuiteVistaPreviaDialogComponent`, mismo archivo) que llama a `POST /qa/suite/vista-previa` para mostrar exactamente qué valor se va a escribir en cada campo y por qué, **antes** de correr nada — el usuario confirma recién ahí. Después: matriz de resultados (aprendizajes × categorías, mismo estilo de estado-pill que `/qa/casos`) → informe por corrida.

**Estado real al momento de escribir esto**: 8 aprendizajes de `qa_sop_loom_aprendizajes` en la base (`QA - Pantalla 3`, distintas versiones — alguien más los está iterando en paralelo), 0 corridas de Suite ejecutadas todavía de punta a punta contra un aprendizaje real por un humano (sí se verificó manualmente con curl/JS que el motor deriva bien).

### 6.6 Otros módulos de QA, menores

- `qa-datasets` — **usa una base de Mongo completamente distinta** (ver §7, es la trampa más importante de todo el documento).
- `qa-definiciones-tecnicas`, `qa-asistente` (chat con Gemini + planes), `qa-correccion-asistida`, `qa-pantalla-inspector` (usado por SOP Loom para inspeccionar pantallas).

### 6.7 Pantalla 2 — ELIMINADA, no reintroducir sin que se pida

Existió un módulo "Spider" (catálogo de niveles/payloads de fuzzing, generador de casos desde spec de Codegen, `qa_spider_casos`) montado sobre Pantalla 2. **Se borró por completo a pedido explícito del usuario** (backend `casos/`, `catalogo/`, `generador/`, scripts `run-qa-spider.mjs` y su lib, frontend `pages/qa-pantalla-2/`, sus 3 services, ruta y link de sidebar). La colección `qa_spider_casos` puede seguir existiendo vacía en Mongo (no se borró el dato, solo el código). **Si en algún momento aparece código o una referencia a "spider", "qa-catalogo/qa-catalogo.controller", "qa-spec-generador" o similar, es un resto que hay que borrar, no reactivar.**

## 7. Base de datos — TRAMPA IMPORTANTE

**Hay dos bases de Mongo distintas en juego, y confundirlas ya causó un bug real (la pantalla de datasets de Pantalla 1 aparecía vacía sin ningún error):**

1. **`MONGODB_URI`** — la base principal. **Hoy apunta a un clúster de MongoDB Atlas** (`mongodb+srv://...@cluster0.e5jpf.mongodb.net/auditoria_ganancias`), no a un Mongo local. Cambió de local a Atlas en algún punto de esta sesión sin aviso — **siempre confirmar el valor actual de `backend-node/.env` antes de asumir dónde están los datos.**
2. **`QA_DATASETS_MONGODB_URI`** (o `DATASETS_MONGODB_URI`) — usada solo por `QaDatasetsService`, con su propia conexión Mongoose independiente (`createConnection`, no la conexión global de Nest). Si no está seteada, cae a `mongodb://127.0.0.1:27017/qa_agentico_esueldos` (un Mongo **local**, base de **otro proyecto** que corre en la misma máquina) — completamente desconectado de `MONGODB_URI`. Esto es a propósito según el código pero nunca se pobló con datos de este proyecto.

Además: hay un `mongod` **nativo** corriendo como servicio del sistema (`systemctl`, PID típico visible con `ps aux | grep mongod`) escuchando en `127.0.0.1:27017` — no es un contenedor Docker, aunque el proyecto también tiene `docker-compose.mongodb.yml` con un contenedor `auditoria-ganancias-mongodb` que puede estar detenido sin que nadie lo note, mientras el nativo responde igual en el mismo puerto.

**Antes de diagnosticar "no aparecen datos" o "el catálogo está vacío": preguntate primero contra qué base te estás conectando vos (con tus scripts de chequeo) y contra cuál el backend real que corre en :8001.** No son necesariamente la misma.

### Colecciones activas (confirmadas en código)

| Colección | Dueño | Notas |
|---|---|---|
| `usuarios` | Auth | `correo`, `password_hash` |
| `analisis_snapshots`, `archivos_procesados`, `clientes`, `legajos`, `parametros_normativos` | Motor de negocio | |
| `qa_casos`, `qa_ejecuciones`, `qa_hallazgos` | Validación de negocio (§6.1) | |
| `qa_definiciones_tecnicas`, `qa_planes_asistente`, `qa_inspecciones_pantalla` | Menores | |
| `qa_reglas_validacion` | Franco (§6.3) | |
| `qa_sop_loom_aprendizajes` | SOP Loom (§6.4) | 8 documentos reales al momento de escribir esto |
| `qa_suite_ejecuciones`, `qa_suite_hallazgos`, `qa_suite_corridas` | Suite de Calidad (§6.5) | nuevas, sin corridas reales todavía |
| `qa_spider_casos` | **huérfana**, Pantalla 2 eliminada | sin schema activo; puede seguir en la base, vacía |
| `datasets` (en `qa_agentico_esueldos`, otro Mongo) | `qa-datasets` | ver trampa arriba |

## 8. Frontend — pantallas y rutas

Rutas reales (`app-routing.module.ts`), todas con `AuthGuard` salvo `/login`:

| Ruta | Componente | Qué es |
|---|---|---|
| `/inicio`, `/cargar-excel`, `/analisis`, `/analisis/:id`, `/analisis/:id/datos-complementarios`, `/calculo`, `/calculo/:id`, `/diagnosticos`, `/diagnosticos/:id`, `/historial`, `/configuracion` | — | Flujo de negocio principal |
| `/qa/asistente` | `QaAsistenteComponent` | Chat QA con Gemini |
| `/qa/pantalla-1` | `QaPantalla1Component` | Alta de caso QA de retención (fuente_casos, ejecutable) |
| `/qa/pantalla-3` | `QaPantalla3Component` | Alta básica de cliente (fuente_casos, no ejecutable) |
| `/qa/pantalla-4` | `QaPantalla4Component` | **Suite de Calidad** (§6.5) |
| `/qa/sop-loom` | `QaSopLoomComponent` | Aprendizajes SOP Loom (§6.4) |
| `/qa/casos` | `QaCasosComponent` | Tabla unificada de casos QA (§6.1) |
| `/qa/validaciones` | `QaReglasValidacionComponent` | Reglas de validación (§6.3) |

No existe `/qa/pantalla-2` (eliminada, redirige a `/inicio` por el wildcard).

El sidebar (`shared/components/layout/layout.component.ts`) tiene un submenú "QA" plegable con estos mismos links. **Este archivo lo edita más de una persona en paralelo** — ya cambió el texto de un link ("Pantalla 4" → "Suite de QA") sin que nadie de este lado lo pidiera. Verificar contenido real antes de asumir el texto exacto de un label.

### Convenciones de componentes del frontend

- **Un componente grande por pantalla** (template + estilos inline en el mismo archivo `@Component`), no muchos componentes chicos — así están hechos `qa-casos.component.ts` (~990 líneas), `qa-sop-loom.component.ts`, y así se hizo `qa-pantalla-4.component.ts`. Es el patrón real del proyecto.
- Diálogos modales: un segundo `@Component` en el mismo archivo del componente que lo abre (ver `ConfirmarLogoutDialogComponent` en `layout.component.ts`, y `QaSuiteVistaPreviaDialogComponent` en `qa-pantalla-4.component.ts`).
- Paleta y tokens visuales reales (sacados de `styles.css` y los componentes existentes, no inventados): fuente `Inter, ui-sans-serif, system-ui...`; fondo `#f8fafc`; texto `#0f172a`/`#0f1b3d`; acento `#2563eb`; borde de card `#dbe3f0`, radio `14px`, sombra `0 8px 24px rgba(15,27,61,.05)`; estado-pill: verde `#dcfce7`/`#166534`, rojo `#fee2e2`/`#991b1b`, corriendo `#eff6ff`/`#1d4ed8`, sin-correr `#f1f5f9`/`#64748b`; tema Material `indigo-pink` prebuilt.
- No usar emoji ni glifos dingbat en la UI — íconos siempre `mat-icon` o SVG inline.

## 9. Gotchas ya encontrados en esta sesión (para no repetirlos)

1. **Dos ubicaciones distintas para "campos de un aprendizaje"**: `definicion_ejecutable.campos` **no existe** — el catálogo de campos vive en `doc.campos` (nivel raíz), con forma `{nombre, ...}` no `{clave, ...}`. Causó que la vista previa de la Suite mostrara "no hay campos" sin ningún error. Ya arreglado con `mapearCampos()`, pero si se toca este código de nuevo, verificar contra un documento real de `qa_sop_loom_aprendizajes` antes de asumir la forma.
2. **El dev server de Angula (`ng serve`) puede quedar con el compilador incremental de Webpack inconsistente** si se borran archivos y se edita el módulo que los importa casi al mismo tiempo — muestra "Errors while compiling. Reload prevented." referenciando un import que ya no existe en disco. Solución: matar el proceso y relanzar `npm start` desde cero (no alcanza con recargar el navegador). Además, `read_console_messages` del navegador acumula el historial completo de la pestaña — para descartar errores viejos, cerrar la pestaña y abrir una nueva, no solo navegar.
3. **`nest start --watch` puede quedar sirviendo un build viejo** (`dist/src/main.js` en vez de `dist/main.js`) si alguna vez se corrió un `tsc` suelto sin pasar por `tsconfig.build.json` — ese `tsc` pelado arrastra `scripts/*.ts` y cambia el `rootDir` inferido. Ya se agregó `"include": ["src/**/*.ts"]` a `tsconfig.json` para que no vuelva a pasar, pero si un endpoint nuevo da 404 sin explicación, verificar qué archivo `dist/` está sirviendo realmente el proceso (`ps` + `readlink /proc/<pid>/cwd` + mirar si el controller nuevo aparece en el `dist/app.module.js` que se está ejecutando).
4. **Actividad en paralelo de otras personas en el mismo repo y la misma base Atlas es constante** — aparecieron aprendizajes nuevos, se vació `qa_spider_casos`, cambió texto del sidebar, sin que nadie de este lado lo hiciera. No asumas que el estado que viste hace 10 minutos sigue igual; volvé a consultarlo.
5. **`AuthGuard` de este proyecto es cookie HttpOnly + HMAC propio** — nada de JWT de librería externa. Cualquier script de Playwright nuevo tiene que loguearse por la UI real (no hay forma de generar la cookie a mano sin el secreto del servidor).

## 10. Cómo levantar el entorno local

```bash
# Backend (necesita Node 20 por playwright-core)
cd backend-node
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run start:dev      # nest start --watch, puerto 8001

# Frontend
cd frontend-angular
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm start              # ng serve, puerto 4200
```

Hay un `start.sh` en la raíz que intenta automatizar Mongo (Docker) + backend + frontend juntos, pero asume Mongo local en Docker — **no refleja que `MONGODB_URI` hoy apunta a Atlas**. Revisarlo/ajustarlo antes de confiar en él ciegamente.

Verificar antes de dar por sentado que algo "no anda": `curl http://localhost:8001/api/salud` (backend vivo) y que el `.env` tenga `MONGODB_URI` seteado a donde realmente se quiere trabajar.

## 11. Ramas de git

- `main` — tiene el trabajo del Spider/Pantalla 2 ya commiteado (commit `4910219`) sobre el merge viejo de `franco` (`1f47268`). Pantalla 2 sigue existiendo ahí en el código — la eliminación de esta sesión pasó en `integracion-franco`, no se propagó a `main` todavía.
- `franco` — rama de Franco, con su propio trabajo (`qa-reglas-validacion`, ajustes a `qa-sop-loom`/`qa-casos`/`qa-catalogo-elementos`).
- `octa` — rama vieja, desconectada, con una versión completamente distinta de "Pantalla 2" (dashboard "Gobernanza QA": datasets, regresión, revisión manual — nada que ver con lo demás). **No mezclar con las otras sin pensarlo mucho** — se separó muy atrás en la historia y comparte poco.
- `integracion-franco` — **rama activa de trabajo**, creada a partir de `main` + merge de `franco` resuelto a mano, y donde se hizo toda la Suite de Calidad y la eliminación de Pantalla 2. Es la rama más al día del código real.

Antes de mergear o comparar ramas, siempre chequear `git log --oneline --all --graph --decorate` en vez de asumir de memoria — el árbol es más enredado de lo que parece a primera vista.
