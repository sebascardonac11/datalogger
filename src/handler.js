import { TelemetryService } from "./services/TelemetryService.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://dqs1fxxxb0c68.cloudfront.net",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const service = new TelemetryService();

function extractCognitoUserId(event) {
  // Prefer JWT authorizer context (when API Gateway has a Cognito authorizer)
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (claims?.sub) return claims.sub;

  // Fall back to decoding the Authorization header manually
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

export const handler = async (event) => {
  const deviceId = event.queryStringParameters?.device_id;
  const racer = event.queryStringParameters?.racer ?? "unknown";
  const cognitoUserId = extractCognitoUserId(event);

  if (!deviceId) return respond(422, { error: "Missing query parameter: device_id" });
  if (!cognitoUserId) return respond(401, { error: "Missing or invalid Authorization token" });

  let records;
  try {
    records = parseRecords(event.body);
  } catch {
    return respond(400, { error: "Invalid body: expected NDJSON or JSON array" });
  }

  if (!Array.isArray(records) || records.length === 0) {
    return respond(422, { error: "Session contains no records" });
  }

  const result = await service.registerStint({ cognitoUserId, deviceId, racer, records });

  return respond(200, { ok: true, ...result });
};
