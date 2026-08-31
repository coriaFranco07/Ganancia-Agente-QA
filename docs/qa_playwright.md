# QA Playwright

Este flujo ejecuta casos creados desde el frontend en `QA > Pantalla 1`.

## Idea

1. Los datasets se leen desde el catalogo QA en MongoDB, coleccion `datasets`.
2. Las definiciones tecnicas se guardan en MongoDB, coleccion `qa_definiciones_tecnicas`.
3. El caso QA se guarda en MongoDB, coleccion `qa_casos`, asociado a un dataset existente y a una definicion tecnica.
4. El backend rechaza el caso si el dataset no existe, no esta completo/validado o el periodo no coincide.
5. El caso guarda solo la referencia del Excel, por nombre de archivo.
6. El runner Playwright vuelve a validar el dataset antes de ejecutar.
7. El runner resuelve la definicion tecnica del caso para conocer rutas, selectores y pasos sin redescubrir la UI.
8. El runner busca ese Excel en una carpeta local configurable.
9. En modo demo, Playwright vuelve a cargar el caso desde la UI `QA > Pantalla 1` para mostrar el alta del formulario.
10. Playwright carga el Excel desde la UI, espera el analisis y valida que el archivo corresponda al caso QA.
11. Playwright valida las assertions contra el JSON real del snapshot.
12. Las ejecuciones iniciadas desde la pantalla se guardan en MongoDB, coleccion `qa_ejecuciones`.

## Evidencia y trazabilidad

Cada ejecucion QA guarda:

- `caso_id`, modo, estado, fecha de inicio y fecha de cierre.
- `evidencia_path`: ruta del JSON tecnico generado por Playwright.
- `resultado`: resultado tecnico del caso dentro del JSON de evidencia.
- `evidencia`: resumen auditable listo para UI/chat.
- `capturas`: screenshots relacionados con la corrida.

El resumen `evidencia` incluye:

- dataset usado, periodo, convenio y fuente normativa;
- definicion tecnica usada;
- Excel usado, directorio local y `snapshot_id`;
- periodo esperado/detectado;
- legajo esperado/detectado;
- validaciones ejecutadas con esperado, actual, tolerancia y estado;
- capturas generadas y capturas fallidas.

Desde `QA > Pantalla 1 > Operacion QA`, el boton de resultado abre el detalle completo de la ultima ejecucion del caso. Las capturas se muestran como miniaturas y se pueden abrir en un visor grande con navegacion anterior/siguiente. Desde el chat, una pregunta como `Mostrame la evidencia de QA-GAN-IMP-006` resume esos mismos datos, incluyendo hallazgos, sin obligar al usuario a leer el JSON.

## Catalogo de hallazgos QA

Cada ejecucion roja genera hallazgos normalizados en MongoDB, coleccion `qa_hallazgos`. La idea es separar el estado tecnico de la corrida del seguimiento de lo que hay que corregir.

Un hallazgo guarda:

- `ejecucion_id` y `caso_id`;
- `tipo`: `negocio`, `estructural`, `precondicion` o `entorno`;
- `severidad`: `info`, `baja`, `media`, `alta` o `critica`;
- `estado`: `abierto`, `resuelto` o `descartado`;
- `codigo` estable para no depender del texto visible;
- titulo, detalle, paso, campo, esperado y actual;
- evidencia asociada, capturas disponibles y propuesta de accion.

Clasificacion actual:

- diferencia de importe contra el esperado -> `negocio`;
- periodo, legajo o dataset incompatible -> `precondicion`;
- selector, timeout o problema de interaccion UI -> `estructural`;
- archivo Excel inexistente, proceso huerfano o cierre sin clasificar -> `entorno`.

Endpoints:

```text
GET /api/qa/hallazgos
GET /api/qa/hallazgos?caso_id=QA-GAN-IMP-010
GET /api/qa/hallazgos?ejecucion_id=QA-RUN-...
GET /api/qa/hallazgos/:id
POST /api/qa/hallazgos/:id/estado
```

