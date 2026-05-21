import { DeviceService } from "../services/DeviceService.js";
import { StintService }  from "../services/StintService.js";

const deviceSvc = new DeviceService();
const stintSvc  = new StintService();

function parseBody(event) {
  const raw = (event.body ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.records)) return parsed.records;
  } catch { /* fall through to NDJSON */ }
  return raw.split("\n").map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
}

export class DeviceUploadController {
  async post(event) {
    const params = event.queryStringParameters ?? {};
    const mac    = params.mac?.toUpperCase()?.trim();

    if (!mac) return { statusCode: 400, body: JSON.stringify({ error: "Falta parametro mac" }) };

    const device = await deviceSvc.findOwnerByMac(mac);
    if (!device) return { statusCode: 403, body: JSON.stringify({ error: "Dispositivo no registrado" }) };

    const records = parseBody(event);
    if (!records.length) return { statusCode: 422, body: JSON.stringify({ error: "Sin registros" }) };

    // El racer es el nombre con el que el dispositivo fue registrado en DynamoDB
    const result = await stintSvc.register(device.uid, mac, device.name ?? mac, records, null, null);
    return { statusCode: 200, body: JSON.stringify(result) };
  }
}
