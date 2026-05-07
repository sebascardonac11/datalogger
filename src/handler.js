import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";

const s3 = new S3Client();
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());
const TABLE = "telemetryDB";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://dqs1fxxxb0c68.cloudfront.net",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export const handler = async (event) => {
  const deviceId = event.queryStringParameters?.device_id;

  if (!deviceId) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
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
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Body invalido: se esperaba NDJSON o JSON array" }),
    };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return {
      statusCode: 422,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "La sesion no contiene registros" }),
    };
  }

  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  // SESSION: deterministic por device+fecha → misma sesion durante todo el dia
  const sessionHash = createHash("sha256")
    .update(`${deviceId}#${date}`)
    .digest("hex")
    .slice(0, 12);
  const sessionKey = `SESSION-${sessionHash}`;

  // STINT: unico por carga (device + timestamp)
  const stintHash = createHash("sha256")
    .update(`${deviceId}#${now.getTime()}`)
    .digest("hex")
    .slice(0, 12);
  const stintKey = `STINT-${stintHash}`;

  const s3Key = `${deviceId}/${date}/${stintKey}.json`;

  await Promise.all([
    // Archivo completo en S3
    s3.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET,
        Key: s3Key,
        Body: JSON.stringify(records),
        ContentType: "application/json",
      })
    ),
    // Registro en DynamoDB
    dynamo.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          mainkey: stintKey,
          mainsort: sessionKey,
          device_id: deviceId,
          date,
          uploaded_at: now.toISOString(),
          record_count: records.length,
          s3_key: s3Key,
          records,
        },
      })
    ),
  ]);

  console.log(`[TELEMETRIA] device_id=${deviceId} stint=${stintKey} session=${sessionKey} records=${records.length}`);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      ok: true,
      mainkey: stintKey,
      mainsort: sessionKey,
      records: records.length,
    }),
  };
};
