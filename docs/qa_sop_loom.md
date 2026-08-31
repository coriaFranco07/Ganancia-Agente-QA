# SOP Loom — de un texto de Loom a un agente que opera la pantalla

Módulo que convierte la narración de un video de Loom en una definición ejecutable,
la valida contra la pantalla real y la ejecuta con Playwright sobre casos QA reales.

Implementa el pipeline de ingesta de SPO descrito en el documento de arquitectura del
Sistema de QA Agéntico (§9), adaptado a este repo.

## Principio

Tres fuentes distintas, ninguna inventada por el sistema:

| Qué | De dónde sale | Marca de origen |
|---|---|---|
| Qué pasos y en qué orden | El texto del Loom | `fuente_paso: 'sop_loom'` |
| Con qué selectores | Navegación real del sandbox con Playwright | `origen.tipo: 'navegacion'` |
| Con qué datos | Casos QA cargados en la pantalla (a mano o por Excel) | `fuente_datos.tipo: 'casos_qa'` |

El sistema **no inventa selectores ni valores de prueba**. Si algo no se puede deducir,
queda como pendiente y bloquea la aprobación.

## Flujo completo

```
1. Pegar el texto de Loom        →  /qa/sop-loom
2. Aprender flujo                →  detecta pasos, ruta, objetivo, criterio, guardas
3. Inspeccionar pantalla         →  Playwright abre la ruta real y lee los data-testid
4. Guardar flujo                 →  compila la plantilla de pasos + congela los casos
5. Resolver guardas              →  una persona decide si cada precaución es testeable
6. Firmar técnica + negocio      →  dos firmas, cada una sobre su mitad
7. Ejecutar agente               →  una vuelta del plan por cada caso QA
```

## Piezas

| Archivo | Rol |
|---|---|
| `src/modules/qa/qa-pantalla-inspector.service.ts` | Navega la pantalla real, extrae el inventario de `data-testid`, hashea, guarda captura |
| `src/modules/qa/qa-catalogo-elementos.ts` | Semántica de negocio: claves, alias en castellano, obligatoriedad, fuente de casos. **No es autoridad de selectores.** |
| `src/modules/qa/qa-sop-loom.service.ts` | Compila el SOP contra la navegación, congela casos, gestiona firmas y ejecución |
| `scripts/run-qa-sop-loom-playwright.mjs` | Runner: revalida la pantalla y ejecuta el plan caso por caso |
| `src/modules/qa/schemas/qa-inspeccion-pantalla.schema.ts` | Colección `qa_inspecciones_pantalla` |
| `src/modules/qa/schemas/qa-sop-loom-aprendizaje.schema.ts` | Colección `qa_sop_loom_aprendizajes` |

## Endpoints

```http
POST   /api/qa/sop-loom/inspeccionar              { ruta }
GET    /api/qa/sop-loom/inspecciones/:id/captura
GET    /api/qa/sop-loom/aprendizajes
GET    /api/qa/sop-loom/aprendizajes/:id
POST   /api/qa/sop-loom/aprendizajes
POST   /api/qa/sop-loom/aprendizajes/:id/firmar/:tipo    tipo = negocio | tecnica
POST   /api/qa/sop-loom/aprendizajes/:id/ejecutar        { modo: demo | rapido }
DELETE /api/qa/sop-loom/aprendizajes/:id                 baja lógica
```

## Doble firma

Cada mitad se firma por separado y se hashea por separado, así un ajuste de selector
no obliga a molestar a consultoría (arquitectura §8).

| Firma | Quién | Cubre | Requisitos |
|---|---|---|---|
| `tecnica` | QA / desarrollo | ruta, selectores, pasos, inspección | inspección real + pasos compilados + pantalla objetivo |
| `negocio` | Consultoría | objetivo, criterio de aceptación, casos, guardas | casos cargados + criterio definido + guardas resueltas |

El aprendizaje pasa a `aprobado` **solo con las dos firmas**. Al volver a guardar se
recompila y se conserva únicamente la firma cuya mitad no cambió.

Compatibilidad: una `aprobacion` previa con `tipo: 'tecnica'` se migra automáticamente
como firma técnica si su hash sigue correspondiendo a la definición.

## Guardas del SOP (Cautionary Notes)

Frases de precaución del texto ("no marcar como activo sin confirmar…", "nunca…",
"solo si…") se detectan y quedan en estado `sin_definir`, **bloqueando la aprobación**
hasta que una persona resuelva cada una:

- **El test la verifica** → `control: 'automatico'`
- **Control humano** → `control: 'humano'`

Una guarda marcada como control humano deja el flujo con
`definicion_ejecutable.control_humano.requerido = true`: la corrida puede dar verde,
pero el flujo **no es apto para automatización desatendida**.

El agente nunca decide esto por su cuenta: es exactamente lo que la arquitectura dice
que no puede deducir de un SPO.

