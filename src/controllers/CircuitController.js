import { parseBody, requireField, requireParam } from "../lib/http.js";
import { CircuitService } from "../services/CircuitService.js";

const svc = new CircuitService();

export class CircuitController {
  async get(_event) {
    const circuits = await svc.getAll();
    return { circuits };
  }

  async post(event) {
    const body = parseBody(event);
    requireField(body, "name");
    return svc.create(body);
  }

  async put(event) {
    const oldSk = requireParam(event, "sk");
    const body  = parseBody(event);
    requireField(body, "name");
    return svc.update({ oldSk, ...body });
  }

  async delete(event) {
    const sk = requireParam(event, "sk");
    await svc.delete(sk);
    return { ok: true };
  }
}