Para cambiar estado:

```json
{
  "estado": "resuelto",
  "motivo": "Se corrigio el selector y la prueba vuelve a pasar."
}
```

En `QA > Pantalla 1 > Operacion QA`, al abrir el comprobante de una ejecucion se muestran los hallazgos junto con la evidencia. Desde ahi se puede marcar un hallazgo como resuelto o descartado sin perder la auditoria de cierre.

## Definiciones tecnicas

Un caso QA contiene datos variables: dataset, periodo, Excel, legajo, campo esperado y tolerancia.

Una definicion tecnica contiene el mapa reusable que Playwright necesita para ejecutar: rutas, selectores, pasos y esperas. Muchos casos pueden usar la misma definicion.

Definicion base:

```text
DEF-AUD-GAN-RETENCION-V1
```

Incluye las rutas `/qa/pantalla-1` y `/cargar-excel`, los selectores del formulario QA, los selectores de carga de Excel y los pasos de ejecucion. Si un caso viejo no tiene `definicion_tecnica_codigo`, el backend y el runner usan esa definicion default.

### Contrato minimo versionado

Las definiciones tecnicas se validan contra el contrato:

```text
QA_DEF_TEC_MIN_V1
```

Ese contrato evita que el agente dependa de rutas, textos o selectores hardcodeados. Una definicion vigente debe declarar:

- rutas obligatorias: `rutas.login`, `rutas.pantalla_qa`, `rutas.carga_excel`;
- selectores obligatorios de login, formulario QA y carga Excel;
- valores tecnicos visibles usados como espera: titulo de Pantalla 1, mensaje de guardado, titulo de Carga Excel y texto de resultado;
- pasos minimos: `navegar`, `completar_formulario_qa`, `subir_archivo`, `guardar_caso`, `ejecutar_analisis`, `validar_snapshot`.

Los selectores obligatorios deben usar `data-testid`. Si una definicion no cumple el contrato:

- el backend rechaza su guardado;
- el backend rechaza crear casos QA que apunten a esa definicion;
- el runner Playwright bloquea la ejecucion con un error claro antes de interactuar con la UI.

Endpoint tecnico para revisar el estado de una definicion:

```text
GET /api/qa/definiciones-tecnicas/:codigo/estado
```

Respuesta esperada:

```json
{
  "codigo": "DEF-AUD-GAN-RETENCION-V1",
  "version": 1,
  "estado": "vigente",
  "contrato": {
    "contrato_version": "QA_DEF_TEC_MIN_V1",
    "valido": true,
    "errores": [],
    "advertencias": []
  }
}
```

## Convencion data-testid

Las automatizaciones deben usar `data-testid` como selector principal. Los textos visibles, clases CSS y posicion de botones quedan solo como fallback para compatibilidad.

Patron recomendado:

```text
auth-email-input
qa-case-dataset-select
qa-case-save-button
qa-operation-start-QA-GAN-RET-001
carga-excel-file-input
qa-chat-plan-approve-button
```

Reglas:

- Los `data-testid` no deben cambiar por ajustes visuales o de copy.
- Los inputs terminan en `-input`, selects en `-select` y botones en `-button`.
- Los elementos repetidos agregan el identificador funcional, por ejemplo `qa-operation-card-<id_caso>`.
- La definicion tecnica guarda las rutas y selectores que consume Playwright.
- Al crear una nueva pantalla QA, primero se agregan sus `data-testid` y despues se registran en la definicion tecnica.

## SOP Loom y descubrimiento de pantallas

El modulo `QA > SOP Loom` convierte una descripcion operativa en una definicion ejecutable sin inventar rutas ni selectores.

Flujo:

