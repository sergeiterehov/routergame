import { parseIPv4, SEC, validate_ip } from "../format";
import type { OS } from "../os/os";
import { format_net_error } from "./app.lib";

const _HOSTS_PATH = "/etc/hosts";
const _RESOLVE_PATH = "/etc/resolv.conf";
const _DNS_PORT = 53;

const _DNS_COMPRESSED_NAME_MARKER = 0xc0;

const _DNS_FLAGS = {
  /** QR ? Response : Query */
  QR: 0x8000,
  OPCODE: 0x7800,
  AA: 0x0400,
  TC: 0x0200,
  RD: 0x0100,
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

function pack_dns_name(name: string): Uint8Array {
  const request = new Uint8Array(256);
  const $ = new DataView(request.buffer, request.byteOffset);

  const segments = name.split(".");

  let offset = 0;
  for (const segment of segments) {
    $.setUint8(offset++, segment.length);
    const bytes = new TextEncoder().encode(segment);
    request.set(bytes, offset);
    offset += bytes.length;
  }

  return request.subarray(0, offset);
}

function unpack_dns_name(data: Uint8Array, offset: number): { name: string; offset: number; string_offset: number } {
  let string_offset = offset;
  const _first_offset = offset;
  const _first_length = data[_first_offset];

  if (_first_length === _DNS_COMPRESSED_NAME_MARKER) {
    offset = data[_first_offset + 1];
    string_offset = offset;
  }

  const _segments: string[] = [];
  for (;;) {
    const length = data[offset++];
    const _segment = data.subarray(offset, offset + length);
    offset += length;
    _segments.push(new TextDecoder().decode(_segment));
    if (length === 0) break;
  }

  if (_first_length === _DNS_COMPRESSED_NAME_MARKER) {
    offset = _first_offset + 2;
  }

  return { name: _segments.join("."), offset, string_offset };
}

export const DNS_CLASSES = {
  IN: 1,
} as const;

export const DNS_TYPES = {
  A: 1,
  NS: 2,
  PTR: 12,
  CNAME: 5,
  TXT: 16,
  ANY: 255,
} as const;

export type TDnsRecord = {
  type: number;
  class: number;
  ttl: number;
  name: string;
  text: string;
  expired_at: number;
};

export async function resolve_dns(
  os: OS,
  name: string,
  type: number,
  dns?: number,
  signal?: AbortSignal,
): Promise<TDnsRecord[]> {
  const records: TDnsRecord[] = [];

  if (signal?.aborted) throw new Error("Aborted");

  if (os.fs.exists(_HOSTS_PATH)) {
    const hosts = os.fs.read(_HOSTS_PATH).split("\n");

    for (let line of hosts) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith("#")) continue;

      const [ip, ...names] = line.split(/\s+/);
      if (!names.includes(name)) continue;
      if (!validate_ip(ip)) continue;

      records.push({ class: DNS_CLASSES.IN, type, name, text: ip, ttl: 0, expired_at: 0 });
    }

    if (records.length) return records;
  }

  if (!dns) {
    if (!os.fs.exists(_RESOLVE_PATH)) throw new Error(`${_RESOLVE_PATH} not found`);

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

  if (!dns) throw new Error("No DNS server found");

  const socket = os.net.socket.create("udp");

  try {
    let err = 0;

    err = os.net.socket.connect(socket, dns, _DNS_PORT);
    if (err) throw new Error(`Failed to connect to DNS server: ${format_net_error(err)}`);

    const request = new Uint8Array(512);
    const packed_name = pack_dns_name(name);

    const id = Math.round(Math.random() * 0xffff);

    {
      const $ = new DataView(request.buffer, request.byteOffset);

      const flags = _DNS_FLAGS.RD;
      const q_count = 1;
      const q_type = type;
      const q_class = DNS_CLASSES.IN;

      $.setUint16(0, id);
      $.setUint16(2, flags);
      $.setUint16(4, q_count);

      let offset = 12;
      request.set(packed_name, offset);
      offset += packed_name.length;
      $.setUint16(offset, q_type);
      offset += 2;
      $.setUint16(offset, q_class);
      offset += 2;

      err = os.net.socket.send(socket, request.subarray(0, offset));
      if (err) throw new Error(`Failed to send request: ${format_net_error(err)}`);
    }

    for (;;) {
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

      const $ = new DataView(response.buffer, response.byteOffset);
      const _id = $.getUint16(0);
      if (_id !== id) continue;

      const flags = $.getUint16(2);
      if (flags & _DNS_FLAGS.RCODE_SERVFAIL) throw new Error("DNS Server failed");

      const now = Date.now();

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
        const _name = unpack_dns_name(response, offset);
        offset = _name.offset;
        const name = _name.name;
        const a_type = $.getUint16(offset);
        offset += 2;
        const a_class = $.getUint16(offset);
        offset += 2;
        const ttl = $.getUint32(offset);
        offset += 4;
        const rd_length = $.getUint16(offset);
        offset += 2;
        const rd_data_offset = offset;
        const rd_data = response.subarray(rd_data_offset, rd_data_offset + rd_length);
        offset += rd_length;
        // DO NOT CONTINUE BEFORE THIS LINE

        if (a_class !== DNS_CLASSES.IN) continue;

        const record: TDnsRecord = {
          class: a_class,
          type: a_type,
          name,
          ttl,
          expired_at: now + ttl * SEC,
          text: "",
        };

        if (a_type === DNS_TYPES.A) {
          record.text = rd_data.join(".");
        } else if (a_type === DNS_TYPES.TXT) {
          record.text = new TextDecoder().decode(rd_data);
        } else if (a_type === DNS_TYPES.PTR) {
          record.text = unpack_dns_name(response, rd_data_offset).name;
        }

        records.push(record);
      }

      break;
    }
  } finally {
    os.net.socket.close(socket);
  }

  return records;
}

