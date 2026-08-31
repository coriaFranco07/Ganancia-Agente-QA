import { Injectable } from '@nestjs/common';

export interface CorreccionAsistidaEntrada {
  caso: Record<string, unknown>;
  ejecucion: Record<string, unknown> | null;
  hallazgo: Record<string, unknown>;
}

type EstadoCorreccion = 'generada' | 'fallback_local' | 'sin_ejecucion' | 'sin_fallo';

interface DatoRevision {
  nombre: string;
  valor_actual: string;
  fuente: string;
  accion: string;
}

interface CambioSugerido {
  area: string;
  tipo: 'dato_prueba' | 'archivo' | 'dataset' | 'automatizacion' | 'motor' | 'sin_cambio';
  descripcion: string;
  requiere_aprobacion: boolean;
  riesgo: string;
}

interface TicketSugerido {
  asunto: string;
  descripcion: string;
  criterios_aceptacion: string[];
}

interface PruebaRegresion {
  comando: string;
  esperado: string;
}

interface CorreccionAsistida {
  estado: EstadoCorreccion;
  proveedor: 'gemini' | 'local';
  modelo: string | null;
  caso_id: string;
  titulo: string;
  resumen: string;
  causa_probable: string;
  accion_recomendada: string;
  pasos: string[];
  datos_a_revisar: DatoRevision[];
  cambios_sugeridos: CambioSugerido[];
  ticket_sugerido: TicketSugerido;
  prueba_regresion: PruebaRegresion;
  preguntas_para_responsable: string[];
  limites: string[];
  advertencias: string[];
  hallazgo: Record<string, unknown>;
  politica: string;
}