1. El usuario pega la descripcion o transcripcion de Loom y analiza el texto.
2. El sistema detecta la ruta, los pasos, los campos y el criterio de aceptacion.
3. `Inspeccionar pantalla` abre la ruta real con Playwright usando la sesion actual, sin completar campos ni pulsar acciones.
4. La inspeccion guarda en `qa_inspecciones_pantalla` el inventario de `data-testid`, sus etiquetas, tipos, opciones, una captura y un hash estable.
5. El backend cruza los pasos del SOP con los controles observados. La fuente del paso es `sop_loom`; la fuente del selector es `navegacion`.
6. Los datos variables salen de los casos QA de la pantalla. La definicion nunca inventa valores para completar el formulario.
7. La persona revisa el plan completo y registra la aprobacion tecnica con usuario, fecha, hash de definicion y hash de navegacion.
8. Antes de ejecutar, el backend vuelve a inspeccionar la pantalla y aborta si cambio el contrato real. Tambien revalida que los casos congelados sigan iguales.
9. El runner interpreta la definicion aprobada, opera un caso por vez y guarda evidencia y capturas.

Colecciones:

- `qa_sop_loom_aprendizajes`: texto, pasos, definicion, aprobacion y ultima ejecucion;
- `qa_inspecciones_pantalla`: observaciones tecnicas inmutables del sandbox;
- `qa_casos`: datos reales que el agente usa para completar la pantalla.

Endpoints:

```text
POST /api/qa/sop-loom/inspeccionar
GET  /api/qa/sop-loom/inspecciones/:id/captura
POST /api/qa/sop-loom/aprendizajes
POST /api/qa/sop-loom/aprendizajes/:id/aprobar
POST /api/qa/sop-loom/aprendizajes/:id/ejecutar
```

El catalogo local conserva la semantica de negocio y la fuente de casos de las pantallas conocidas. Los selectores que llegan a una definicion version 3 siempre son los observados por Playwright y quedan trazados con `fuente.tipo = navegacion`.

## Controles automaticos QA

Antes de validar el calculo, el runner controla el archivo:

- `archivo.periodo`: el periodo detectado del Excel debe coincidir con el periodo del caso.
- `archivo.legajo`: el legajo detectado del Excel debe coincidir con el legajo del caso.

El analisis conserva `control_archivo.metadata_detectada` antes de aplicar los datos manuales del formulario. Por eso, si el formulario carga `06/2026` pero el nombre del Excel indica `Meses_1al_8`, QA puede detectar `08/2026` como periodo del archivo y marcar rojo.

Para desactivar ese control solo en una corrida tecnica:

```powershell
$env:AUDITORIA_QA_VALIDAR_ARCHIVO="false"
```

## Requisitos

- MongoDB levantado.
- Backend en `http://localhost:8001/api`.
- Frontend en `http://localhost:4200`.
- Datasets existentes en `QA_DATASETS_MONGODB_URI` o, por defecto, `mongodb://127.0.0.1:27017/qa_agentico_esueldos`.
- El Excel debe existir en la carpeta configurada por `AUDITORIA_QA_EXCEL_DIR`.

## Comando

Desde `backend-node`:

```powershell
$env:AUDITORIA_QA_EXCEL_DIR="C:\Users\Lenovo Ideapad\Downloads"
npm run qa:playwright
```

Para correr un caso especifico:

```powershell
$env:AUDITORIA_QA_CASE="QA-GAN-RET-001"
npm run qa:playwright
```

Modo visible/demo:

```powershell
$env:AUDITORIA_QA_EXCEL_DIR="C:\Users\Lenovo Ideapad\Downloads"
npm run qa:playwright:demo
```

Ese modo abre el navegador, carga el formulario `QA - Pantalla 1`, guarda el caso, sube el Excel en `Cargar Excel` y valida el resultado. Por defecto corre lento para poder ver cada paso. Al final muestra un cartel visual con el resultado QA y espera 15 segundos antes de cerrar.

## Desde la pantalla

En `QA > Pantalla 1`, la tabla `Operacion QA` permite ejecutar un caso puntual sin tocar la terminal:

