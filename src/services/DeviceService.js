import { PutCommand, QueryCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo, TABLE } from "../lib/dynamo.js";

export class DeviceService {
  pk(uid) { return `RACER#${uid}`; }

  async getAll(uid) {
    const { Items } = await dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "mainkey = :pk AND begins_with(mainsort, :prefix)",
      ExpressionAttributeValues: { ":pk": this.pk(uid), ":prefix": "DEVICE#" },
    }));
    return (Items ?? []).map(({ mainsort, mac, name, type }) => ({ id: mainsort, mac, name, type }));
  }

  async create(uid, { name, type, mac }) {
    const item = { mainkey: this.pk(uid), mainsort: `DEVICE#${mac}`, mac, name, type: type ?? "" };
    await dynamo.send(new PutCommand({ TableName: TABLE, Item: item }));
    return { id: item.mainsort };
  }

  async update(uid, oldSk, { name, type, mac }) {
    if (oldSk !== `DEVICE#${mac}`)
      await dynamo.send(new DeleteCommand({ TableName: TABLE, Key: { mainkey: this.pk(uid), mainsort: oldSk } }));
    return this.create(uid, { name, type, mac });
  }

  async delete(uid, sk) {
    await dynamo.send(new DeleteCommand({ TableName: TABLE, Key: { mainkey: this.pk(uid), mainsort: sk } }));
  }

  // Busca el dueño de un device por su MAC. Usa Scan porque la MAC es sort key, no hay GSI.
  async findOwnerByMac(mac) {
    const { Items } = await dynamo.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "mainsort = :sk",
      ExpressionAttributeValues: { ":sk": `DEVICE#${mac}` },
      ProjectionExpression: "mainkey, mac, #n",
      ExpressionAttributeNames: { "#n": "name" },
    }));
    if (!Items?.length) return null;
    const uid = Items[0].mainkey.replace("RACER#", "");
    return { uid, mac: Items[0].mac, name: Items[0].name };
  }
}
