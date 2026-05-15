import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo, TABLE } from "../lib/dynamo.js";

export class CircuitService {
  async getAll() {
    const { Items } = await dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "mainkey = :pk AND begins_with(mainsort, :prefix)",
      ExpressionAttributeValues: { ":pk": "CIRCUITS", ":prefix": "CIRCUIT#" },
    }));
    return (Items ?? []).map(CircuitService.toDto);
  }

  async create({ name, location, lengthKm, lat, lon, radiusM, minSpeedKmh, minLapMs }) {
    const item = {
      mainkey:  "CIRCUITS",
      mainsort: `CIRCUIT#${name}`,
      name,
      location:  location  ?? "",
      lengthKm:  lengthKm  ?? 0,
      ...(lat         != null && { lat }),
      ...(lon         != null && { lon }),
      ...(radiusM     != null && { radiusM }),
      ...(minSpeedKmh != null && { minSpeedKmh }),
      ...(minLapMs    != null && { minLapMs }),
    };
    await dynamo.send(new PutCommand({ TableName: TABLE, Item: item }));
    return CircuitService.toDto(item);
  }

  async update({ oldSk, ...data }) {
    const newSk = `CIRCUIT#${data.name}`;
    if (oldSk && oldSk !== newSk)
      await dynamo.send(new DeleteCommand({ TableName: TABLE, Key: { mainkey: "CIRCUITS", mainsort: oldSk } }));
    return this.create(data);
  }

  async delete(sk) {
    await dynamo.send(new DeleteCommand({ TableName: TABLE, Key: { mainkey: "CIRCUITS", mainsort: sk } }));
  }

  static toDto({ mainsort, name, location, lengthKm, lat, lon, radiusM, minSpeedKmh, minLapMs }) {
    return { id: mainsort, name, location, lengthKm, lat, lon, radiusM, minSpeedKmh, minLapMs };
  }
}
