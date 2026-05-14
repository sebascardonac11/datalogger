import { TelemetryService } from "./services/TelemetryService.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://dqs1fxxxb0c68.cloudfront.net",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const service = new TelemetryService();

function extractCognitoUserId(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (claims?.sub) return claims.sub;

  const authHeader = event.headers?.Authorization ?? event.headers?.authorization;
  const token = authHeader?.split(" ")[1];
  if (!token) return null;

  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function parseRecords(rawBody) {
  const trimmed = (rawBody ?? "").trim();
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function handleGetCircuits() {
  try {
    const circuits = await service.getCircuits();
    return respond(200, { circuits });
  } catch (err) {
    console.error("[GET CIRCUITS ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handleGetDevices(cognitoUserId) {
  try {
    const devices = await service.getDevices({ cognitoUserId });
    return respond(200, { devices });
  } catch (err) {
    console.error("[GET DEVICES ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handlePostDevice(event, cognitoUserId) {
  let body;
  try { body = JSON.parse(event.body ?? "{}"); } catch { return respond(400, { error: "Invalid JSON body" }); }
  if (!body.name) return respond(422, { error: "Missing field: name" });
  if (!body.mac)  return respond(422, { error: "Missing field: mac" });
  try {
    const result = await service.createDevice({ cognitoUserId, ...body });
    return respond(200, { ok: true, ...result });
  } catch (err) {
    console.error("[POST DEVICE ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handlePutDevice(event, cognitoUserId) {
  const oldSk = event.queryStringParameters?.sk;
  if (!oldSk) return respond(422, { error: "Missing query parameter: sk" });
  let body;
  try { body = JSON.parse(event.body ?? "{}"); } catch { return respond(400, { error: "Invalid JSON body" }); }
  if (!body.name) return respond(422, { error: "Missing field: name" });
  if (!body.mac)  return respond(422, { error: "Missing field: mac" });
  try {
    const result = await service.updateDevice({ cognitoUserId, oldSk, ...body });
    return respond(200, { ok: true, ...result });
  } catch (err) {
    console.error("[PUT DEVICE ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handleDeleteDevice(event, cognitoUserId) {
  const sk = event.queryStringParameters?.sk;
  if (!sk) return respond(422, { error: "Missing query parameter: sk" });
  try {
    await service.deleteDevice({ cognitoUserId, sk });
    return respond(200, { ok: true });
  } catch (err) {
    console.error("[DELETE DEVICE ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handlePostCircuit(event) {
  let body;
  try { body = JSON.parse(event.body ?? "{}"); } catch { return respond(400, { error: "Invalid JSON body" }); }
  if (!body.name) return respond(422, { error: "Missing field: name" });
  try {
    const result = await service.createCircuit(body);
    return respond(200, { ok: true, ...result });
  } catch (err) {
    console.error("[POST CIRCUIT ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handlePutCircuit(event) {
  const oldSk = event.queryStringParameters?.sk;
  if (!oldSk) return respond(422, { error: "Missing query parameter: sk" });
  let body;
  try { body = JSON.parse(event.body ?? "{}"); } catch { return respond(400, { error: "Invalid JSON body" }); }
  if (!body.name) return respond(422, { error: "Missing field: name" });
  try {
    const result = await service.updateCircuit({ oldSk, ...body });
    return respond(200, { ok: true, ...result });
  } catch (err) {
    console.error("[PUT CIRCUIT ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handleDeleteCircuit(event) {
  const sk = event.queryStringParameters?.sk;
  if (!sk) return respond(422, { error: "Missing query parameter: sk" });
  try {
    await service.deleteCircuit(sk);
    return respond(200, { ok: true });
  } catch (err) {
    console.error("[DELETE CIRCUIT ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handleGet(event, cognitoUserId) {
  const { sk, date } = event.queryStringParameters ?? {};

  try {
    // GET /telemetria?sk=STINT%23... → specific stint with records
    if (sk) {
      const stint = await service.getStint({ cognitoUserId, sk });
      if (!stint) return respond(404, { error: "Stint not found" });
      return respond(200, stint);
    }

    // GET /telemetria?date=2026-05-14 → all stints of that session (no records)
    // GET /telemetria → all stints of the racer (no records)
    const stints = await service.getStintsBySession({ cognitoUserId, date });
    return respond(200, { stints });
  } catch (err) {
    console.error("[GET ERROR]", err);
    return respond(500, { error: err.message, code: err.name });
  }
}

async function handlePost(event, cognitoUserId) {
  const deviceId = event.queryStringParameters?.device_id;
  const racer = event.queryStringParameters?.racer ?? "unknown";

  if (!deviceId) return respond(422, { error: "Missing query parameter: device_id" });

  let records;
  try {
    records = parseRecords(event.body);
  } catch {
    return respond(400, { error: "Invalid body: expected NDJSON or JSON array" });
  }

  if (!Array.isArray(records) || records.length === 0) {
    return respond(422, { error: "Session contains no records" });
  }

  try {
    const result = await service.registerStint({ cognitoUserId, deviceId, racer, records });
    return respond(200, { ok: true, ...result });
  } catch (err) {
    console.error("[POST ERROR]", err);
    if (err.name === "DuplicateSessionError") return respond(409, { error: err.message });
    return respond(500, { error: err.message, code: err.name });
  }
}

export const handler = async (event) => {
  const cognitoUserId = extractCognitoUserId(event);
  if (!cognitoUserId) return respond(401, { error: "Missing or invalid Authorization token" });

  const method = event.requestContext?.http?.method ?? event.httpMethod;
  const path   = event.requestContext?.http?.path ?? event.path ?? "";

  if (path.endsWith("/dispositivos")) {
    if (method === "GET")    return handleGetDevices(cognitoUserId);
    if (method === "POST")   return handlePostDevice(event, cognitoUserId);
    if (method === "PUT")    return handlePutDevice(event, cognitoUserId);
    if (method === "DELETE") return handleDeleteDevice(event, cognitoUserId);
  }
  if (path.endsWith("/circuitos")) {
    if (method === "GET")    return handleGetCircuits();
    if (method === "POST")   return handlePostCircuit(event);
    if (method === "PUT")    return handlePutCircuit(event);
    if (method === "DELETE") return handleDeleteCircuit(event);
  }
  if (method === "GET") return handleGet(event, cognitoUserId);
  if (method === "POST") return handlePost(event, cognitoUserId);

  return respond(405, { error: "Method not allowed" });
};
