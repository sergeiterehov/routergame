import z from "zod";
import type { OS } from "../os/os";
import { format_net_error } from "./app.lib";
import { answer_dns, DNS_CLASSES, DNS_TYPES, type TDnsRecord } from "./dns.lib";
import { SEC } from "../format";

const _DNS_PORT = 53;
const _RECORDS_PATH = "/dnsd/records";

const _DNS_NAME_TO_TYPE: Record<string, number> = {
  A: DNS_TYPES.A,
  NS: DNS_TYPES.NS,
  PTR: DNS_TYPES.PTR,
  TXT: DNS_TYPES.TXT,
  CNAME: DNS_TYPES.CNAME,
} as const;

const z_records = z.array(
  z.object({
    type: z.enum(Object.keys(_DNS_NAME_TO_TYPE)),
    name: z.string(),
    value: z.string(),
    ttl: z.number().optional(),
  }),
);

function _resolve_name(os: OS, name: string): TDnsRecord[] {
  if (!os.fs.exists(_RECORDS_PATH)) throw new Error(`Records file ${_RECORDS_PATH} not found`);

  const records = JSON.parse(os.fs.read(_RECORDS_PATH));

  try {
    return z_records
      .parse(records)
      .filter((r) => r.name === name)
      .map(
        (r): TDnsRecord => ({
          name: r.name,
          class: DNS_CLASSES.IN,
          type: _DNS_NAME_TO_TYPE[r.type],
          ttl: r.ttl ?? 60 * SEC,
          expired_at: 0,
          text: r.value,
        }),
      );
  } catch (e) {
    throw new Error(`Invalid records file ${_RECORDS_PATH}: ${e}`);
  }
}

export async function dnsd(os: OS, args: string[]) {
  if (args.length) throw new Error("No arguments expected");

  if (!os.fs.exists(_RECORDS_PATH)) throw new Error(`Records file ${_RECORDS_PATH} not found`);

  const socket = os.net.socket.create("udp");

  try {
    let err = 0;

    err = os.net.socket.bind(socket, 0, _DNS_PORT);
    if (err) throw new Error(`Failed to bind socket: ${format_net_error(err)}`);

    os.print("DNS server started\n");

    for (;;) {
      const req = await new Promise<Parameters<Exclude<typeof socket.on_recv, undefined>>[0]>((resolve, reject) => {
        socket.on_recv = resolve;
        socket.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
        socket.on_close = () => reject(new Error("Socket closed"));
      }).finally(() => {
        delete socket.on_recv;
        delete socket.on_error;
        delete socket.on_close;
      });

      try {
        const res = answer_dns(req.data, (name) => _resolve_name(os, name));

        err = os.net.socket.send_to(socket, req.ip, req.port, res);
        if (err) throw new Error(`Failed to send response: ${format_net_error(err)}`);
      } catch (e) {
        os.print(`[DNSd] [ERROR] ${e}\n`);
      }
    }
  } catch (e) {
    os.print(`[DNSd] [FATAL] ${e}\n`);
  } finally {
    os.net.socket.close(socket);
  }
}
