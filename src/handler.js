import { respond, handleError } from "./lib/http.js";
import { CircuitController } from "./controllers/CircuitController.js";
import { DeviceController }  from "./controllers/DeviceController.js";
import { StintController }   from "./controllers/StintController.js";

const circuits = new CircuitController();
const devices  = new DeviceController();
const stints   = new StintController();

function extractCognitoUserId(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (claims?.sub) return claims.sub;

  const token = (event.headers?.Authorization ?? event.headers?.authorization)?.split(" ")[1];
  if (!token) return null;

  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub ?? null;
  } catch {
    return null;
  }
}

async function route(controller, method, event, uid) {
  const fn = controller[method.toLowerCase()];
  if (!fn) return respond(405, { error: "Method not allowed" });
  try {
    const data = await fn.call(controller, event, uid);
    return respond(200, data);
  } catch (err) {
    return handleError(method, err);
  }
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod;
  if (method === "OPTIONS") return respond(200, {});

  const uid = extractCognitoUserId(event);
  if (!uid) return respond(401, { error: "Missing or invalid Authorization token" });

  const path = event.requestContext?.http?.path ?? event.path ?? "";

  if (path.endsWith("/circuits"))  return route(circuits, method, event, uid);
  if (path.endsWith("/devices"))   return route(devices,  method, event, uid);
  if (path.endsWith("/telemetry")) return route(stints,   method, event, uid);

  return respond(405, { error: "Method not allowed" });
};
