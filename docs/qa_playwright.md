# QA Playwright

Este flujo ejecuta casos creados desde el frontend en `QA > Pantalla 1`.

## Idea

1. Los datasets se leen desde el catalogo QA en MongoDB, coleccion `datasets`.
2. El caso QA se guarda en MongoDB, coleccion `qa_casos`, asociado a un dataset existente.
3. El backend rechaza el caso si el dataset no existe, no esta completo/validado o el periodo no coincide.
4. El caso guarda solo la referencia del Excel, por nombre de archivo.
5. El runner Playwright vuelve a validar el dataset antes de ejecutar.
6. El runner busca ese Excel en una carpeta local configurable.
7. En modo demo, Playwright vuelve a cargar el caso desde la UI `QA > Pantalla 1` para mostrar el alta del formulario.
8. Playwright carga el Excel desde la UI, espera el analisis y valida las assertions contra el JSON real del snapshot.
9. Las ejecuciones iniciadas desde la pantalla se guardan en MongoDB, coleccion `qa_ejecuciones`.

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
