export const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "https://dqs1fxxxb0c68.cloudfront.net",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Max-Age":       "300",
};

export const respond = (statusCode, body) => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(body),
});

export function parseBody(event) {
  try {
    return JSON.parse(event.body ?? "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { name: "ParseError", statusCode: 400 });
  }
}

export function requireField(obj, field) {
  if (!obj?.[field])
    throw Object.assign(new Error(`Missing field: ${field}`), { name: "ValidationError", statusCode: 422 });
}

export function requireParam(event, param) {
  const value = event.queryStringParameters?.[param];
  if (!value)
    throw Object.assign(new Error(`Missing query parameter: ${param}`), { name: "ValidationError", statusCode: 422 });
  return value;
}

export function handleError(tag, err) {
  console.error(`[${tag}]`, err);
  const statusCode = err.statusCode
    ?? (err.name === "DuplicateSessionError" ? 409 : 500);
  return respond(statusCode, { error: err.message, code: err.name });
}
