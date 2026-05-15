import { parseBody, requireField, requireParam } from "../lib/http.js";
import { DeviceService } from "../services/DeviceService.js";

const svc = new DeviceService();

export class DeviceController {
  async get(_event, uid) {
    const devices = await svc.getAll(uid);
    return { devices };
  }

  async post(event, uid) {
    const body = parseBody(event);
    requireField(body, "name");
    requireField(body, "mac");
    return svc.create(uid, body);
  }

  async put(event, uid) {
    const oldSk = requireParam(event, "sk");
    const body  = parseBody(event);
    requireField(body, "name");
    requireField(body, "mac");
    return svc.update(uid, oldSk, body);
  }

  async delete(event, uid) {
    const sk = requireParam(event, "sk");
    await svc.delete(uid, sk);
    return { ok: true };
  }
}
