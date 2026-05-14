import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";

const TABLE = "telemetryDB";

export class TelemetryService {
  constructor() {
    this.s3 = new S3Client();
    this.dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());
  }

  async registerStint({ cognitoUserId, deviceId, racer, records }) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const timestamp = now.getTime();

    const stintId = createHash("sha256")
      .update(`${deviceId}#${timestamp}`)
      .digest("hex")
      .slice(0, 12);

    const mainkey = `RACER#${cognitoUserId}`;
    const mainsort = `STINT#${timestamp}#${stintId}`;
    const s3Key = `${cognitoUserId}/${date}/${mainsort}.json`;
    const session_start = records[0]?.timestamp ?? null;

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
      ProjectionExpression: "mainkey, mainsort, device_id, racer, #d, session_start, uploaded_at, record_count, s3_key",
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
