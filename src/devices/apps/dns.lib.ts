import { parseIPv4, validate_ip } from "../format";
import type { OS } from "../os/os";
import { format_net_error } from "./app.lib";

const _HOSTS_PATH = "/etc/hosts";
const _RESOLVE_PATH = "/etc/resolv.conf";
const _DNS_PORT = 53;

const _DNS_COMPRESSED_NAME_MARKER = 0xc0;

const _DNS_FLAGS = {
  QR: 0x8000,
  QR_QUERY: 0x0000,
  QR_RESPONSE: 0x8000,
  OPCODE: 0x7800,
  AA: 0x0400,
  TC: 0x0200,
  RD: 0x0100,
  RD_RECURSIVE: 0x0100,
  RD_NO_RECURSIVE: 0x0000,
  RA: 0x0080,
  Z: 0x0040,
  AD: 0x0020,
  CD: 0x0010,
  RCODE: 0x000f,
  RCODE_NOERROR: 0,
  RCODE_FORMERR: 1,
  RCODE_SERVFAIL: 2,
  RCODE_NXDOMAIN: 3,
  RCODE_NOTIMP: 4,
  RCODE_REFUSED: 5,
} as const;

const _DNS_CLASSES = {
  IN: 1,
} as const;

const _DNS_TYPES = {
  A: 1,
  NS: 2,
  PTR: 12,
  CNAME: 5,
  TXT: 16,
  ANY: 255,
} as const;

export async function get_hostname_ip(os: OS, hostname: string, dns?: number, signal?: AbortSignal) {
  if (signal?.aborted) return;

  if (os.fs.exists(_HOSTS_PATH)) {
    const hosts = os.fs.read(_HOSTS_PATH).split("\n");

    for (let line of hosts) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith("#")) continue;

      const [ip, ...names] = line.split(/\s+/);
      if (!names.includes(hostname)) continue;
      if (!validate_ip(ip)) continue;

      return parseIPv4(ip);
    }
  }

  if (!dns) {
    if (!os.fs.exists(_RESOLVE_PATH)) return;

    const resolvers = os.fs.read(_RESOLVE_PATH).split("\n");

    for (let line of resolvers) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith("#")) continue;

      const [prop, resolver] = line.split(/\s+/);
      if (prop !== "nameserver") continue;
      if (!validate_ip(resolver)) continue;

      dns = parseIPv4(resolver);
    }
  }

  if (!dns) return;

  const socket = os.net.socket.create("udp");

  try {
    let err = 0;

    err = os.net.socket.connect(socket, dns, _DNS_PORT);
    if (err) return;

    const request = new Uint8Array(512);

    const segments = hostname.split(".");
    if (segments.at(-1) !== "") segments.push("");

    const id = Math.round(Math.random() * 0xffff);

    {
      const $ = new DataView(request.buffer, request.byteOffset);

      const flags = _DNS_FLAGS.QR_QUERY + _DNS_FLAGS.RD_RECURSIVE;
      const q_count = 1;
      const q_type = _DNS_TYPES.A;
      const q_class = _DNS_CLASSES.IN;

      $.setUint16(0, id);
      $.setUint16(2, flags);
      $.setUint16(4, q_count);

      let offset = 12;
      for (const segment of segments) {
        $.setUint8(offset++, segment.length);
        const bytes = new TextEncoder().encode(segment);
        request.set(bytes, offset);
        offset += bytes.length;
      }
      $.setUint16(offset, q_type);
      $.setUint16(offset + 2, q_class);
    }

    err = os.net.socket.send(socket, request);
    if (err) return;

    const response = await new Promise<Uint8Array>((resolve, reject) => {
      socket.on_recv = ({ data }) => resolve(data);
      socket.on_close = () => reject(new Error("Socket closed"));
      socket.on_error = (e) => reject(new Error(`Socket error: ${format_net_error(e)}`));
      if (signal) signal.onabort = () => reject(new Error("Aborted"));
    }).finally(() => {
      delete socket.on_recv;
      delete socket.on_close;
      delete socket.on_error;
      if (signal) signal.onabort = null;
    });

    {
      const $ = new DataView(response.buffer, response.byteOffset);
      const _id = $.getUint16(0);
      if (_id !== id) return;

      const flags = $.getUint16(2);
      if (!(flags & _DNS_FLAGS.QR_RESPONSE)) return;

      const q_count = $.getUint16(4);
      const an_count = $.getUint16(6);

      let offset = 12;
      for (let i = 0; i < q_count; i++) {
        for (;;) {
          const length = $.getUint8(offset++);
          offset += length;
          if (length === 0) break;
        }
        // const q_type = $.getUint16(offset);
        offset += 2;
        // const q_class = $.getUint16(offset);
        offset += 2;
      }

      for (let i = 0; i < an_count; i++) {
        const _first_offset = offset;
        const _first_length = $.getUint8(_first_offset);

        if (_first_length === _DNS_COMPRESSED_NAME_MARKER) {
          offset = $.getUint8(_first_offset + 1);
        }

        const _segments: string[] = [];
        for (;;) {
          const length = $.getUint8(offset++);
          const _segment = response.subarray(offset, offset + length);
          offset += length;
          if (length === 0) break;
          _segments.push(new TextDecoder().decode(_segment));
        }

        if (_first_length === _DNS_COMPRESSED_NAME_MARKER) {
          offset = _first_offset + 2;
        }

        const name = _segments.join(".");

        const a_type = $.getUint16(offset);
        offset += 2;
        const a_class = $.getUint16(offset);
        offset += 2;
        // const ttl = $.getUint32(offset);
        offset += 4;
        const rd_length = $.getUint16(offset);
        offset += 2;
        const rd_data = response.subarray(offset, offset + rd_length);
        offset += rd_length;

        if (a_class === _DNS_CLASSES.IN && a_type === _DNS_TYPES.A && name === hostname) {
          return new DataView(rd_data.buffer, rd_data.byteOffset).getUint32(0);
        }
      }
    }
  } catch {
    return;
  } finally {
    os.net.socket.close(socket);
  }
}
