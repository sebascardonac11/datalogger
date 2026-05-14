import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
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

    const PK = `RACER#${cognitoUserId}`;
    const SK = `STINT#${timestamp}#${stintId}`;
    const s3Key = `${cognitoUserId}/${date}/${SK}.json`;

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
            PK,
            SK,
            device_id: deviceId,
            racer,
            date,
            uploaded_at: now.toISOString(),
            record_count: records.length,
            s3_key: s3Key,
            records,
          },
        })
      ),
    ]);

    console.log(`[TELEMETRIA] PK=${PK} SK=${SK} records=${records.length}`);

    return { PK, SK, records: records.length };
  }
}
