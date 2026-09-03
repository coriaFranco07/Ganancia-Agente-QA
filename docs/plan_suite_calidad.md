# Suite de Calidad — plan de implementación

Registro del plan por fases de la Suite de Calidad (Pantalla 4). Las Fases 0-4 son la v1 ya
implementada. Las Fases 5-9 son la continuación: cierran los huecos que aparecieron al
poner la v1 a correr contra el entorno real, y llevan el componente al nivel de robustez
que necesita para que su semáforo sea una fuente confiable de verdad.

## Estado — v1 (Fases 0-4), implementada

| Fase | Entregable | Dónde vive |
|---|---|---|
| 0 | Modelo de datos: `qa_suite_ejecuciones`, `qa_suite_hallazgos`, `qa_suite_corridas` — colecciones propias, no tocan `qa_hallazgos` | `src/modules/qa/suite/schemas/` |
| 1 | Motor de derivación determinista: candidatos funcionales y de seguridad a partir de la restricción real del campo, estrategia "una variable por vez" | `qa-suite-derivador.service.ts` + espejo `scripts/lib/qa-suite-derivador.mjs` |
| 2 | Tres scripts de categoría (funcional, seguridad, accesibilidad) sobre Playwright, sin depender de `qa_casos` | `scripts/run-qa-suite-*.mjs` |
| 3 | Orquestación backend: spawn de scripts, gate heredado de SOP Loom, consolidación de corridas, informe con comparación histórica | `qa-suite-runner.service.ts` |
| 4 | Pantalla 4: selección de flujos/categorías/modo, vista previa de datos antes de correr, matriz de resultados, informe | `qa-pantalla-4.component.ts` |

Correr la v1 de punta a punta contra el entorno real (rama `octa`, 10 corridas reales en
Atlas) mostró que la Suite abre el navegador, hace login y arma la matriz de resultados
correctamente, pero **el veredicto que muestra esa matriz todavía no es confiable**: el
semáforo se calcula solo, contando hallazgos, sin mirar si las ejecuciones que deberían
haberlos producido llegaron a correr. Las Fases 5-9 cierran exactamente esa brecha, en el
orden en que cada una habilita a la siguiente.

Dos ajustes de esta línea de trabajo ya se aplicaron y no requieren fase propia:

- El control de deriva de pantalla (`validarNavegacionAprobada` en `qa-suite-comun.mjs`)
  reconstruía el hash de inventario con menos campos (`testid, tag, tipo`) que el inspector
  que originalmente lo generó (`testid, tag, tipo, rol, nombre, etiqueta, obligatorio,
  opciones` en `qa-pantalla-inspector.service.ts`). Los dos hashes nunca podían coincidir,
  así que toda corrida se cortaba después del login. Ahora reproduce el cálculo original.
- La Suite dejó de exigir `estado === 'aprobado'` para listar y correr un aprendizaje:
  alcanza con que esté cargado y compilado (tenga `definicion_ejecutable`). Los que sí
  están aprobados conservan la verificación de que no cambiaron desde la aprobación.

---

## Fase 5 — Semáforo confiable ✅ implementada

**Objetivo.** Que el resultado de una corrida refleje si las ejecuciones que la componen
llegaron a producir evidencia, no solo cuántos hallazgos dejaron.

**Por qué va primero.** Es la fase más chica de las cinco y la que más cambia: hasta que
esté hecha, cualquier arreglo de una fase posterior se sigue reportando mal en el tablero.
Contra el entorno real, 10 de 12 ejecuciones terminaron en rojo (caída de conexión a
Atlas, corte por deriva de pantalla, timeout) y las 10 corridas que las agrupaban cerraron
en verde de todas formas — 0 hallazgos porque ninguna llegó a probar nada, no porque todo
haya salido bien.

**Tareas.**

1. `calcularEstadoConsolidado()` (`qa-suite-runner.service.ts:400`) deja de recibir solo
   la lista de hallazgos: recibe también las ejecuciones y prioriza su estado antes de
   mirar severidades.
2. Agregar el estado `error` a `QaSuiteCorrida.estado_consolidado` y a
   `QaSuiteEjecucion.estado`, distinto de `rojo`: `rojo` es "la aplicación falló una
   prueba", `error` es "la Suite no pudo correr la prueba". Reflejarlo en la pill de la
   Pantalla 4 (hoy `estado-pill` solo mapea corriendo/verde/amarillo/rojo).
