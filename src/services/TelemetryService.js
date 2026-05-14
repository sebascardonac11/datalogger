import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";

const TABLE = "telemetryDB";

// Handles DD/MM/YYYY HH:mm:ss, ISO strings, Unix ms (>1e10) and Unix seconds
function parseTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts === "string") {
    const trimmed = ts.trim();
    const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy, hh, min, ss] = ddmmyyyy;
      return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`);
    }
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === "number") {
    return new Date(ts > 1e10 ? ts : ts * 1000);
  }
  return null;
}

class DuplicateSessionError extends Error {
  constructor(sessionStart) {
    super(`Ya existe una sesión registrada para ${sessionStart}`);
    this.name = "DuplicateSessionError";
  }
}

export class TelemetryService {
  constructor() {
    this.s3 = new S3Client();
    this.dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());
  }

  async registerStint({ cognitoUserId, deviceId, racer, records, circuit }) {
    const now = new Date();
    const uploadTs = now.getTime();

    const stintId = createHash("sha256")
      .update(`${deviceId}#${uploadTs}`)
      .digest("hex")
      .slice(0, 12);

    // Field can be named "timestamp" or "date" depending on device firmware
    const rawTs = records[0]?.timestamp ?? records[0]?.date ?? null;
    const sessionDate = parseTimestamp(rawTs) ?? now;
    const date = sessionDate.toISOString().slice(0, 10);
    const session_start = sessionDate.toISOString();
    const lap_count = new Set(records.map(r => r.lap ?? r.Lap ?? r.lap_number ?? 0)).size;

    const mainkey = `RACER#${cognitoUserId}`;
    const mainsort = `STINT#${uploadTs}#${stintId}`;
    const s3Key = `${cognitoUserId}/${date}/${mainsort}.json`;

    // Duplicate check: reject if session_start already exists for this racer
    const { Items: existing } = await this.dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "mainkey = :pk AND begins_with(mainsort, :prefix)",
      ExpressionAttributeValues: { ":pk": mainkey, ":prefix": "STINT#", ":ss": session_start },
      FilterExpression: "session_start = :ss",
      ProjectionExpression: "mainkey",
      Limit: 1,
    }));
    if (existing?.length > 0) throw new DuplicateSessionError(session_start);

    await Promise.all([
      this.s3.send(
        new PutObjectCommand({
          Bucket: process.env.BUCKET,
          Key: s3Key,
          Body: JSON.stringify(records),
          ContentType: "application/json",
        })
      ),
      this.dynamo.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            mainkey,
            mainsort,
            device_id: deviceId,
            racer,
            date,
            session_start,
            uploaded_at: now.toISOString(),
            lap_count,
            record_count: records.length,
            s3_key: s3Key,
            records,
            ...(circuit && {
              circuit_id:       circuit.id,
              circuit_name:     circuit.name,
              circuit_location: circuit.location,
              circuit_length_km: circuit.lengthKm,
              circuit_lat:      circuit.lat,
              circuit_lon:      circuit.lon,
              circuit_radius_m: circuit.radiusM,
            }),
          },
        })
      ),
    ]);

    console.log(`[TELEMETRIA] mainkey=${mainkey} mainsort=${mainsort} records=${records.length}`);

    return { mainkey, mainsort, records: records.length };
  }

  // Returns all stints for a racer, optionally filtered by date (session)
  async getStintsBySession({ cognitoUserId, date }) {
    const params = {
      TableName: TABLE,
      KeyConditionExpression: "mainkey = :pk AND begins_with(mainsort, :prefix)",
      ExpressionAttributeValues: { ":pk": `RACER#${cognitoUserId}`, ":prefix": "STINT#" },
      ProjectionExpression: "mainkey, mainsort, device_id, racer, #d, session_start, uploaded_at, lap_count, record_count, s3_key, circuit_id, circuit_name, circuit_location, circuit_length_km, circuit_lat, circuit_lon, circuit_radius_m",
      ExpressionAttributeNames: { "#d": "date" },
    };

    if (date) {
      params.FilterExpression = "#d = :date";
      params.ExpressionAttributeValues[":date"] = date;
    }

    const { Items } = await this.dynamo.send(new QueryCommand(params));
    return Items ?? [];
  }

  async createCircuit({ name, location, lengthKm, lat, lon, radiusM, minSpeedKmh, minLapMs }) {
    const item = {
      mainkey: "CIRCUITS",
      mainsort: `CIRCUIT#${name}`,
      name,
      location: location ?? "",
      lengthKm: lengthKm ?? 0,
    };
    if (lat       != null) item.lat         = lat;
    if (lon       != null) item.lon         = lon;
    if (radiusM   != null) item.radiusM     = radiusM;
    if (minSpeedKmh != null) item.minSpeedKmh = minSpeedKmh;
    if (minLapMs  != null) item.minLapMs    = minLapMs;

    await this.dynamo.send(new PutCommand({ TableName: TABLE, Item: item }));
    return { mainsort: item.mainsort };
  }

  async updateCircuit({ oldSk, name, location, lengthKm, lat, lon, radiusM, minSpeedKmh, minLapMs }) {
    const newSk = `CIRCUIT#${name}`;
    if (oldSk && oldSk !== newSk) {
      await this.dynamo.send(new DeleteCommand({
        TableName: TABLE,
        Key: { mainkey: "CIRCUITS", mainsort: oldSk },
      }));
    }
    return this.createCircuit({ name, location, lengthKm, lat, lon, radiusM, minSpeedKmh, minLapMs });
  }

  async deleteCircuit(sk) {
    await this.dynamo.send(new DeleteCommand({
      TableName: TABLE,
      Key: { mainkey: "CIRCUITS", mainsort: sk },
    }));
  }

  async getDevices({ cognitoUserId }) {
    const { Items } = await this.dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "mainkey = :pk AND begins_with(mainsort, :prefix)",
      ExpressionAttributeValues: { ":pk": `RACER#${cognitoUserId}`, ":prefix": "DEVICE#" },
    }));
    return (Items ?? []).map(item => ({
      id:   item.mainsort,
      mac:  item.mac,
      name: item.name,
      type: item.type,
    }));
  }

  async createDevice({ cognitoUserId, name, type, mac }) {
    if (!mac) throw Object.assign(new Error("Missing field: mac"), { name: "ValidationError" });
    const item = {
      mainkey: `RACER#${cognitoUserId}`,
      mainsort: `DEVICE#${mac}`,
      mac, name, type: type ?? "",
    };
    await this.dynamo.send(new PutCommand({ TableName: TABLE, Item: item }));
    return { mainsort: item.mainsort };
  }

  async updateDevice({ cognitoUserId, oldSk, name, type, mac }) {
    if (!mac) throw Object.assign(new Error("Missing field: mac"), { name: "ValidationError" });
    const newSk = `DEVICE#${mac}`;
    if (oldSk && oldSk !== newSk) {
      await this.dynamo.send(new DeleteCommand({
        TableName: TABLE,
        Key: { mainkey: `RACER#${cognitoUserId}`, mainsort: oldSk },
      }));
    }
    return this.createDevice({ cognitoUserId, name, type, mac });
  }

  async deleteDevice({ cognitoUserId, sk }) {
    await this.dynamo.send(new DeleteCommand({
      TableName: TABLE,
      Key: { mainkey: `RACER#${cognitoUserId}`, mainsort: sk },
    }));
  }

  async getCircuits() {
    const { Items } = await this.dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "mainkey = :pk AND begins_with(mainsort, :prefix)",
      ExpressionAttributeValues: { ":pk": "CIRCUITS", ":prefix": "CIRCUIT#" },
    }));
    return (Items ?? []).map(item => ({
      id: item.mainsort,
      name: item.name,
      location: item.location,
      lengthKm: item.lengthKm,
      lat: item.lat,
      lon: item.lon,
      radiusM: item.radiusM,
      minSpeedKmh: item.minSpeedKmh,
      minLapMs: item.minLapMs,
    }));
  }

  // Returns a single stint including its records
  async getStint({ cognitoUserId, sk }) {
    const { Item } = await this.dynamo.send(
      new GetCommand({
        TableName: TABLE,
        Key: { mainkey: `RACER#${cognitoUserId}`, mainsort: sk },
      })
    );
    return Item ?? null;
  }
}
