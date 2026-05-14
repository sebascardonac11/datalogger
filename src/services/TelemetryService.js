import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";

const TABLE = "telemetryDB";

// Handles DD/MM/YYYY HH:mm:ss, ISO strings, Unix ms (>1e10) and Unix seconds
function parseTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts === "string") {
    const ddmmyyyy = ts.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy, hh, min, ss] = ddmmyyyy;
      return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`);
    }
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === "number") {
    return new Date(ts > 1e10 ? ts : ts * 1000);
  }
  return null;
}

export class TelemetryService {
  constructor() {
    this.s3 = new S3Client();
    this.dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());
  }

  async registerStint({ cognitoUserId, deviceId, racer, records }) {
    const now = new Date();
    const uploadTs = now.getTime();

    const stintId = createHash("sha256")
      .update(`${deviceId}#${uploadTs}`)
      .digest("hex")
      .slice(0, 12);

    // Parse the first record's timestamp into a real Date
    const sessionDate = parseTimestamp(records[0]?.timestamp) ?? now;
    const date = sessionDate.toISOString().slice(0, 10);
    const session_start = sessionDate.toISOString();
    const lap_count = new Set(records.map(r => r.lap ?? r.Lap ?? r.lap_number ?? 0)).size;

    const mainkey = `RACER#${cognitoUserId}`;
    const mainsort = `STINT#${uploadTs}#${stintId}`;
    const s3Key = `${cognitoUserId}/${date}/${mainsort}.json`;

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
      ProjectionExpression: "mainkey, mainsort, device_id, racer, #d, session_start, uploaded_at, lap_count, record_count, s3_key",
      ExpressionAttributeNames: { "#d": "date" },
    };

    if (date) {
      params.FilterExpression = "#d = :date";
      params.ExpressionAttributeValues[":date"] = date;
    }

    const { Items } = await this.dynamo.send(new QueryCommand(params));
    return Items ?? [];
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
