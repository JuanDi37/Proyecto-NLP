# Costo de infraestructura y punto de equilibrio

Se retiró el cálculo de USD 335/167 de valor del tiempo: no era un costo de ejecución. Este informe no asigna un salario, ahorro de trabajo ni costo económico a los errores del modelo.

## Referencia verificable

Fuentes primarias consultadas el **17 de noviembre de 2026**:

- [Runpod, RTX A5000](https://www.runpod.io/gpu-models/rtx-a5000): **Secure Cloud USD 0,27/GPU-hora**, 24 GB VRAM. La tarifa de Community Cloud es distinta; aquí no se mezclan las dos. Disponibilidad variable por región.
- [Runpod, tarifas](https://www.runpod.io/pricing) y [documentación de facturación](https://docs.runpod.io/pods/pricing): disco de contenedor y volumen de un Pod encendido, **USD 0,10/GB-mes** cada uno. La facturación de cómputo es por segundo; la transferencia de entrada/salida de Pods no tiene cargo según esa documentación.
- [Tipos de almacenamiento](https://docs.runpod.io/pods/storage/types): contenedor y volumen persistente son recursos separados. Al detener el Pod el volumen continúa cobrándose con otra tarifa; este cálculo corresponde a funcionamiento continuo.

No se contrató un servidor, no se ingresaron credenciales ni se incurrió en gasto. Esto es una cotización pública reproducible para una configuración explícita, no una factura ni una garantía de disponibilidad o precio regional final. Verificar precio e impuestos en checkout.

## Configuración presupuestada

Una GPU A5000, **30 días × 24 horas = 720 horas**, disco de contenedor de 10 GB y volumen persistente de 20 GB. Los tamaños son recursos elegidos para presupuestar y guardar ambos modelos; no se presentan como consumo observado. La cuota de almacenamiento usa su precio nominal por GB-mes; la factura real prorratea por segundo según las condiciones del proveedor.

| Concepto | Operación | USD |
| --- | --- | ---: |
| GPU | 720 × 0,27 | 194,40 |
| Contenedor | 10 × 0,10 | 1,00 |
| Volumen | 20 × 0,10 | 2,00 |
| **Infraestructura cotizada** | | **197,40** |

**Qwen y Gemma pagan la misma renta** si se ejecutan alternativamente en esta misma configuración. No se aplica la tarifa A5000 a los segundos medidos en la RTX 4050 de la laptop: son equipos diferentes. Un servidor encendido se cobra también mientras está ocioso.

## Precio solicitado por el usuario: USD 5/cliente/mes

`clientes para cubrir infraestructura = techo(197,40 / 5) = 40`.

- 39 clientes: ingresos de USD 195; faltan USD 2,40 para cubrir infraestructura.
- 40 clientes: ingresos de USD 200; quedan **USD 2,60 antes de costos no cotizados**.
- 50 clientes: ingresos de USD 250; quedan USD 52,60 antes de esos costos.

Esto **no certifica rentabilidad del negocio**. Comisiones de cobro, impuestos no recuperables, operación humana, adquisición, respaldos y otros servicios no están cotizados. Se dejan `null`, en vez de inventar cifras o tratarlos como cero.

Con datos reales adicionales:

`margen por cliente = precio − comisión porcentual − comisión fija − costo variable por cliente`

`clientes para equilibrio = techo((infraestructura + fijos adicionales + impuestos) / margen por cliente)`

Si el margen por cliente es cero o negativo, no hay punto de equilibrio finito. Para beneficio **estrictamente positivo**, usar `piso(costo fijo / margen) + 1`: cuando el cociente es entero, cubrir costos y obtener beneficio requieren cantidades distintas.

## Cuántos correos incluir

La renta es fija dentro de la capacidad del servidor. La cantidad sostenible no se deriva del precio de venta: exige medir el flujo real en **esa A5000**, incluyendo cargas, espera, reintentos y concurrencia. La prueba disponible es de una laptop diferente.

Tras medir `t_cloud`, una cota ideal sería `segundos disponibles / (clientes × t_cloud)`. No es un SLA ni un límite comercial seguro: no reserva holgura ni modela picos. El simulador deja la cuota sin cifra hasta tener medición; no vende correos ilimitados ni traslada los tiempos de la laptop.

## Trazabilidad

## Comparar estrategias de encendido

La gráfica permite seleccionar tres propuestas. `strategies.json` separa tarifas verificadas de escenarios editables; `execution-strategies.csv` guarda los cálculos base.

| Estrategia | GPU + discos por mes | Condición |
| --- | ---: | --- |
| Pod 24/7 | USD 197,40 | 720 horas; mismo presupuesto original |
| Pod 8 h × 22 días | USD 51,28 | Solo atiende en ese horario; 176 horas facturadas, arranques incluidos en la ventana |
| Serverless Flex, 40 usuarios | Desde USD 9,90, incompleto | Límite inferior sin arranque: 100 solicitudes/usuario/mes, respuesta supuesta de 3,88 s y 5 s de espera; no permite concluir un mínimo de usuarios |

El horario factura contenedor únicamente encendido; el volumen persistente cobra USD 0,10/GB-mes encendido y USD 0,20 apagado, prorrateados en el mes nominal de 30 días. No se supone almacenamiento gratis al detener la GPU.

Para Flex se usa el precio público equivalente **USD 0,75/h** del grupo de 24 GB (A5000/L4/3090/MIG). Es una tarifa distinta de Pods. La [documentación Serverless](https://docs.runpod.io/serverless/pricing) indica que se factura desde inicio hasta parada, redondeando segundos, e incluye carga del modelo, ejecución e idle timeout. Los segundos del slider representan el total facturado asignado a una solicitud, incluidos reintentos; no son la latencia de la laptop. La agrupación de peticiones puede amortizar las cargas, sin que eso esté medido aquí.

Se reserva almacenamiento de red de 20 GB a USD 0,07/GB-mes (USD 1,40) más un presupuesto superior de un mes completo de contenedor de 10 GB por worker mínimo ideal (USD 1 por worker). Su factura real depende de la vida del worker y los intervalos de almacenamiento. La referencia mínima de workers usa GPU-horas totales / 720 y no certifica atención de picos ni un SLA. No incluye servicios externos, pagos, impuestos ni operación.

El usuario fija la respuesta media supuesta en 3,88 s. Se mantiene el control de solicitudes y se añade un campo numérico para explorar el arranque, vacío inicialmente porque no se ha medido en la GPU alquilada. El mínimo de usuarios queda «Por medir». La curva sin ese dato se etiqueta como límite inferior, nunca como costo completo.

Para solicitudes aisladas que activan y apagan el worker cada vez: `segundos facturados = ceil(arranque + 3,88 + 5)`. El costo de cómputo mensual es `usuarios × solicitudes/usuario × segundos facturados × 0,75 / 3600`. Se suma el presupuesto de almacenamiento descrito arriba. Runpod cobra la carga del modelo en GPU; la descarga de imágenes y modelos en caché normalmente ocurre fuera de la fase facturada. No se supone que toda descarga tenga siempre costo de GPU.

Ejemplo hipotético, **no medido**: introducir 60 s de arranque implica 69 s facturados por solicitud. Con 100 solicitudes por usuario y 40 usuarios: USD 57,50 de cómputo + USD 2,40 de discos = USD 59,90. Con 1.000 solicitudes por usuario: USD 575 de cómputo + USD 3,40 de discos presupuestados para dos workers mínimos = USD 578,40; cada usuario consume más cómputo que su pago de USD 5. Los CSV incluyen el tiempo de arranque, la hipótesis de una activación por solicitud y `cost_is_lower_bound` para impedir interpretar cifras incompletas como facturas completas.

Agrupar solicitudes amortiza una carga entre varias peticiones, pero requiere medir sesiones, esperas y concurrencia. En alquiler fijo, el arranque está dentro de las horas pagadas y reduce la ventana de atención; no se vuelve a sumar como un cobro independiente. Ninguno de estos cálculos certifica capacidad ni rentabilidad total.

Las tres propuestas se simulan; no se implementó autoscaling ni se contrató un servidor. Fuentes: [tarifas de GPU](https://www.runpod.io/pricing), [Pods](https://docs.runpod.io/pods/pricing), [Serverless](https://docs.runpod.io/serverless/pricing), verificadas el 17/11/2026.

## Archivos generados

`cost-inputs.json` separa tarifa publicada, configuración elegida, precio elegido por el usuario y datos faltantes. `npm run benchmark:report` genera `infrastructure-costs.csv`, `cashflow.csv`, `sensitivity.csv` y `costs.json`. La sensibilidad ±20 %/±50 % es una variación matemática de precio o tarifa; no una nueva cotización. Los registros de calidad y `data/feedback.csv` permanecen intactos.
