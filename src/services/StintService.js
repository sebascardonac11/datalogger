import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";
import { dynamo, TABLE } from "../lib/dynamo.js";

const STINT_PROJECTION = [
  "mainkey", "mainsort", "device_id", "racer", "#d", "session_start",
  "uploaded_at", "lap_count", "record_count", "s3_key",
  "circuit_id", "circuit_name", "circuit_location",
  "circuit_length_km", "circuit_lat", "circuit_lon", "circuit_radius_m",
].join(", ");

// Handles DD/MM/YYYY HH:mm:ss, ISO strings, Unix ms (>1e10) and Unix seconds
function parseTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts === "string") {
    const trimmed = ts.trim();
    const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (m) {
      const [, dd, MM, yyyy, hh, min, ss] = m;
      return new Date(`${yyyy}-${MM}-${dd}T${hh}:${min}:${ss}`);
    }
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === "number") return new Date(ts > 1e10 ? ts : ts * 1000);
  return null;
}

class DuplicateSessionError extends Error {
  constructor(sessionStart) {
    super(`Ya existe una sesión registrada para ${sessionStart}`);
    this.name = "DuplicateSessionError";
  }
}

export class StintService {
  s3 = new S3Client();

  async register(uid, deviceId, racer, records, circuit) {
    const now      = new Date();
    const uploadTs = now.getTime();
    const stintId  = createHash("sha256").update(`${deviceId}#${uploadTs}`).digest("hex").slice(0, 12);

    const rawTs        = records[0]?.timestamp ?? records[0]?.date ?? null;
    const sessionDate  = parseTimestamp(rawTs) ?? now;
    const date         = sessionDate.toISOString().slice(0, 10);
    const session_start = sessionDate.toISOString();
    const lap_count    = new Set(records.map(r => r.lap ?? r.Lap ?? r.lap_number ?? 0)).size;

    const mainkey  = `RACER#${uid}`;
    const mainsort = `STINT#${uploadTs}#${stintId}`;
    const s3Key    = `${uid}/${date}/${mainsort}.json`;

    const { Items: existing } = await dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "mainkey = :pk AND begins_with(mainsort, :prefix)",
      ExpressionAttributeValues: { ":pk": mainkey, ":prefix": "STINT#", ":ss": session_start },
      FilterExpression: "session_start = :ss",
      ProjectionExpression: "mainkey",
      Limit: 1,
    }));
    if (existing?.length > 0) throw new DuplicateSessionError(session_start);

    await Promise.all([
      this.s3.send(new PutObjectCommand({
        Bucket: process.env.BUCKET,
        Key: s3Key,
        Body: JSON.stringify(records),
        ContentType: "application/json",
      })),
      dynamo.send(new PutCommand({
        TableName: TABLE,
        Item: {
          mainkey, mainsort, device_id: deviceId, racer, date, session_start,
          uploaded_at: now.toISOString(), lap_count, record_count: records.length, s3_key: s3Key,
          records,
          ...(circuit && {
            circuit_id:        circuit.id,
            circuit_name:      circuit.name,
            circuit_location:  circuit.location,
            circuit_length_km: circuit.lengthKm,
            circuit_lat:       circuit.lat,
            circuit_lon:       circuit.lon,
            circuit_radius_m:  circuit.radiusM,
          }),
        },
      })),
    ]);

    console.log(`[STINT] mainkey=${mainkey} mainsort=${mainsort} records=${records.length}`);
    return { mainkey, mainsort, records: records.length };
  }

  async getAll(uid, date) {
    const params = {
      TableName: TABLE,
      KeyConditionExpression: "mainkey = :pk AND begins_with(mainsort, :prefix)",
      ExpressionAttributeValues: { ":pk": `RACER#${uid}`, ":prefix": "STINT#" },
      ProjectionExpression: STINT_PROJECTION,
      ExpressionAttributeNames: { "#d": "date" },
    };
    if (date) {
      params.FilterExpression = "#d = :date";
      params.ExpressionAttributeValues[":date"] = date;
    }
    const { Items } = await dynamo.send(new QueryCommand(params));
    return Items ?? [];
  }

  async getOne(uid, sk) {
    const { Item } = await dynamo.send(new GetCommand({
      TableName: TABLE,
      Key: { mainkey: `RACER#${uid}`, mainsort: sk },
    }));
    return Item ?? null;
  }
}
