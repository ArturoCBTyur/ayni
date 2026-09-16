# ADR-0001 · Flutter Web como frontend del MVP

- **Estado:** aceptado
- **Fecha:** 2026-09-15

## Contexto

La Tabla 17 del Entregable 2 y las Figuras 10, 13 y 14 especifican Flutter como capa de presentación, con el argumento de un solo código base para web, Android e iOS. Al iniciar el desarrollo, la máquina de trabajo no tenía Flutter ni Dart instalados, y la experiencia previa del equipo está en React + Vite.

Se evaluó sustituir Flutter por React + PWA, que habría sido más rápido de construir con las habilidades existentes.

## Decisión

Se mantiene **Flutter Web** en el canal stable, empezando por el objetivo web y dejando habilitadas las plataformas Android e iOS en el mismo proyecto.

## Motivos

- El Entregable 2 ya fue presentado describiendo Flutter. Cambiar de stack obligaría a corregir la arquitectura documentada y restaría coherencia al informe de los dos cursos.
- El requisito de multiplataforma real (RNF-17) se cumple de verdad, no por aproximación: el mismo código compila a Android e iOS cuando se necesite, sin reescritura.
- La captura de comprobantes en campo (RF-PS-03) y el modo sin conexión (RNF-16) tienen soporte de primera clase en el ecosistema Flutter.

## Consecuencias

- Coste de aprendizaje de Dart y del modelo de widgets sobre el plazo del MVP. Se mitiga ordenando las fases de menor a mayor complejidad de interfaz.
- **La accesibilidad es el riesgo real.** Flutter Web renderiza a canvas y su árbol de semántica para lectores de pantalla es más frágil que el HTML nativo. Cumplir WCAG 2.1 AA (RNF-15) exige `Semantics` explícito desde el inicio y verificación con NVDA en la Fase 10. Si algún criterio no se alcanza, se documenta como limitación en el informe en lugar de declararlo cumplido.
- El desarrollo local usa Edge (`flutter run -d edge`) porque esta máquina no tiene Chrome instalado.

## Versiones fijadas

Flutter 3.47.4 · canal stable · Dart 3.13.3 · DevTools 2.60.0
