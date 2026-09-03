import { Injectable } from '@nestjs/common';
import { CampoCatalogo } from '../qa-catalogo-elementos';
import { PasoEjecutable } from '../qa-sop-loom.service';
import { candidatosDeSeguridad, candidatosFuncionales, esTipoConValor, valorSeguro } from './qa-suite-payloads';
import { CategoriaQaSuite } from './schemas/qa-suite-ejecucion.schema';

export interface EscenarioDerivado {
  /** Identificador legible y estable: mismo aprendizaje + misma categoria -> mismo id, siempre. */
  id: string;
  categoria: CategoriaQaSuite;
  /** Campo que este escenario ataca. null en accesibilidad: no varia ningun valor. */
  campo_bajo_prueba: string | null;
  valor_bajo_prueba: string | null;
  motivo: string;
  /** clave -> valor, en la misma forma que `caso.datos` en el ejecutor de pasos de SOP Loom. */
  datos: Record<string, string>;
}

/**
 * Deriva, de forma determinista, los escenarios de prueba de un aprendizaje
 * para una categoria de la Suite.
 *
 * No toca `qa_casos` en ningun punto: los valores salen de la restriccion
 * real que cada campo ya trae en `definicion_ejecutable.campos` (catalogo +
 * reglas de validacion resueltas al compilar el aprendizaje). Mismo
 * aprendizaje + misma categoria -> exactamente los mismos escenarios, siempre
 * -eso es lo que permite comparar una corrida contra la anterior.
 *
 * Estrategia "una variable por vez": para no explotar combinatoriamente, cada
 * escenario varia UN solo campo y completa el resto con su primer valor
 * funcional (el mas representativo), para que el flujo pueda seguir avanzando.
 * Los pasos del aprendizaje no se tocan -solo `datos`, en la misma forma que
 * ya consume `ejecutarPaso` en el runner de SOP Loom.
 */
@Injectable()
export class QaSuiteDerivadorService {
  derivarEscenarios(
    aprendizajeId: string,
    pasos: PasoEjecutable[],
    campos: CampoCatalogo[],
    categoria: CategoriaQaSuite,
  ): EscenarioDerivado[] {
    const camposPorClave = new Map(campos.map((campo) => [campo.clave, campo]));
    const clavesCompletar = [
      ...new Set(pasos.filter((paso) => paso.tipo === 'completar' && paso.campo).map((paso) => paso.campo as string)),
    ];

    if (categoria === 'accesibilidad') {
      return [this.escenarioBase(aprendizajeId, categoria, clavesCompletar, camposPorClave)];
    }

    const escenarios: EscenarioDerivado[] = [];

    for (const claveObjetivo of clavesCompletar) {
      const campo = camposPorClave.get(claveObjetivo);
      if (!campo || !esTipoConValor(campo.tipo)) continue;

      const candidatos = categoria === 'funcional' ? candidatosFuncionales(campo) : candidatosDeSeguridad(campo);

      candidatos.forEach((candidato, indice) => {
        const datos: Record<string, string> = {};
        for (const clave of clavesCompletar) {
          if (clave === claveObjetivo) {
            datos[clave] = candidato.valor;
            continue;
          }
          const otroCampo = camposPorClave.get(clave);
          datos[clave] = otroCampo ? valorSeguro(otroCampo) : '';
        }

        escenarios.push({
          id: `${aprendizajeId}-${categoria}-${campo.clave}-${indice + 1}`,
          categoria,
          campo_bajo_prueba: campo.clave,
          valor_bajo_prueba: candidato.valor,
          motivo: candidato.motivo,
          datos,
        });
      });
    }

    return escenarios;
  }

  /** Escenario unico con valores funcionales "seguros" en todos los campos: solo para llegar al estado a auditar. */
  private escenarioBase(
    aprendizajeId: string,
    categoria: CategoriaQaSuite,
    clavesCompletar: string[],
    camposPorClave: Map<string, CampoCatalogo>,
  ): EscenarioDerivado {
    const datos: Record<string, string> = {};
    for (const clave of clavesCompletar) {
      const campo = camposPorClave.get(clave);
      datos[clave] = campo ? valorSeguro(campo) : '';
    }

    return {
      id: `${aprendizajeId}-${categoria}-base`,
      categoria,
      campo_bajo_prueba: null,
      valor_bajo_prueba: null,
      motivo: 'valores funcionales seguros en todos los campos, solo para llegar al estado a auditar',
      datos,
    };
  }
}