export function answer_dns(request: Uint8Array, on_name: (name: string, type: number) => TDnsRecord[]): Uint8Array {
  const $req = new DataView(request.buffer, request.byteOffset);

  const id = $req.getUint16(0);

  let req_offset = 12;

  try {
    // const q_flags = $req.getUint16(2);
    const q_count = $req.getUint16(4);

    const response = new Uint8Array(2048);
    const $ = new DataView(response.buffer);

    $.setUint16(0, id);

    const flags = _DNS_FLAGS.QR | _DNS_FLAGS.RD | _DNS_FLAGS.RA;
    $.setUint16(2, flags);

    $.setUint16(4, q_count);

    const questions: { name: string; type: number; class: number; name_offset: number }[] = [];
    for (let i = 0; i < q_count; i++) {
      const _name = unpack_dns_name(request, req_offset);
      const name = _name.name;
      req_offset = _name.offset;
      const q_type = $req.getUint16(req_offset);
      req_offset += 2;
      const q_class = $req.getUint16(req_offset);
      req_offset += 2;
      questions.push({ name, type: q_type, class: q_class, name_offset: _name.string_offset });
    }

    response.set(request.subarray(12, req_offset), 12);
    let res_offset = req_offset;
    let a_count = 0;

    for (const question of questions) {
      if (question.class !== DNS_CLASSES.IN) continue;

      const records = on_name(question.name, question.type);
      for (const record of records) {
        if (record.class !== DNS_CLASSES.IN) continue;
        if (record.type !== question.type) continue;
        if (record.name !== question.name) continue;

        a_count += 1;

        $.setUint8(res_offset, 0xc0);
        res_offset += 1;
        $.setUint8(res_offset, question.name_offset);
        res_offset += 1;
        $.setUint16(res_offset, record.type);
        res_offset += 2;
        $.setUint16(res_offset, record.class);
        res_offset += 2;
        $.setUint32(res_offset, record.ttl);
        res_offset += 4;

        if (record.type === DNS_TYPES.A) {
          const ip_data = record.text.split(".").map((x) => parseInt(x));
          $.setUint16(res_offset, ip_data.length);
          res_offset += 2;
          response.set(ip_data, res_offset);
          res_offset += ip_data.length;
        } else if (record.type === DNS_TYPES.PTR) {
          const name = pack_dns_name(record.text);
          $.setUint16(res_offset, name.length);
          res_offset += 2;
          response.set(name, res_offset);
          res_offset += name.length;
        } else {
          const data = new TextEncoder().encode(record.text);
          $.setUint16(res_offset, data.length);
          res_offset += 2;
          response.set(data, res_offset);
          res_offset += data.length;
        }
      }
    }

    $.setUint16(6, a_count);

    return response.subarray(0, res_offset);
  } catch {
    const error = new Uint8Array(12);
    const $ = new DataView(error.buffer, error.byteOffset);
    $.setUint16(0, id);
    $.setUint16(2, _DNS_FLAGS.QR | _DNS_FLAGS.RCODE_SERVFAIL);

    return error;
  }
}

export async function get_hostname_ip(
  os: OS,
  hostname: string,
  dns?: number,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const records = await resolve_dns(os, hostname, DNS_TYPES.A, dns, signal);

  for (const record of records) {
    if (record.type === DNS_TYPES.A && record.class === DNS_CLASSES.IN && record.name === hostname) {
      return parseIPv4(record.text);
    }
  }
}