- `Start`: ejecuta el caso en modo rapido.
- `Demo`: ejecuta el caso con navegador visible y pasos lentos.
- `Ver resultado`: muestra el estado, detalle y ruta de evidencia de la ultima corrida.
- `Probar error dataset`: envia una prueba negativa sin guardar un caso real. Usa el dataset seleccionado, fuerza un periodo distinto y espera que el backend rechace el alta.

El backend llama internamente al mismo runner, seteando `AUDITORIA_QA_CASE` con el ID de la fila elegida. Por eso Playwright no elige un caso al azar: ejecuta el caso del boton presionado.

Si una corrida queda en `corriendo` por un reinicio del backend o por un corte del proceso Playwright, el backend la marca como `rojo` en la siguiente consulta de la tabla. Tambien corta ejecuciones que superen el tiempo maximo:

```powershell
$env:AUDITORIA_QA_RAPIDO_MAX_MS="360000"
$env:AUDITORIA_QA_DEMO_MAX_MS="720000"
$env:AUDITORIA_QA_STALE_MS="900000"
```

## Asistente QA

En `QA > Asistente QA` hay un chat operativo con flujo de plan y aprobacion:

- Lee casos activos desde `qa_casos`.
- Lee las ultimas ejecuciones desde `qa_ejecuciones`.
- Registra planes en `qa_planes_asistente`.
- Explica fallos rojos con una clasificacion simple: dataset, periodo, legajo, archivo, assertion o automatizacion de pantalla.
- Arma un plan antes de ejecutar: dataset, periodo, Excel, legajo, campo esperado, tolerancia, impacto, verificacion, riesgo, vencimiento y hash.
- Exige aprobacion explicita antes de ejecutar desde el chat.
- Revalida el caso antes de ejecutar. Si algo cambio despues de aprobar, aborta sin ejecutar.
- Sincroniza el plan ejecutado con la evidencia de `qa_ejecuciones`.
- Orienta importaciones masivas y correcciones.
- Genera correccion asistida para ejecuciones rojas o casos sin evidencia, usando Gemini si esta configurado y fallback local si la IA no responde.

Flujo:

1. El usuario pide un plan para un caso.
2. El asistente verifica que no falten parametros obligatorios.
3. Si falta algo, crea una sesion en estado `recolectando`, lista pendientes y pide datos simples al usuario.
4. Cada respuesta queda como parametro resuelto con origen: respondido, inferido, normalizado, default o leido del sistema.
5. Si esta completo, crea un plan en estado `plan_propuesto`.
6. El usuario aprueba el plan con el hash vigente.
7. El plan pasa a `aprobado`.
8. El usuario ejecuta el plan aprobado.
9. El backend revalida que el caso siga igual que el plan aprobado.
10. Si coincide, dispara Playwright y marca el plan `ejecutando`.
11. Al consultar contexto, el asistente actualiza el plan a `verificado` o `fallido` segun la ejecucion.

Estados del plan:

```text
recolectando -> plan_propuesto
plan_propuesto -> aprobado -> ejecutando -> verificado | fallido
recolectando -> vencido
plan_propuesto -> vencido
aprobado -> vencido | abortado
```

El plan vence por defecto a los 15 minutos. Puede cambiarse con:

```powershell
$env:AUDITORIA_QA_PLAN_TTL_MS="900000"
```

La conversacion completa no se persiste. El registro auditable queda formado por pedido original, parametros, plan, hash, aprobacion, ejecucion y evidencia.

### Correccion asistida

El usuario puede pedir:

```text
Como corregir QA-GAN-IMP-010
```

El asistente responde con:

- causa probable del fallo;
- accion recomendada;
- datos a revisar, separando caso QA, Excel, dataset, evidencia y automatizacion;
- cambios sugeridos con aprobacion humana requerida cuando corresponde;
- ticket sugerido con criterios de aceptacion;
- comando de prueba de regresion para repetir el caso.

La correccion asistida no modifica casos, datasets, Excel ni codigo. Solo propone un camino de correccion. Si el usuario cambia datos, debe generar un plan nuevo, aprobarlo y ejecutarlo.

Variables relacionadas:

