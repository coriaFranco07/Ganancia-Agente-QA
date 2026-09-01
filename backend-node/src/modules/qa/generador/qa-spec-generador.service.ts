import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { QaCatalogoService } from '../catalogo/qa-catalogo.service';
import { QaSpiderCasosService } from '../casos/qa-spider-casos.service';
import { analizarSpec, generarVariante, Nivel, TablaPayloads } from './qa-spec-parser.util';

export interface AnalizarSpecDto {
  codigo: string;
}

export interface GenerarDesdeSpecDto {
  codigo: string;
  nombreBase: string;
  /** Relato en prosa del proceso automatizado. Se guarda igual en los 3 casos. */
  transcripcion?: string;
  nombreArchivo?: string;
  permitirGuardar?: boolean;
  ambito?: 'global' | 'ruta';
  aplicaA?: string[];
}

const NIVELES: Nivel[] = ['funcional', 'seguridad', 'accesibilidad'];
const ETIQUETA_NIVEL: Record<Nivel, string> = {
  funcional: 'funcional',
  seguridad: 'seguridad',
  accesibilidad: 'accesibilidad',
};

/**
 * Genera 3 casos del Spider (funcional/seguridad/accesibilidad) a partir de UN spec de
 * Playwright Codegen subido por el operador.
 *
 * No es un parser de JavaScript: reconoce el patron de sentencias que produce
 * Codegen (`await page.metodo(...).metodo(...);`, una por linea) y sustituye
 * lo que se escribe en cada campo segun el nivel, usando la misma tabla de
 * payloads que ya usa el fuzzing en vivo del Spider. El login inicial se
 * detecta y se descarta: el Spider ya inicia sesion antes de correr cualquier
 * caso, asi que no hace falta (ni conviene) repetirlo con una cuenta propia.
 */
@Injectable()
export class QaSpecGeneradorService {
  constructor(
    private readonly catalogoQa: QaCatalogoService,
    private readonly casos: QaSpiderCasosService,
  ) {}

  /** Analiza el spec sin guardar nada: para el preview antes de generar. */
  analizar(dto: AnalizarSpecDto) {
    const codigo = (dto?.codigo ?? '').trim();
    if (!codigo) throw new BadRequestException('Pegá o subí el contenido del spec.');

    const analisis = analizarSpec(codigo);
    if (!analisis.pasosReales.some((paso) => paso.tipo !== 'otro')) {
      throw new BadRequestException(
        'No se reconoció ningún paso de Playwright en el archivo. Verificá que sea un spec de Codegen.',
      );
    }

    const primerGuardado = analisis.pasosReales.find((paso) => paso.tipo === 'click' && paso.esBotonGuardado);

    return {
      login_detectado_y_omitido: analisis.loginDetectado,
      total_campos: analisis.totalCampos,
      total_botones_guardado: analisis.totalBotonesGuardado,
      lineas_no_reconocidas: analisis.lineasNoReconocidas,
      // Sin "permitir guardar", el flujo se corta en el primer boton de este
      // tipo: los pasos posteriores suelen depender de que se haya guardado.
      corte_sin_permitir_guardar: primerGuardado?.nombreCampo ?? null,
      campos: analisis.pasosReales
        .filter((paso) => paso.tipo === 'fill')
        .map((paso) => ({ nombre: paso.nombreCampo, familia: paso.familia, valor_original: paso.valorOriginal })),
      botones_guardado: analisis.pasosReales
        .filter((paso) => paso.tipo === 'click' && paso.esBotonGuardado)
        .map((paso) => ({ nombre: paso.nombreCampo })),
    };
  }

