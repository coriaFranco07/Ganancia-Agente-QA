import { Injectable, Logger } from '@nestjs/common';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';

export interface QaCatalogoResultado {
  estado: 'verde' | 'rojo';
  modulo: string;
  stdout: string;
  stderr: string;
  duracion_ms: number;
  fecha: string;
  resultados?: any;
}

export interface QaSpiderSeccion {
  id: string;
  ruta: string;
  etiqueta: string;
  grupo?: string;
  por_defecto?: boolean;
}

export interface QaSpiderNivel {
  id: string;
  orden: number;
  etiqueta: string;
  descripcion: string;
}

export interface QaSpiderCatalogo {
  version: string;
  niveles: QaSpiderNivel[];
  secciones: QaSpiderSeccion[];
  umbrales: Record<string, number>;
  casos: Array<{
    id: string;
    nombre: string;
    descripcion?: string;
    ambito: string;
    niveles: string[];
    aplica_a: string | string[];
    pasos: string[];
  }>;
}

/**
 * Catalogo declarativo del Spider y ejecucion individual de casos.
 *
 * Version recortada del `QaLabService` del proyecto de origen: solo conserva lo
 * que necesitan el generador desde spec y la lista de casos generados. Quedaron
 * afuera el crawl completo, la mutacion de datos, la simulacion normativa y el
 * chat con Gemini, que no se migraron.
 */
@Injectable()
export class QaCatalogoService {
  private readonly logger = new Logger(QaCatalogoService.name);

  /**
   * Raiz del backend, de donde cuelga `scripts/`.
   *
   * Lo normal es que el proceso arranque con el cwd ahi (`npm start` y
   * `nest start` lo hacen), pero no depender de eso evita un fallo silencioso:
   * si el cwd es otro, el catalogo no aparece y el endpoint devuelve 500 sin
   * ninguna pista. El fallback por `__dirname` cae en la misma carpeta tanto
   * desde `src/modules/qa/catalogo` como desde `dist/modules/qa/catalogo`.
   */
  private readonly backendRoot = QaCatalogoService.resolverBackendRoot();

  private readonly rutaCatalogoSpider = resolve(
    this.backendRoot,
    'scripts',
    'qa-spider-casos.json',
  );
  private readonly rutaCatalogoSpiderLocal = resolve(
    this.backendRoot,
    'scripts',
    'qa-spider-casos.local.json',
  );

  private static resolverBackendRoot(): string {
    if (fs.existsSync(resolve(process.cwd(), 'scripts', 'qa-spider-casos.json'))) {
      return process.cwd();
    }
    return resolve(__dirname, '..', '..', '..', '..');
  }

  /**
   * Lee la URI de la base de datos en memoria si existe el archivo `.memory-db-uri`.
   */
  private getMongoUri(): string | undefined {
    try {
      const uriPath = resolve(this.backendRoot, '.memory-db-uri');
      if (fs.existsSync(uriPath)) {
        return fs.readFileSync(uriPath, 'utf8').trim();
      }
    } catch (error) {
      this.logger.warn('No se pudo leer .memory-db-uri');
    }
    return undefined;
  }

  /**
   * Lanza un script de QA en un proceso hijo.
   */
  private runScript(
    scriptName: string,
    modulo: string,
    envParams: Record<string, string>,
  ): Promise<QaCatalogoResultado> {
    const scriptPath = resolve(this.backendRoot, 'scripts', scriptName);
    const inicio = Date.now();
    const mongoUri = this.getMongoUri();

    const env: Record<string, string | undefined> = {
      ...process.env,
      ...envParams,
      PLAYWRIGHT_HEADLESS: 'false',
      AUDITORIA_PLAYWRIGHT_DEMO: 'true',
    };

    if (mongoUri) {
      env.MONGODB_URI = mongoUri;
    }

    this.logger.log(`▶ Iniciando QA [${modulo}] — script=${scriptName}`);

    return new Promise((resolvePromise) => {
      // El runner calcula su outputDir como `cwd/../outputs/...`: tiene que
      // arrancar en la raiz del backend para que coincida con useStaticAssets.
      const proc = spawn('node', [scriptPath], {
        cwd: this.backendRoot,
        env,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        const linea = chunk.toString();
        stdout += linea;
        this.logger.verbose(linea.trim());
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const linea = chunk.toString();
        stderr += linea;
        this.logger.warn(linea.trim());
      });

      proc.on('close', (code) => {
        const duracion_ms = Date.now() - inicio;
        const estado: 'verde' | 'rojo' = code === 0 ? 'verde' : 'rojo';
        this.logger.log(
          `✔ QA [${modulo}] finalizado — código=${code} estado=${estado} (${(duracion_ms / 1000).toFixed(1)}s)`,
        );
        resolvePromise({
          estado,
          modulo,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duracion_ms,
          fecha: new Date().toISOString(),
        });
      });

      proc.on('error', (error) => {
        const duracion_ms = Date.now() - inicio;
        this.logger.error(`✖ Error lanzando QA [${modulo}]: ${error.message}`);
        resolvePromise({
          estado: 'rojo',
          modulo,
          stdout: stdout.trim(),
          stderr: `Error al iniciar el proceso: ${error.message}`,
          duracion_ms,
          fecha: new Date().toISOString(),
        });
      });
    });
  }