```powershell
$env:GEMINI_API_KEY="..."
$env:GEMINI_MODEL="gemini-3.5-flash"
$env:GEMINI_MODELOS="gemini-3.5-flash,gemini-3.6-flash,gemini-3.5-flash-lite"
$env:AUDITORIA_QA_CORRECCION_IA="false"
```

Si `AUDITORIA_QA_CORRECCION_IA=false` o no hay `GEMINI_API_KEY`, el backend mantiene una respuesta local deterministica para no cortar el flujo del chat.

## Test E2E del asistente

Desde `backend-node`:

```powershell
npm run qa:chat:e2e
```

Este comando valida el contrato del chat por API:

- login tecnico QA;
- carga de contexto;
- respuesta de resumen;
- diagnostico de un caso;
- correccion asistida con ticket sugerido y prueba de regresion;
- creacion de plan;
- bloqueo de ejecucion sin aprobacion;
- aprobacion con hash;
- registro auditable con actor humano, ejecutor agente, versiones y texto mostrado.

Por defecto no ejecuta Playwright para no ensuciar corridas ni tardar de mas. Si se quiere probar tambien la ejecucion real del plan:

```powershell
$env:AUDITORIA_QA_CHAT_E2E_RUN="true"
npm run qa:chat:e2e
```

Para correrlo sobre un caso puntual:

```powershell
$env:AUDITORIA_QA_CASE="QA-GAN-IMP-007"
npm run qa:chat:e2e
```

Si se valida la correccion asistida con Gemini y la red esta lenta, puede aumentarse el timeout del E2E:

```powershell
$env:AUDITORIA_QA_CHAT_E2E_TIMEOUT_MS="90000"
```

La evidencia queda en:

```text
outputs/playwright/qa-chat-e2e/qa-chat-e2e-evidence.json
```

## Importar datos

En `QA > Pantalla 1`, el modulo `Importar Datos` permite crear muchos casos QA desde un archivo de carga masiva.

Formato recomendado:

- Excel `.xlsx` o CSV: mejor para QA/RRHH porque cada fila es un caso.
- JSON: util para integraciones tecnicas o generacion automatica.
- Word: no se recomienda porque es documento narrativo, no una tabla estable para validar.

Columnas esperadas:

```text
id_caso;definicion_tecnica_codigo;dataset_codigo;periodo;archivo_excel;cliente;modo_saldo_favor;legajo;empleado;cuil;remuneracion_bruta;deducciones;campo_validar;valor_esperado;tolerancia;estado_esperado
```

El campo `periodo` puede venir vacio si `dataset_codigo` existe; en ese caso el backend usa el periodo del dataset. Si viene informado y no coincide con el dataset, la fila falla.

El campo `definicion_tecnica_codigo` puede venir vacio; en ese caso el backend usa `DEF-AUD-GAN-RETENCION-V1`.

El campo `archivo_excel` guarda solo el nombre del Excel de liquidacion. Ese Excel real debe existir luego en la carpeta `AUDITORIA_QA_EXCEL_DIR` para que Playwright pueda ejecutarlo.

La prueba negativa sirve para demostrar este control:

```text
Dataset: DS-AUD-GAN-082026
Periodo dataset: 08/2026
Caso QA periodo: 06/2026
Resultado esperado: error, no se guarda el caso
```

Para hacerlo aun mas lento:

```powershell
$env:PLAYWRIGHT_SLOWMO_MS="2600"
$env:PLAYWRIGHT_DEMO_PAUSE_MS="1800"
$env:PLAYWRIGHT_DEMO_FINAL_PAUSE_MS="25000"
npm run qa:playwright:demo
```

## Caso legajo 6

Para el Excel `CC_Legajo_6_MyS_062026_Control.xlsx`, el caso recomendado valida:

```text
Campo a validar: Retencion informada/liquidada
Path tecnico: calculo.retencion_excel
Valor esperado: 0
Tolerancia: 0.05
```

Ese caso controla que, si el calculo genera saldo negativo, la retencion liquidada de junio quede en cero.
