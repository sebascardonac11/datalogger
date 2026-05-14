# datalogger
Endpoint para realizar gestion de la data que se gestiona en el vehiculo


Contexto del Modelo de Datos:
Actúa como un desarrollador Backend Senior experto en AWS DynamoDB. Estamos construyendo una aplicación de telemetría usando el patrón de Diseño de Tabla Única (Single-Table Design).

La tabla se estructura agrupando las entidades bajo el ID del piloto:
* Partition Key (PK): String con el formato PILOTO#{id_piloto}.
* Sort Key (SK): String que define la entidad y su ID (Ej: MOTO#{id}, SESSION#{id}, STINT#{timestamp}#{id}).

Regla estricta: No se deben hacer "Scans" ni cruces de tablas. Toda consulta de lectura debe ser un "Query" apuntando a la PK exacta y usando la condición begins_with() en la SK para filtrar la entidad.