## Revalidación antes de escribir

El plan se congela al firmar. Antes de tocar la pantalla se revalida en tres capas:

1. **Al firmar** — la definición debe estar completa y sin pendientes.
2. **Al pedir ejecutar** (backend, antes de abrir el navegador) — se revalida el hash
   de navegación y el set de casos congelado; si algo cambió, falla rápido y con la causa.
3. **Dentro del runner** — vuelve a inventariar la pantalla real y aborta si el hash difiere.

Desvíos que se detectan: pantalla cambiada (testid que apareció o desapareció), caso
borrado o desactivado, campo de un caso modificado, y casos nuevos cargados después de
firmar que no entrarían en la corrida aprobada.

## Fuente de casos por pantalla

Declarada en `qa-catalogo-elementos.ts`. No todas las pantallas marcan sus casos igual:

```ts
// Pantalla 3: se reconoce por origen.pantalla
filtro: { origen_pantalla: 'QA - Pantalla 3' }
rutas_datos: ['contexto.contexto_complementario.pantalla_3', 'contexto.empleado']

// Pantalla 1: no marca origen.pantalla, se reconoce por el tipo
filtro: { origen_tipos: ['formulario_qa_pantalla_1', 'importacion_qa_pantalla_1'] }
rutas_datos: ['contexto.empleado', 'contexto.liquidacion']
mapeo: { empleado: 'contexto.empleado.nombre', dataset: 'dataset_codigo' }
```

`mapeo` resuelve los campos cuya clave no coincide con la del caso.

Una pantalla sin `fuente_casos` compila los pasos pero **no se puede aprobar**: no hay
datos con los que operarla.

## Retención

Se conservan las últimas `AUDITORIA_QA_INSPECCIONES_RETENIDAS` inspecciones por ruta
(10 por defecto). Nunca se borra una inspección referenciada por un aprendizaje vivo.
Al purgar se elimina también la captura del disco.

## Cómo escribir el texto del Loom

Una línea se toma como paso si arranca con número/guión **o** contiene un verbo
operativo: `ingreso`, `abro`, `completo`, `selecciono`, `guardo`, `presiono`, `reviso`,
`valido`, `ejecuto`, `cargo`, `pego`.

Palabras a evitar salvo que las quieras de verdad:

| Palabra | Efecto |
|---|---|
| `importar`, `carga masiva`, `subir archivo` | Pendiente: necesita una ruta de archivo real |
| `producción`, `productivo` | Pendiente: solo debe entrar material de sandbox |
| `local`, `demo` | Cambia el entorno detectado |
| `actualizar`, `refrescar`, `limpiar` | Agrega clicks a esos botones |

El valor **no sale del texto**: decir "completo el CUIL con 20-30111222-3" no hace que
el agente escriba ese número. Los datos vienen siempre de los casos QA.

### Ejemplo verificado (Pantalla 3)

```
Bueno, acá les muestro el flujo de alta de un cliente nuevo en QA - Pantalla 3.
La pantalla vive en la ruta /qa/pantalla-3 y la usamos en sandbox.
El objetivo es registrar el alta de un cliente nuevo desde el módulo QA.

Ingreso al menú QA y abro Pantalla 3.
Completo el cliente con la razón social.
Completo el area / sector al que pertenece.
Completo el teléfono de contacto.
Completo el número de documento.
Completo el CUIL del titular.
Completo la fecha de ingreso.
Por último guardo el caso y verifico el mensaje de confirmación.

El criterio de aceptación es que el alta quede registrada y visible en la tabla de casos de Pantalla 3.
```

## Requisitos para ejecutar

- Backend en `http://localhost:8001/api` y frontend en `http://localhost:4200`.
- MongoDB con al menos un caso activo de la pantalla objetivo.
- Chrome o Edge instalado (el runner los detecta solo, o usar `PLAYWRIGHT_CHROMIUM_EXECUTABLE`).
- Sesión iniciada: el inspector reutiliza la cookie del usuario logueado.

Variables opcionales:

```env
AUDITORIA_QA_INSPECCIONES_RETENIDAS=10
AUDITORIA_PLAYWRIGHT_TIMEOUT_MS=45000
PLAYWRIGHT_SLOWMO_MS=1800
PLAYWRIGHT_DEMO_FINAL_PAUSE_MS=15000
```

## Limitaciones conocidas

- El paso `importar` no se automatiza: abre un diálogo del sistema operativo.
- Pantalla 2 no expone `data-testid`; hay que instrumentarla antes de automatizarla.
- La detección de guardas es por patrones de texto: puede pasar por alto una precaución
  redactada de forma inusual. Lo que detecta siempre lo resuelve una persona, nunca el agente.
- El id que Pantalla 3 asigna al guardar se deriva de documento + fecha de ingreso, así
  que un caso importado con `id_caso` propio genera un registro distinto al guardarlo por UI.
