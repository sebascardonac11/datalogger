import { requireParam } from "../lib/http.js";
import { StintService } from "../services/StintService.js";

const svc = new StintService();

function parseStintBody(event) {
  const raw = (event.body ?? "").trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))               return { records: parsed, circuit: null };
    if (Array.isArray(parsed?.records))      return { records: parsed.records, circuit: parsed.circuit ?? null };
  } catch { /* fall through to NDJSON */ }

  const records = raw.split("\n").map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
  return { records, circuit: null };
}

export class StintController {
  async get(event, uid) {
    const { sk, date } = event.queryStringParameters ?? {};
    if (sk) {
      const stint = await svc.getOne(uid, sk);
      if (!stint) throw Object.assign(new Error("Stint not found"), { statusCode: 404 });
      return stint;
    }
    const stints = await svc.getAll(uid, date);
    return { stints };
  }

  async post(event, uid) {
    const deviceId = requireParam(event, "device_id");
    const racer    = event.queryStringParameters?.racer ?? "unknown";
    const { records, circuit } = parseStintBody(event);

    if (!records.length)
      throw Object.assign(new Error("Session contains no records"), { statusCode: 422 });

    return svc.register(uid, deviceId, racer, records, circuit);
  }
}