3. `run-qa-suite-seguridad.mjs` calcula su estado final (línea 94) solo con
   `hallazgos.length`; alinearlo con el criterio que ya usa `run-qa-suite-funcional.mjs`
   (rojo si algún escenario no terminó en `ok`).
4. Test sobre el orquestador (hoy sin cobertura: los 6 tests existentes son todos del
   motor de derivación) que fije la regla: una corrida con ejecuciones en `rojo`/`error` y
   cero hallazgos nunca puede consolidar en `verde`.

**Criterio de aceptación.** Apagar el backend y disparar una corrida: la ejecución y la
corrida cierran en `error`, nunca en `verde`.

**Archivos.** `qa-suite-runner.service.ts`, `qa-suite-ejecucion.schema.ts`,
`qa-suite-corrida.schema.ts`, `run-qa-suite-seguridad.mjs`, `qa-pantalla-4.component.ts`
(mapeo de pills), `qa-suite-runner.service.spec.ts` (nuevo).

---

## Fase 6 — Que los escenarios lleguen a ejercitar la pantalla ✅ código implementado, pendiente de re-guardar flujos existentes

**Objetivo.** Que los valores derivados por la Suite efectivamente completen el
formulario y disparen el guardado, en vez de quedar bloqueados por la propia validación
del cliente.

**Contexto.** Al compilar un aprendizaje, `qa-sop-loom.service.ts:911` arma cada campo con
`{nombre, etiqueta, tipo, obligatorio, testid, fuente}` y no incluye `restriccion`, aunque
el catálogo (`qa-catalogo-elementos.ts`) sí la declara para esas mismas claves (p. ej.
`cuil: { largo_exacto: 11 }`, `telefono: { largo_minimo: 6 }`). El motor de derivación es
correcto, pero recibe campos sin restricción y cae a sus valores genéricos
(`"dato de prueba"`, `"1000"`), que no pasan la validación real del formulario. En la
corrida real contra "Legajo de Cliente" esto se tradujo en 27 de 27 escenarios de
seguridad muriendo en el mismo punto: `page.waitForResponse: Timeout 30000ms exceeded`
al hacer clic en "Guardar caso", porque el botón nunca llegó a disparar la petición.

**Tareas.**

1. ✅ Incluir `restriccion` (y `alias`) al construir el array `campos` en `compilar()`
   (`qa-sop-loom.service.ts:911-925`).
2. ⏳ Volver a compilar (guardar de nuevo) los aprendizajes ya existentes para que
   incorporen la restricción — no hace falta migración de datos, alcanza con re-guardarlos
   desde SOP Loom. **Pendiente**: es una acción sobre flujos ya aprobados de otras personas
   en el clúster compartido, así que queda para quien los tenga a cargo, no se hizo desde
   acá. `mapearCampos()` ya soporta ambos casos sin romperse (si no hay `restriccion`, cae
   al default vacío de siempre) — los flujos viejos van a seguir funcionando exactamente
   igual que antes hasta que se re-guarden.
3. ✅ Calcular el tiempo máximo (`qa-suite-runner.service.ts`, antes `MAX_MS_POR_MODO`
   fijo) en función de la cantidad de escenarios derivados: `TIEMPO_BASE_MS +
   escenarios.length × TIEMPO_POR_ESCENARIO_MS`, con techo por modo (20 min rápido / 30 min
   demo) para no dejar una corrida colgada indefinidamente.
4. ✅ Corregidos los comentarios que describían las restricciones como si vivieran en
   `definicion_ejecutable.campos` (esa clave nunca existió), en
   `qa-suite-derivador.service.ts`, `qa-suite-runner.service.ts` y `qa-suite-comun.mjs`.
5. ✅ Verificado con el motor de derivación real (no reimplementado): con la restricción
   que `compilar()` ahora persiste, `valorSeguro()` para CUIL y teléfono pasa de
   `"dato de prueba"` (rechazado por la validación real del formulario) a `"99999999999"` /
   `"999999"` (0 errores de validación). ⏳ Falta la confirmación contra una corrida real
   en el navegador: no hay ningún aprendizaje activo y ya re-guardado con el fix disponible
   ahora mismo (los existentes están desactivados por otra persona; uno nuevo apareció
   activo y aprobado pero se compiló antes de este fix). Se puede validar en cuanto alguien
   re-guarde un flujo con el código actualizado y se dispare una corrida funcional o de
   seguridad sobre él.

