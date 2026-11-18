# Comparación local de Ollama

El benchmark solo contacta `http://127.0.0.1:11434`. No abre Gmail ni utiliza endpoints de envío. Usa borradores ficticios propios de `cases.json`; los mensajes privados del feedback histórico no forman parte del corpus.

```powershell
ollama pull gemma3:4b
npm run benchmark
npm run benchmark:report
```

Requiere Node 22.18+ con soporte nativo de TypeScript y ambos modelos instalados. Se importa el prompt y el posprocesamiento de la aplicación para evitar comparar una implementación diferente.

- 20 casos: 10 español / 10 inglés, contextos y tonos variados, negaciones, información faltante, fechas, importes, URLs, nombres y dos casos con instrucciones citadas.
- Dos repeticiones por modelo: 80 generaciones medidas. Semillas 42/43, temperatura 0,3, contexto 4096 y máximo 512 tokens. El límite de tokens es propio del experimento; la app no lo configura.
- Orden por bloques invertido en la segunda repetición, casos barajados con semilla y un solo modelo residente. Los valores de muestreo no especificados conservan los defaults de cada modelo.
- Descarga, precarga y una generación de calentamiento por bloque se registran aparte y se excluyen de la latencia caliente. Se registran tiempo total observado en el cliente, primer token, carga, tokens y velocidad del servidor.
- `generations.csv` y `generations.jsonl` se escriben después de **cada** solicitud. CSV admite comillas y saltos de línea; abrir con un lector CSV, no contar líneas físicas como ejecuciones.
- `metadata.json` identifica hardware, versión de Ollama, digests y hashes del corpus/prompt. `warmups.csv` conserva cargas y memoria.

Después de leer las salidas, las revisiones editoriales del agente se registran en `review-decisions.json` dentro de la carpeta de ejecución y se exportan a `evaluations.csv`: fidelidad, gramática y tono/claridad, cada una 1–5. Nota total = (2×fidelidad + gramática + tono)/4. Un resultado útil requiere nota ≥4, sin error crítico, idioma correcto, hechos explícitos conservados, asunto y ningún marcador pendiente. No es feedback humano ni evaluación ciega. Cada evaluación incluye el hash del texto evaluado. El informe exige una revisión explícita para cada salida: no inventa valoraciones si faltan.

`data/feedback.csv` conserva el registro humano original y añade las 80 pruebas con el mismo formato de la app: `timestamp,model,setting,tone,rating,draft,result,feedback`. Los saltos de línea se guardan como `\n` literal. El comentario empieza por `[BENCHMARK_AGENT ...]` para identificar la revisión del agente e incluye caso, repetición, nota ponderada original, tiempos y observaciones. `rating` redondea esa nota al entero más cercano (1–5); el valor exacto también permanece en `evaluations.csv`. No se presentan estas revisiones como opiniones humanas.

`npm run benchmark:feedback` importa las pruebas ya evaluadas. `npm run benchmark:report` también las importa automáticamente y omite registros ya presentes: ejecutarlos varias veces no duplica pruebas. Para resumir satisfacción humana, el informe excluye las filas con marcador del agente. El archivo central permanece bajo `data/`, ignorado por Git, sin publicarse en la presentación.

Una muestra diseñada de 20 casos, incluso con repeticiones, no representa el tráfico real ni permite certificar una tasa de error de producción. La selección editorial necesita validación independiente. Los costos ya no monetizan tiempo ahorrado ni errores: [`COSTS.md`](COSTS.md) documenta tarifas públicas de alquiler, el precio del usuario de USD 5/mes y el punto de equilibrio de infraestructura. Comisiones e impuestos permanecen pendientes y la cuota de correos no se infiere de los tiempos de la laptop.

`cost-inputs.json` conserva fuentes y configuración. El informe genera `infrastructure-costs.csv`, `cashflow.csv`, `costs.json` y `sensitivity.csv`. La gráfica cambia entre 24/7, horario de 8 h por 22 días y Serverless Flex bajo demanda. Este último permite variar solicitudes por usuario y segundos totales facturados por solicitud, identificados como escenarios. No hay menú plegable. `strategies.json` conserva tarifas y parámetros, y `execution-strategies.csv` exporta las tres propuestas; el [desglose](COSTS.md) explica sus condiciones y costos persistentes.

Para reanudar un proceso interrumpido, establezca `BENCHMARK_RUN_ID` al identificador de la carpeta existente. Las filas exitosas se omiten y los errores se conservan. Un informe deduplica por intento y utiliza la última fila registrada. La aplicación continúa utilizando Qwen; el benchmark no cambia el modelo predeterminado.