  /** Genera y persiste los 3 casos (funcional/seguridad/accesibilidad) como `qa_spider_casos`. */
  async generar(dto: GenerarDesdeSpecDto) {
    const codigo = (dto?.codigo ?? '').trim();
    const nombreBase = (dto?.nombreBase ?? '').trim();
    if (!codigo) throw new BadRequestException('Pegá o subí el contenido del spec.');
    if (!nombreBase) throw new BadRequestException('El grupo de casos necesita un nombre.');

    const analisis = analizarSpec(codigo);
    if (!analisis.pasosReales.some((paso) => paso.tipo !== 'otro')) {
      throw new BadRequestException(
        'No se reconoció ningún paso de Playwright en el archivo. Verificá que sea un spec de Codegen.',
      );
    }

    const catalogo = this.catalogoQa.catalogoCrudo();
    const payloads: TablaPayloads = catalogo.payloads ?? { funcional: {}, seguridad: {} };
    const permitirGuardar = dto.permitirGuardar === true;
    const grupoGenerado = randomUUID();

    const transcripcion = (dto.transcripcion ?? '').trim();
    const primerGuardado = analisis.pasosReales.find((paso) => paso.tipo === 'click' && paso.esBotonGuardado);

    const creados = [];
    for (const nivel of NIVELES) {
      const codigoNivel = generarVariante(analisis.pasosReales, nivel, payloads, permitirGuardar);
      const caso = await this.casos.crear({
        nombre: `${nombreBase} (${ETIQUETA_NIVEL[nivel]})`,
        descripcion: this.describirVariante(nivel, dto, analisis.loginDetectado, permitirGuardar, primerGuardado?.nombreCampo),
        transcripcion,
        codigo_playwright: codigoNivel,
        niveles: [nivel],
        ambito: dto.ambito ?? 'global',
        aplica_a: dto.ambito === 'ruta' ? dto.aplicaA ?? [] : [],
        activo: true,
      });
      await this.casos.marcarOrigenGenerado(caso.id, grupoGenerado, dto.nombreArchivo ?? null);
      creados.push({ ...caso, grupo_generado: grupoGenerado });
    }

    return {
      grupo_generado: grupoGenerado,
      login_detectado_y_omitido: analisis.loginDetectado,
      permitio_guardar: permitirGuardar,
      casos: creados,
    };
  }

  /**
   * Arma la descripcion de una variante.
   *
   * La transcripcion que escribe el operador describe el proceso ORIGINAL que
   * grabo. Cada variante generada se aparta de ese proceso: usa otros datos y
   * puede quedar truncada. Dejar esas diferencias explicitas es lo que permite
   * que despues alguien (o un bot) lea transcripcion + descripcion y no saque
   * conclusiones equivocadas sobre lo que este caso puntual realmente ejecuta.
   */
  private describirVariante(
    nivel: Nivel,
    dto: GenerarDesdeSpecDto,
    loginOmitido: boolean,
    permitirGuardar: boolean,
    nombreBotonGuardado?: string,
  ): string {
    const datos: Record<Nivel, string> = {
      funcional: 'reemplaza los valores por datos validos variados y casos limite (vacio, bordes, formatos distintos)',
      seguridad: 'reemplaza los valores por payloads de inyeccion y manipulacion (XSS, SQL/NoSQL, path traversal) y verifica que no lleguen sin sanear al backend',
      accesibilidad: 'repite los mismos valores que se grabaron y audita la pantalla resultante contra pautas WCAG',
    };

    const partes = [
      `Variante ${ETIQUETA_NIVEL[nivel]} generada desde ${dto.nombreArchivo ?? 'un spec subido'}: ${datos[nivel]}.`,
    ];

    if (loginOmitido) {
      partes.push('El login inicial del spec se omitio: el Spider ya inicia sesion antes de correr el caso.');
    }
    if (nombreBotonGuardado && !permitirGuardar) {
      partes.push(
        `El flujo se detiene al llegar a "${nombreBotonGuardado}": solo se verifica que el boton este habilitado, sin guardar datos reales.`,
      );
    }
    if (nombreBotonGuardado && permitirGuardar) {
      partes.push(`Hace click real en "${nombreBotonGuardado}", por lo que genera datos reales en cada corrida.`);
    }

    return partes.join(' ');
  }
}