**Criterio de aceptación.** Una corrida funcional real no tiene escenarios con
`estado: 'error'`; el detalle de cada uno describe qué pasó en el formulario, no un
timeout de red.

**Archivos.** `qa-sop-loom.service.ts`, `qa-suite-runner.service.ts`,
`qa-suite-comun.mjs`, `run-qa-suite-*.mjs` (comentarios).

---

## Fase 7 — Aislar los datos que la Suite escribe

**Objetivo.** Que correr la Suite, cualquier cantidad de veces, no deje rastro permanente
en los datos de negocio del entorno compartido.

**Por qué va antes de la Fase 8.** El último paso de un flujo aprendido de "alta" es un
guardado real contra `/api/qa/casos` — hoy no se nota porque ningún escenario llega tan
lejos (Fase 6 sin resolver). En cuanto la Fase 6 esté hecha, cada uno de los escenarios de
seguridad va a insertar un documento en `qa_casos`, en el mismo clúster de Atlas que usa
el resto del equipo, con el payload de inyección como valor — un nombre de cliente
literal `<script>alert(1)</script>`. Conviene tener el aislamiento resuelto antes de que
eso empiece a pasar, no después.

**Tareas.**

1. Decidir el modelo de aislamiento entre dos opciones viables:
   - **Base de datos separada para la Suite** (siguiendo el patrón ya usado por
     `qa-datasets.service.ts`, que ya sostiene una conexión Mongo independiente para otro
     propósito), apuntando el flujo grabado a un backend de prueba propio.
   - **Marcado por corrida + borrado garantizado**: cada documento que un escenario cree
     se etiqueta con el id de la corrida (`corrida_id`) y se borra al cerrar la corrida,
     incluyendo el camino donde el runner se cae o lo mata el timeout de la Fase 5.
2. Implementar la opción elegida en el paso `click` que guarda (`ejecutarPaso` en
   `qa-suite-comun.mjs`) o en el cierre de `finalizarEjecucion`
   (`qa-suite-runner.service.ts`), según cuál se decida.
3. Resolver, en el mismo tramo, la colisión de rutas de evidencia: los tres runners
   escriben siempre al mismo archivo por categoría (p. ej.
   `qa-suite-seguridad-evidence.json`), y el orquestador dispara ejecuciones en paralelo
   sin cola — dos flujos con la misma categoría en una corrida se pisan la evidencia y las
   capturas. La ruta de salida debe fijarla el orquestador por ejecución (vía variable de
   entorno al spawnear), no el runner por categoría.

**Criterio de aceptación.** Correr la Suite diez veces seguidas contra el mismo flujo deja
la cantidad de documentos en `qa_casos` igual que antes de empezar. Dos flujos con la
misma categoría en una corrida conservan cada uno su propia evidencia y capturas.

**Archivos.** `qa-suite-comun.mjs`, `run-qa-suite-*.mjs`, `qa-suite-runner.service.ts`,
posible nuevo `qa-suite-datasets.service.ts` si se elige la opción de base separada.

---

## Fase 8 — Oráculos de la categoría de seguridad ✅ código implementado, pendiente confirmación end-to-end

**Objetivo.** Que cada frente de seguridad afirme algo verificable sobre el resultado
esperado, en vez de solo disparar la prueba y reportar limpio si nada explotó.

**Contexto.** Hoy la categoría genera valores que violan a propósito la restricción
declarada y payloads de inyección, los escribe, y no compara el resultado contra ninguna
expectativa formal — le falta el oráculo. El frente de inyección sí tiene una regla, pero
mide algo que no indica una vulnerabilidad: marca hallazgo si el payload "viaja sin
escapar" en el cuerpo de una petición JSON, que es el comportamiento correcto de un
`fetch`/`XHR` (el escapado corresponde a la capa que persiste o renderiza el dato, no al
envío). Y el frente de sesión valida el guardia de rutas de Angular (código de cliente,
sorteable) en vez de preguntarle directamente a la API si responde sin cookie.

