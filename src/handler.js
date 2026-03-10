/**
 * Lambda que recibe datos de telemetria del ESP32 via POST
 * y los almacena en S3.
 *
 * Variables de entorno requeridas:
 *   BUCKET — nombre del bucket S3 destino
 *
 * Query parameter requerido:
 *   device_id — identificador unico del dispositivo (ej: ESP32_AABBCCDDEEFF)
 *
 * Body (JSON):
 * {
 *   "millis": 123456,
 *   "b":      "85.2",
 *   "t":      75.3,
 *   "r":      3200,
 *   "p1":     120,
 *   "p2":     145,
 *   "time":   "12:34",
 *   "date":   "06/03/2026 12:34:56",
 *   "lat":    "4.123456",
 *   "lon":    "-74.123456",
 *   "speed":  55.3
 * }
 *
 * Objeto S3 generado:
 *   {device_id}/{YYYY-MM-DD}/{timestamp}.json
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

  let body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "JSON invalido" }),
    };
  }

  console.log("[TELEMETRIA] device_id:", deviceId);
  console.log("[TELEMETRIA] Dato recibido:", JSON.stringify(body, null, 2));

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const key = `${deviceId}/${date}/${now.getTime()}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET,
      Key: key,
      Body: JSON.stringify(body),
      ContentType: "application/json",
    })
  );

  console.log("[TELEMETRIA] Guardado en S3:", key);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, key }),
  };
};