  /**
   * Devuelve el catalogo declarativo del Spider (secciones, niveles y casos).
   *
   * Es la unica fuente de verdad: el frontend arma sus controles con esto en
   * lugar de mantener su propia copia de las rutas.
   */
  catalogoSpider(): QaSpiderCatalogo {
    const fusionado = this.catalogoCrudo();

    // Los pasos viajan como nombres de accion: la UI no necesita los parametros
    // internos de cada paso y publicarlos expondria payloads de fuzzing.
    return {
      version: fusionado.version,
      niveles: [...(fusionado.niveles ?? [])].sort((a, b) => a.orden - b.orden),
      secciones: fusionado.secciones ?? [],
      umbrales: fusionado.umbrales ?? {},
      casos: (fusionado.casos ?? []).map((caso: any) => ({
        id: caso.id,
        nombre: caso.nombre,
        descripcion: caso.descripcion,
        ambito: caso.ambito ?? 'ruta',
        niveles: caso.niveles ?? [],
        aplica_a: caso.aplica_a ?? '*',
        pasos: (caso.pasos ?? []).map((paso: any) =>
          typeof paso === 'string' ? paso : paso?.accion,
        ),
      })),
    };
  }

  /**
   * Catalogo fusionado sin sanitizar, para uso interno de otros servicios del
   * backend (ej. el generador de casos desde spec, que necesita las tablas de
   * payloads). Nunca se expone via HTTP: `catalogoSpider()` es la version
   * publica, sin los parametros internos de cada paso.
   */
  catalogoCrudo(): any {
    const base = this.leerCatalogo(this.rutaCatalogoSpider);
    if (!base) {
      throw new Error(
        `No se pudo leer el catalogo del Spider en ${this.rutaCatalogoSpider}. ` +
          'El archivo scripts/qa-spider-casos.json es obligatorio.',
      );
    }

    const local = this.leerCatalogo(this.rutaCatalogoSpiderLocal);
    if (!local) return base;

    return {
      ...base,
      ...local,
      niveles: this.fusionarPorId(base.niveles, local.niveles),
      secciones: this.fusionarPorId(base.secciones, local.secciones),
      umbrales: { ...base.umbrales, ...(local.umbrales ?? {}) },
      casos: this.fusionarPorId(base.casos, local.casos),
    };
  }

  private leerCatalogo(ruta: string): any | null {
    try {
      if (!fs.existsSync(ruta)) return null;
      return JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch (error) {
      this.logger.error(`No se pudo leer el catalogo del Spider en ${ruta}: ${String(error)}`);
      return null;
    }
  }

  private fusionarPorId<T extends { id: string }>(base: T[] = [], parche: T[] = []): T[] {
    const porId = new Map(base.map((item) => [item.id, item]));
    for (const item of parche) porId.set(item.id, { ...porId.get(item.id), ...item });
    return [...porId.values()];
  }

  /**
   * Ejecuta UN caso propio del operador, aislado del resto del catalogo. Es lo
   * que dispara el boton de "Ejecutar" individual: corre ahora mismo, sin
   * importar su nivel declarado ni si esta activo.
   */
  async ejecutarCasoUnico(id: string): Promise<QaCatalogoResultado> {
    return this.runScript('run-qa-spider.mjs', 'Caso individual', {
      QA_SPIDER_CASO_UNICO_ID: id,
    });
  }
}
