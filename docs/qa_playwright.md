# QA Playwright

Este flujo ejecuta casos creados desde el frontend en `QA > Pantalla 1`.

## Idea

1. El caso QA se guarda en MongoDB, coleccion `qa_casos`.
2. El caso guarda solo la referencia del Excel, por nombre de archivo.
3. El runner Playwright busca ese Excel en una carpeta local configurable.
4. En modo demo, Playwright vuelve a cargar el caso desde la UI `QA > Pantalla 1` para mostrar el alta del formulario.
5. Playwright carga el Excel desde la UI, espera el analisis y valida las assertions contra el JSON real del snapshot.

## Requisitos

- MongoDB levantado.
- Backend en `http://localhost:8001/api`.
- Frontend en `http://localhost:4200`.
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