@Injectable()
export class QaCorreccionAsistidaService {
  private readonly modelos = this.modelosConfigurados();
  private readonly endpointBase = process.env.GEMINI_ENDPOINT ?? 'https://generativelanguage.googleapis.com/v1beta';
  private readonly timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 45000);
  private readonly reintentos = Math.max(1, Number(process.env.GEMINI_REINTENTOS ?? 2));
  private readonly reintentoBaseMs = Number(process.env.GEMINI_REINTENTO_BASE_MS ?? 900);

  async generar(entrada: CorreccionAsistidaEntrada): Promise<CorreccionAsistida> {
    const local = this.correccionLocal(entrada);
    if (local.estado === 'sin_ejecucion' || local.estado === 'sin_fallo') return local;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || process.env.AUDITORIA_QA_CORRECCION_IA === 'false') {
      return {
        ...local,
        advertencias: [
          ...local.advertencias,
          apiKey
            ? 'La corrección con Gemini está desactivada por AUDITORIA_QA_CORRECCION_IA=false.'
            : 'Gemini no está configurado; se muestra una corrección local del backend.',
        ],
      };
    }

    try {
      const generada = await this.llamarGemini(apiKey, this.contextoSeguro(entrada, local));
      return this.combinarCorreccion(local, generada);
    } catch (error) {
      return {
        ...local,
        advertencias: [
          ...local.advertencias,
          `No se pudo generar corrección con Gemini; se muestra fallback local. Motivo: ${this.mensajeError(error)}`,
        ],
      };
    }
  }

  private correccionLocal(entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    const casoId = this.texto(entrada.caso['id']) || 'caso QA';
    const estadoEjecucion = this.texto(entrada.ejecucion?.['estado']);
    const hallazgoCodigo = this.texto(entrada.hallazgo['codigo']) || 'generico';
    const base = this.base(casoId, entrada);

    if (!entrada.ejecucion) {
      return {
        ...base,
        estado: 'sin_ejecucion',
        resumen: `El caso ${casoId} todavía no tiene una ejecución para corregir.`,
        causa_probable: 'No hay resultado rojo disponible. Sin evidencia no corresponde sugerir cambios.',
        accion_recomendada: 'Crear un plan, aprobarlo y ejecutar el caso para obtener evidencia real antes de corregir.',
        pasos: [
          'Generar un plan desde el chat o desde Pantalla 1.',
          'Aprobar el plan con el hash vigente.',
          'Ejecutar el plan y revisar la evidencia.',
        ],
        cambios_sugeridos: [this.cambio('Flujo QA', 'sin_cambio', 'No modificar datos hasta tener una ejecución con evidencia.', false, 'Bajo')],
      };
    }

    if (estadoEjecucion === 'verde') {
      return {
        ...base,
        estado: 'sin_fallo',
        resumen: `El caso ${casoId} está verde; no hay corrección pendiente.`,
        causa_probable: 'La última ejecución validó el Excel, el dataset y la comparación esperada dentro de tolerancia.',
        accion_recomendada: 'No cambiar el caso. Conservar la evidencia como respaldo de regresión.',
        pasos: ['Revisar la evidencia si se necesita documentar la corrida.', 'Crear otro caso solo si aparece un escenario distinto.'],
        cambios_sugeridos: [this.cambio('Caso QA', 'sin_cambio', 'Sin cambios recomendados sobre un caso verde.', false, 'Bajo')],
      };
    }

    if (hallazgoCodigo === 'excel_legajo') return this.correccionExcelLegajo(base, entrada);
    if (hallazgoCodigo === 'excel_periodo') return this.correccionExcelPeriodo(base, entrada);
    if (hallazgoCodigo === 'dataset') return this.correccionDataset(base, entrada);
    if (hallazgoCodigo === 'assertion') return this.correccionAssertion(base, entrada);
    if (hallazgoCodigo === 'archivo') return this.correccionArchivo(base, entrada);
    if (hallazgoCodigo === 'pantalla') return this.correccionPantalla(base, entrada);
    return this.correccionGenerica(base, entrada);
  }

  private correccionExcelLegajo(base: CorreccionAsistida, entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    const evidencia = this.objeto(entrada.ejecucion?.['evidencia']);
    const empleado = this.objeto(evidencia['empleado']);
    const empleadoCaso = this.objeto(this.objeto(entrada.caso['contexto'])['empleado']);
    const esperado = this.texto(empleado['legajo_esperado']) || this.texto(empleadoCaso['legajo']);
    const detectado = this.texto(empleado['legajo_detectado']);
    return {
      ...base,
      resumen: 'El archivo Excel no corresponde al legajo declarado en el caso QA.',
      causa_probable: `El caso esperaba legajo ${esperado || '-'} y el Excel detectó ${detectado || '-'}.`,
      accion_recomendada: 'Corregir la referencia del Excel o el legajo del caso, según cuál sea el dato verdadero.',
      pasos: [
        'Abrir Pantalla 1 y revisar el legajo del caso QA.',
        'Verificar que el Excel seleccionado pertenezca al mismo legajo.',
        'Si el Excel era incorrecto, adjuntar el Excel correcto y guardar el caso.',
        'Si el caso estaba mal cargado, corregir legajo/empleado y guardar.',
        'Generar un nuevo plan y ejecutar Demo para dejar evidencia visual.',
      ],
      datos_a_revisar: [
        this.dato('Legajo esperado', esperado, 'Caso QA', 'Debe coincidir con el empleado del Excel.'),
        this.dato('Legajo detectado', detectado, 'Evidencia Playwright', 'Debe coincidir con el legajo esperado.'),
        this.dato('Excel', this.nombreExcel(entrada), 'Caso QA', 'Confirmar que el archivo corresponda al mismo empleado.'),
      ],
      cambios_sugeridos: [
        this.cambio('Caso QA', 'dato_prueba', 'Actualizar el legajo del caso solo si el dato cargado estaba mal.', true, 'Medio'),
        this.cambio('Archivo Excel', 'archivo', 'Reemplazar el Excel asociado si pertenece a otro empleado.', true, 'Medio'),
      ],
      preguntas_para_responsable: [
        '¿El legajo correcto del escenario de prueba es el del caso o el detectado dentro del Excel?',
        '¿El archivo cargado corresponde al cliente y período esperados?',
      ],
      ticket_sugerido: this.ticket(base.caso_id, 'corregir legajo o Excel asociado', [
        'El caso QA guarda el legajo correcto.',
        'El Excel asociado corresponde al mismo legajo.',
        'La nueva corrida no falla por control de legajo.',
      ]),
    };
  }

  private correccionExcelPeriodo(base: CorreccionAsistida, entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    const evidencia = this.objeto(entrada.ejecucion?.['evidencia']);
    const periodo = this.objeto(evidencia['periodo']);
    const esperado = this.texto(periodo['esperado']) || this.texto(entrada.caso['periodo']);
    const detectado = this.texto(periodo['detectado']);
    return {
      ...base,
      resumen: 'El Excel no corresponde al período declarado en el caso QA.',
      causa_probable: `El caso esperaba ${esperado || '-'} y el archivo fue detectado como ${detectado || '-'}.`,
      accion_recomendada: 'Usar un Excel del mismo período que el dataset/caso o crear un caso nuevo para el período real del archivo.',
      pasos: [
        'Revisar el período del dataset seleccionado.',
        'Confirmar el período detectado en el nombre/contenido del Excel.',
        'Si el Excel es correcto, crear o ajustar el caso para ese período.',
        'Si el caso es correcto, adjuntar un Excel del período esperado.',
        'Generar un nuevo plan porque el anterior queda invalidado.',
      ],
      datos_a_revisar: [
        this.dato('Período esperado', esperado, 'Caso QA / dataset', 'Debe coincidir con el Excel.'),
        this.dato('Período detectado', detectado, 'Evidencia Playwright', 'Debe coincidir con el caso.'),
        this.dato('Excel', this.nombreExcel(entrada), 'Caso QA', 'Confirmar rango de meses del archivo.'),
      ],
      cambios_sugeridos: [
        this.cambio('Caso QA', 'dato_prueba', 'Actualizar período solo si el escenario correcto es el del Excel.', true, 'Medio'),
        this.cambio('Archivo Excel', 'archivo', 'Usar un archivo del período esperado por el dataset.', true, 'Medio'),
      ],
      preguntas_para_responsable: [
        '¿Qué período se quiere auditar realmente?',
        '¿El dataset elegido corresponde a la normativa del período del Excel?',
      ],
      ticket_sugerido: this.ticket(base.caso_id, 'alinear período de caso, dataset y Excel', [
        'El caso QA, el dataset y el Excel quedan en el mismo período.',
        'El control de período deja de fallar.',
        'La evidencia muestra período esperado y detectado coincidentes.',
      ]),
    };
  }

  private correccionDataset(base: CorreccionAsistida, entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    return {
      ...base,
      resumen: 'El caso QA está asociado a un dataset que no cumple el contrato del período o fuente normativa.',
      causa_probable: this.texto(entrada.hallazgo['motivo']) || 'El backend bloqueó el uso de un dataset incompatible.',
      accion_recomendada: 'Seleccionar un dataset validado, con fuente normativa completa y período compatible con el caso.',
      pasos: [
        'Abrir Pantalla 1.',
        'Seleccionar el dataset desde el combo, no escribirlo a mano.',
        'Verificar que el período se complete automáticamente desde el dataset.',
        'Guardar el caso y pedir un plan nuevo.',
      ],
      datos_a_revisar: [
        this.dato('Dataset', this.texto(entrada.caso['dataset_codigo']), 'Caso QA', 'Debe existir y estar validado.'),
        this.dato('Período caso', this.texto(entrada.caso['periodo']), 'Caso QA', 'Debe coincidir con el dataset.'),
      ],
      cambios_sugeridos: [
        this.cambio('Dataset', 'dataset', 'Cambiar a un dataset validado del período correcto.', true, 'Medio'),
      ],
      preguntas_para_responsable: [
        '¿El período del caso corresponde a la normativa del dataset elegido?',
        '¿La fuente normativa del dataset está validada para ese período?',
      ],
      ticket_sugerido: this.ticket(base.caso_id, 'corregir dataset asociado al caso QA', [
        'El caso no puede guardarse con dataset inexistente o incompleto.',
        'El período del caso coincide con el período del dataset.',
        'El plan nuevo se genera sin parámetros pendientes.',
      ]),
    };
  }

  private correccionAssertion(base: CorreccionAsistida, entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    return {
      ...base,
      resumen: 'Falló la comparación entre el valor esperado del caso QA y el valor calculado por el análisis.',
      causa_probable: this.texto(entrada.hallazgo['motivo']) || 'La assertion del caso no coincide con el snapshot generado.',
      accion_recomendada: 'Primero confirmar si el valor esperado del caso está bien. Si está bien, registrar el hallazgo como posible diferencia real del motor o de datos de origen.',
      pasos: [
        'Revisar el campo a validar y el valor esperado cargado en Pantalla 1.',
        'Abrir la evidencia para ver el valor actual calculado.',
        'Si el esperado estaba mal, corregir el caso QA y generar plan nuevo.',
        'Si el esperado estaba bien, documentar el hallazgo para revisar motor/datos de origen.',
        'Ejecutar nuevamente y esperar verde si la corrección era del caso.',
      ],
      datos_a_revisar: [
        this.dato('Campo validado', this.campoValidado(entrada), 'Caso QA', 'Debe apuntar al campo real del snapshot.'),
        this.dato('Valor esperado', this.valorEsperado(entrada), 'Caso QA', 'Debe representar el resultado esperado por negocio.'),
        this.dato('Detalle técnico', this.texto(entrada.ejecucion?.['detalle']), 'Ejecución QA', 'Contiene esperado, actual, diferencia y tolerancia.'),
      ],
      cambios_sugeridos: [
        this.cambio('Caso QA', 'dato_prueba', 'Corregir valor esperado solo si fue cargado incorrectamente.', true, 'Medio'),
        this.cambio('Motor / datos origen', 'motor', 'Si el esperado es correcto, abrir revisión técnica del cálculo o del Excel origen.', true, 'Alto'),
      ],
      preguntas_para_responsable: [
        '¿El valor esperado cargado en el caso QA fue definido por negocio o fue estimado?',
        '¿La diferencia observada coincide con un comportamiento esperado del período/dataset?',
      ],
      ticket_sugerido: this.ticket(base.caso_id, 'analizar diferencia de resultado esperado vs actual', [
        'Se identifica si el error era dato de prueba o cálculo real.',
        'El valor esperado queda justificado.',
        'La corrida posterior deja evidencia verde o hallazgo documentado.',
      ]),
    };
  }

  private correccionArchivo(base: CorreccionAsistida, entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    return {
      ...base,
      resumen: 'Playwright no pudo encontrar o cargar el archivo Excel del caso.',
      causa_probable: 'El caso guarda solo el nombre del archivo, pero el Excel real debe existir en la carpeta configurada.',
      accion_recomendada: 'Verificar que el archivo exista en AUDITORIA_QA_EXCEL_DIR o corregir el nombre asociado al caso.',
      pasos: [
        'Confirmar el nombre exacto del Excel en Pantalla 1.',
        'Verificar que el archivo exista en la carpeta configurada para Playwright.',
        'Evitar diferencias de espacios, signos o extensión.',
        'Guardar el caso y ejecutar nuevamente.',
      ],
      datos_a_revisar: [
        this.dato('Excel esperado', this.nombreExcel(entrada), 'Caso QA', 'Debe existir en la carpeta de Excels.'),
        this.dato('Detalle técnico', this.texto(entrada.ejecucion?.['detalle']), 'Ejecución QA', 'Indica si falta archivo, ruta o permisos.'),
      ],
      cambios_sugeridos: [
        this.cambio('Archivo Excel', 'archivo', 'Ubicar el archivo en la carpeta esperada o corregir el nombre guardado.', true, 'Medio'),
      ],
      ticket_sugerido: this.ticket(base.caso_id, 'normalizar referencia de archivo Excel', [
        'El Excel existe en la carpeta configurada.',
        'El nombre guardado coincide exactamente con el archivo.',
        'Playwright puede adjuntar el Excel sin error.',
      ]),
    };
  }

  private correccionPantalla(base: CorreccionAsistida, entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    return {
      ...base,
      resumen: 'El fallo parece estar en la automatización de pantalla, no en el cálculo de Ganancias.',
      causa_probable: 'Playwright no pudo resolver un selector, encontró más de un elemento o la pantalla no terminó de renderizar.',
      accion_recomendada: 'Revisar data-testid y definición técnica antes de modificar datos de negocio.',
      pasos: [
        'Identificar el selector mencionado en el detalle técnico.',
        'Confirmar que exista un único data-testid para ese control.',
        'Actualizar la definición técnica si cambió la UI.',
        'Ejecutar el endpoint de estado de definición técnica.',
        'Repetir en modo Demo para confirmar la interacción.',
      ],
      datos_a_revisar: [
        this.dato('Definición técnica', this.texto(entrada.caso['definicion_tecnica_codigo']), 'Caso QA', 'Debe tener rutas/selectores vigentes.'),
        this.dato('Detalle técnico', this.texto(entrada.ejecucion?.['detalle']), 'Ejecución QA', 'Indica selector, timeout o strict mode.'),
      ],
      cambios_sugeridos: [
        this.cambio('Automatización', 'automatizacion', 'Corregir data-testid o definición técnica, no el caso QA.', true, 'Medio'),
      ],
      ticket_sugerido: this.ticket(base.caso_id, 'corregir automatización Playwright del caso QA', [
        'La definición técnica cumple QA_DEF_TEC_MIN_V1.',
        'El selector problemático es único y estable.',
        'La corrida Demo completa el flujo sin error de UI.',
      ]),
    };
  }

  private correccionGenerica(base: CorreccionAsistida, entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    return {
      ...base,
      resumen: 'La ejecución terminó en rojo y requiere revisión guiada.',
      causa_probable: this.texto(entrada.hallazgo['motivo']) || 'No se pudo clasificar el fallo con una regla conocida.',
      accion_recomendada: 'Revisar evidencia, Excel, dataset, definición técnica y assertion del caso en ese orden.',
      pasos: [
        'Abrir evidencia de la última corrida.',
        'Confirmar dataset y período.',
        'Confirmar Excel, legajo y resultado esperado.',
        'Repetir en Demo si la causa no queda clara.',
      ],
      datos_a_revisar: [
        this.dato('Detalle técnico', this.texto(entrada.ejecucion?.['detalle']), 'Ejecución QA', 'Primera pista para clasificar el fallo.'),
      ],
      cambios_sugeridos: [
        this.cambio('Caso QA', 'dato_prueba', 'Revisar datos del caso antes de tocar motor o automatización.', true, 'Medio'),
      ],
    };
  }

  private base(casoId: string, entrada: CorreccionAsistidaEntrada): CorreccionAsistida {
    return {
      estado: 'fallback_local',
      proveedor: 'local',
      modelo: null,
      caso_id: casoId,
      titulo: `Corrección asistida ${casoId}`,
      resumen: '',
      causa_probable: '',
      accion_recomendada: '',
      pasos: [],
      datos_a_revisar: [],
      cambios_sugeridos: [],
      ticket_sugerido: this.ticket(casoId, 'revisar caso QA', [
        'El fallo queda clasificado.',
        'Se define si corresponde corregir datos, Excel, dataset, automatización o motor.',
        'La nueva ejecución deja evidencia verificable.',
      ]),
      prueba_regresion: {
        comando: `$env:AUDITORIA_QA_CASE="${casoId}"; npm run qa:playwright:demo`,
        esperado: 'La corrida debe cerrar verde o dejar un rojo justificado con evidencia actualizada.',
      },
      preguntas_para_responsable: [],
      limites: [
        'La corrección asistida no modifica datos ni archivos automáticamente.',
        'Gemini no calcula impuestos ni cambia el veredicto del motor.',
        'Todo cambio requiere revisión humana y un plan nuevo antes de ejecutar.',
      ],
      advertencias: [],
      hallazgo: entrada.hallazgo,
      politica: 'La corrección asistida propone acciones; no aplica cambios automáticamente y no reemplaza aprobación humana.',
    };
  }

  private async llamarGemini(apiKey: string, contexto: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cuerpo = JSON.stringify({
      systemInstruction: {
        parts: [{
          text: [
            'Sos un asistente senior de QA para Auditoria de Ganancias.',
            'No calcules impuestos, no inventes normativa y no cambies el estado verde/rojo.',
            'Usa solo el JSON recibido. No inventes rutas, celdas, legajos, periodos ni archivos.',
            'Tu tarea es mejorar la correccion asistida: causa probable, accion, pasos, preguntas y ticket sugerido.',
            'Distingui dato de prueba, Excel, dataset, automatizacion y posible motor.',
            'No propongas modificar datos del cliente sin aprobacion humana.',
            'Devuelve JSON valido con estas claves: resumen, causa_probable, accion_recomendada, pasos, preguntas_para_responsable, criterios_aceptacion, mensaje_ticket, limites.',
          ].join(' '),
        }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: JSON.stringify(contexto) }],
      }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });

    let ultimoError: unknown;
    for (const modelo of this.modelos) {
      for (let intento = 1; intento <= this.reintentos; intento += 1) {
        try {
          const respuesta = await this.enviarSolicitudGemini(apiKey, cuerpo, modelo);
          if (!respuesta.ok) {
            const error = new Error(`Gemini respondió HTTP ${respuesta.status} con ${modelo}`);
            ultimoError = error;
            if (this.esHttpReintentable(respuesta.status) && intento < this.reintentos) {
              await this.esperarReintento(intento);
              continue;
            }
            if (this.esHttpReintentable(respuesta.status) && this.hayOtroModelo(modelo)) break;
            throw error;
          }

          const data = await respuesta.json() as any;
          const texto = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
          return {
            modelo,
            ...this.parsearJson(texto),
          };
        } catch (error) {
          ultimoError = error;
          if (this.esErrorReintentable(error) && intento < this.reintentos) {
            await this.esperarReintento(intento);
            continue;
          }
          if (this.esErrorReintentable(error) && this.hayOtroModelo(modelo)) break;
          throw error;
        }
      }
    }

    throw ultimoError instanceof Error ? ultimoError : new Error(String(ultimoError));
  }

  private combinarCorreccion(local: CorreccionAsistida, ia: Record<string, unknown>): CorreccionAsistida {
    const criterios = this.listaTexto(ia['criterios_aceptacion']);
    return {
      ...local,
      estado: 'generada',
      proveedor: 'gemini',
      modelo: this.texto(ia['modelo']) || null,
      resumen: this.texto(ia['resumen']) || local.resumen,
      causa_probable: this.texto(ia['causa_probable']) || local.causa_probable,
      accion_recomendada: this.texto(ia['accion_recomendada']) || local.accion_recomendada,
      pasos: this.listaTexto(ia['pasos'], local.pasos),
      preguntas_para_responsable: this.listaTexto(ia['preguntas_para_responsable'], local.preguntas_para_responsable),
      limites: [...local.limites, ...this.listaTexto(ia['limites'])],
      ticket_sugerido: {
        ...local.ticket_sugerido,
        descripcion: this.texto(ia['mensaje_ticket']) || local.ticket_sugerido.descripcion,
        criterios_aceptacion: criterios.length ? criterios : local.ticket_sugerido.criterios_aceptacion,
      },
    };
  }

  private contextoSeguro(entrada: CorreccionAsistidaEntrada, local: CorreccionAsistida): Record<string, unknown> {
    const caso = entrada.caso;
    const ejecucion = entrada.ejecucion ?? {};
    const evidencia = this.objeto(ejecucion['evidencia']);
    const excel = this.objeto(evidencia['excel']);
    return {
      caso: {
        id: this.texto(caso['id']),
        dataset_codigo: this.texto(caso['dataset_codigo']),
        definicion_tecnica_codigo: this.texto(caso['definicion_tecnica_codigo']),
        periodo: this.texto(caso['periodo']),
        descripcion: this.texto(caso['descripcion']),
        excel: this.nombreExcel(entrada),
        campo_validado: this.campoValidado(entrada),
        valor_esperado: this.valorEsperado(entrada),
      },
      ejecucion: {
        id: this.texto(ejecucion['id']),
        estado: this.texto(ejecucion['estado']),
        modo: this.texto(ejecucion['modo']),
        detalle: this.texto(ejecucion['detalle']),
      },
      evidencia: {
        dataset: this.objeto(evidencia['dataset']),
        periodo: this.objeto(evidencia['periodo']),
        empleado: this.objeto(evidencia['empleado']),
        excel: {
          nombre: this.texto(excel['nombre']),
          snapshot_id: this.texto(excel['snapshot_id']),
        },
      },
      hallazgo: entrada.hallazgo,
      correccion_local: {
        resumen: local.resumen,
        causa_probable: local.causa_probable,
        accion_recomendada: local.accion_recomendada,
        pasos: local.pasos,
        datos_a_revisar: local.datos_a_revisar,
        cambios_sugeridos: local.cambios_sugeridos,
        ticket_sugerido: local.ticket_sugerido,
      },
    };
  }

  private async enviarSolicitudGemini(apiKey: string, cuerpo: string, modelo: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.endpointBase}/models/${modelo}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: cuerpo,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private ticket(casoId: string, accion: string, criterios: string[]): TicketSugerido {
    return {
      asunto: `QA Ganancias: ${accion} en ${casoId}`,
      descripcion: [
        `Revisar el caso ${casoId} y aplicar corrección asistida.`,
        'La acción debe quedar validada con nueva corrida Playwright y evidencia actualizada.',
      ].join(' '),
      criterios_aceptacion: criterios,
    };
  }

  private dato(nombre: string, valorActual: unknown, fuente: string, accion: string): DatoRevision {
    return {
      nombre,
      valor_actual: this.texto(valorActual) || '-',
      fuente,
      accion,
    };
  }

  private cambio(
    area: string,
    tipo: CambioSugerido['tipo'],
    descripcion: string,
    requiereAprobacion: boolean,
    riesgo: string,
  ): CambioSugerido {
    return {
      area,
      tipo,
      descripcion,
      requiere_aprobacion: requiereAprobacion,
      riesgo,
    };
  }

  private nombreExcel(entrada: CorreccionAsistidaEntrada): string {
    const evidencia = this.objeto(entrada.ejecucion?.['evidencia']);
    const excelEvidencia = this.objeto(evidencia['excel']);
    const archivo = this.objeto(entrada.caso['archivo']);
    return this.texto(excelEvidencia['nombre']) || this.texto(archivo['nombre']);
  }

  private campoValidado(entrada: CorreccionAsistidaEntrada): string {
    const resultado = this.objeto(entrada.caso['resultado_esperado']);
    const assertions = Array.isArray(entrada.caso['assertions']) ? entrada.caso['assertions'] : [];
    const assertion = this.objeto(assertions[0]);
    return this.texto(resultado['campo']) || this.texto(assertion['campo']);
  }

  private valorEsperado(entrada: CorreccionAsistidaEntrada): string {
    const resultado = this.objeto(entrada.caso['resultado_esperado']);
    const assertions = Array.isArray(entrada.caso['assertions']) ? entrada.caso['assertions'] : [];
    const assertion = this.objeto(assertions[0]);
    return this.texto(resultado['valor'] ?? resultado['retencion_ganancias'] ?? assertion['esperado']);
  }

  private modelosConfigurados(): string[] {
    const principal = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';
    const texto = process.env.GEMINI_MODELOS ?? [
      principal,
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
    ].join(',');
    return [...new Set(texto.split(',').map((modelo) => modelo.trim()).filter(Boolean))];
  }

  private esHttpReintentable(status: number): boolean {
    return status === 429 || status === 503 || status === 502 || status === 504 || status >= 500;
  }

  private esErrorReintentable(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const mensaje = error.message.toLowerCase();
    return mensaje.includes('fetch failed') || mensaje.includes('econnreset') || mensaje.includes('etimedout') || mensaje.includes('aborted');
  }

  private esperarReintento(intento: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.reintentoBaseMs * intento));
  }

  private hayOtroModelo(modelo: string): boolean {
    return this.modelos.indexOf(modelo) < this.modelos.length - 1;
  }

  private parsearJson(texto: string): Record<string, unknown> {
    const limpio = texto
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    return JSON.parse(limpio);
  }

  private listaTexto(valor: unknown, fallback: string[] = []): string[] {
    if (!Array.isArray(valor)) return fallback;
    const salida = valor.map((item) => this.texto(item)).filter(Boolean);
    return salida.length ? salida : fallback;
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private mensajeError(error: unknown): string {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted')) {
        return `tiempo agotado esperando respuesta de Gemini (${this.timeoutMs} ms)`;
      }
      return error.message;
    }
    return String(error);
  }
}