**Tareas.**

1. ✅ **Frente de violación de restricción** (nuevo oráculo). El derivador ahora marca cada
   candidato de seguridad con `tipo: 'inyeccion' | 'violacion_restriccion'`
   (`qa-suite-payloads.ts`/`.mjs`, propagado en `EscenarioDerivado`). El paso de guardado se
   corre aparte (`intentarGuardado()`, espera corta de 8s, no lanza si no llega respuesta —
   un valor bloqueado por la validación del formulario no es un error de la Suite, es el
   resultado esperado) y su respuesta se le pasa a `oraculoViolacionRestriccion()`: si el
   guardado la aceptó (2xx), hallazgo de severidad alta.
2. ✅ **Frente de inyección**, con alcance acotado a propósito. Se apagó la regla vieja
   ("viajó sin escapar en el body") por las razones que ya señalaba este plan. En su lugar,
   `oraculoInyeccion()` solo evalúa efecto real para payloads con forma de XSS: guarda,
   reabre `/qa/casos` (donde el módulo muestra la descripción) y confirma que no se dispara
   un `dialog` nativo (lo que un `alert()` real produciría). Los payloads de SQLi/NoSQLi/
   path-traversal/plantillas se siguen mandando (para detectar si rompen el flujo) pero sin
   oráculo: esta app no arma SQL ni filtros Mongo dinámicos a partir de este valor, así que
   no hay todavía nada real que afirmar — mejor eso que un hallazgo que no se puede
   sostener.
3. ✅ **Frente de sesión**, ahora con dos comprobaciones. `frenteSesionNavegador()` (la que ya
   existía) más `frenteSesionApi()`: junta los endpoints que el flujo usa para guardar
   (los pasos compilados con `espera.tipo: 'respuesta'`) y les pega directo, sin cookie,
   exigiendo 401/403.
4. ✅ La Pantalla 4 declara el alcance real de la categoría "Seguridad": una lista visible en
   la propia card, con los 3 frentes implementados (sesión, violación de restricción, XSS)
   marcados y los 6 pendientes (otros payloads de inyección sin oráculo, IDOR, manipulación
   de parámetros de negocio, exposición de datos, carga de archivos, cabeceras de
   transporte) marcados aparte — verificado visualmente en el navegador.

**Verificado.** `tsc --noEmit` limpio (front y back), suite completa de Jest en verde
(203/206), paridad TS↔JS del derivador confirmada byte a byte (incluido el campo `tipo`
nuevo) sobre campos de texto/número/fecha con restricción. Dos tests nuevos fijan que el
derivador etiqueta correctamente cada candidato.

**Pendiente: confirmación end-to-end.** Se intentó dos veces contra el único aprendizaje
activo y aprobado disponible (`QA - Pantalla 1`) y las dos veces falló por causas ajenas al
código de esta fase, ambas ya clasificadas correctamente como `error` gracias a la Fase 5:
la primera por un timeout de conexión a Atlas del proceso hijo, la segunda porque la
pantalla real cambió (otra persona la está editando en vivo mientras se hacía esta prueba
— once selectores `qa-case-*` desaparecieron entre la aprobación y la corrida) y
`validarNavegacionAprobada` cortó la corrida como corresponde. Ninguna de las dos llegó a
ejecutar el código nuevo de esta fase. Vale la pena repetir la corrida cuando el entorno
compartido esté más estable.

**Archivos.** `qa-suite-payloads.ts`, `qa-suite-derivador.service.ts` (+ espejo
`qa-suite-derivador.mjs`), `run-qa-suite-seguridad.mjs`, `qa-pantalla-4.component.ts`,
`qa-suite-derivador.service.spec.ts`.

---

## Fase 9 — Sostenibilidad ✅ implementada

**Objetivo.** Que el componente se mantenga solo con el tiempo, sin depender de que quien
lo toque recuerde las decisiones de las fases anteriores.

**Tareas.**

