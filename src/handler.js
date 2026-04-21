/**
 * Lambda que recibe una sesion completa de telemetria del ESP32 via POST
 * y la almacena como un unico archivo JSON en S3.
 *
 * Variables de entorno requeridas:
 *   BUCKET — nombre del bucket S3 destino
 *
 * Query parameters requeridos:
 *   device_id  — identificador unico del dispositivo (ej: ESP32_AABBCCDDEEFF)
 *
 * Query parameters opcionales:
 *   session_id — nombre de la sesion (ej: carrera_01). Si no se envia, se usa el timestamp.
 *
 * Body: archivo NDJSON (una linea por punto de telemetria) o JSON array
 *
 * Objeto S3 generado:
 *   {device_id}/{YYYY-MM-DD}/{session_id}.json
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client();

export const handler = async (event) => {
  const deviceId = event.queryStringParameters?.device_id;

  if (!deviceId) {
    return {
      statusCode: 422,
      body: JSON.stringify({ error: "Falta query parameter device_id" }),
    };
  }

  const rawBody = event.body ?? "";

  let records;
  try {
    const trimmed = rawBody.trim();
    if (trimmed.startsWith("[")) {
      records = JSON.parse(trimmed);
    } else {
      records = trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
    }
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Body invalido: se esperaba NDJSON o JSON array" }),
    };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return {
      statusCode: 422,
      body: JSON.stringify({ error: "La sesion no contiene registros" }),
    };
  }

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const sessionId = event.queryStringParameters?.session_id ?? now.getTime().toString();
  const key = `${deviceId}/${date}/${sessionId}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET,
      Key: key,
      Body: JSON.stringify(records),
      ContentType: "application/json",
    })
  );

  console.log(`[TELEMETRIA] device_id=${deviceId} session=${sessionId} records=${records.length} key=${key}`);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, key, records: records.length }),
  };
};