1. ✅ Test de paridad entre `qa-suite-derivador.service.ts` (TypeScript, usado por la vista
   previa) y `scripts/lib/qa-suite-derivador.mjs` (su espejo en JavaScript plano, usado
   por los runners): corre ambos motores sobre los mismos campos (texto con y sin
   restricción, número, fecha, con patrón) y pasos, sobre las tres categorías, y exige
   salida idéntica. Jest no puede `import()` un `.mjs` real (su loader no entiende ESM
   fuera de lo que pasa por `transform`, y `.mjs` queda deliberadamente afuera de eso), así
   que el espejo se corre en un subproceso Node aparte (`execFileSync` con
   `--input-type=module`) — el mismo runtime que usan los runners reales, no una
   aproximación.
2. ✅ `verificar_fila` ya no depende de un caso QA congelado. `ejecutarPaso()` ahora recibe
   un `contexto` mutable por escenario; cuando un paso de guardado responde con éxito, guarda
   el `id` real que devolvió el backend (`idDesdeRespuesta()`) en ese contexto, y
   `verificar_fila` lo usa para esperar `[data-testid="<prefijo_fila><id>"]` visible —
   igual que hace el ejecutor propio de SOP Loom, pero con un id que la Suite dedujo de lo
   que ella misma escribió, no de un caso congelado. Si ningún paso anterior devolvió un
   id, sigue reportando `omitido` (no inventa nada); si el id apareció pero la fila no,
   reporta `hallazgo`.
3. ✅ El modo demo detecta si hay entorno gráfico (`DISPLAY`/`WAYLAND_DISPLAY` en Linux,
   asume que sí en macOS/Windows salvo `CI`) y degrada a headless con una advertencia en
   vez de que `chromium.launch({headless:false})` falle. Verificado en vivo con y sin
   `DISPLAY` seteado.
4. ✅ `docs/contexto_para_agentes.md` §6.5 reescrita: modelo de aislamiento de datos de la
   Fase 7, distinción `rojo`/`error`, gate de aprobación condicional, alcance real de la
   categoría de seguridad, y el gotcha del entorno compartido invalidando aprendizajes en
   vivo mientras se los usa.

**Criterio de aceptación — verificado en vivo.** Se desincronizó a propósito un valor del
espejo JS (dejando el TS sin tocar): el test de paridad falló, mostrando el diff exacto.
Restaurado el archivo, la suite completa volvió a pasar (204/209, 5 skips preexistentes).

**Verificado.** `tsc --noEmit` limpio, suite completa de Jest en verde, sintaxis validada
en los cinco `.mjs` tocados.

**Archivos.** `qa-suite-derivador.service.spec.ts` (nuevo caso de paridad),
`qa-suite-comun.mjs`, `docs/contexto_para_agentes.md`.

---

## Orden y dependencias

```
Fase 5 (semáforo confiable)
   └─ habilita interpretar correctamente el resultado de todo lo siguiente
Fase 6 (datos que ejercitan la pantalla)
   └─ habilita que los escenarios lleguen a guardar de verdad
       └─ Fase 7 (aislar lo que se guardó) — resolver ANTES de que la Fase 6
          empiece a insertar datos reales en el entorno compartido
Fase 8 (oráculos de seguridad)
   └─ depende de que los escenarios completen el flujo (Fase 6) y de que lo
      que guardan esté aislado (Fase 7)
Fase 9 (sostenibilidad)
   └─ transversal, se puede repartir en paralelo con cualquiera de las anteriores
```

No hay dependencia entre Fase 5 y las demás: puede implementarse y entregarse sola,
primero, sin esperar al resto.

## Estado final

Las cinco fases (5-9) están implementadas y verificadas por tipo/test/sintaxis. Dos cosas
quedan pendientes de una confirmación en vivo que no dependen de código, sino de que el
entorno compartido esté momentáneamente estable:

- **Fase 6, tarea 2**: los aprendizajes ya aprobados por otras personas necesitan
  volver a guardarse desde SOP Loom para incorporar la restricción real de sus campos.
- **Fase 8**: se intentó dos veces contra el único aprendizaje activo disponible y las dos
  veces se cortó por causas ajenas al código (timeout de Atlas, la pantalla cambiando en
  vivo mientras otra persona la editaba) — ambas correctamente clasificadas como `error`
  gracias a la Fase 5, pero ninguna llegó a ejercitar los oráculos nuevos de punta a punta
  en el navegador.

Vale la pena repetir esa corrida cuando el entorno esté más tranquilo; no hay nada de
código bloqueando que se haga.
