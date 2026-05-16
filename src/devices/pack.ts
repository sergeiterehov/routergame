export type TEthernetFrame = {
  dst: bigint;
  src: bigint;
  tag?: {
    pcp: number;
    dei: number;
    vid: number;
  };
  etherType: number;
  payload: Uint8Array;
};

export const IP_PROTOCOLS = {
  ICMP: 1,
  TCP: 6,
  UDP: 17,
} as const;

export const MAC_BROADCAST = 0xffffffffffffn;
export const IP_BROADCAST = 0xffffffff;

const ETHER_TAG = 0x8100;

export const ETHER_TYPES = {
  IPv4: 0x0800,
  ARP: 0x0806,
  IPv6: 0x86dd,
} as const;

export const ARP_OPCODES = {
  REQUEST: 0x0001,
  REPLY: 0x0002,
} as const;

export const ICMP_TYPES = {
  ECHO_REPLY: 0,
  ECHO_REQUEST: 8,
  DEST_UNREACHABLE: 3,
  TIME_EXCEEDED: 11,
} as const;

export const TCP_FLAGS = {
  FIN: 0x01,
  SYN: 0x02,
  ACK: 0x10,
  PSH: 0x08,
  URG: 0x20,
  RST: 0x04,
  ALL: 0x3f,
  NONE: 0x00,
} as const;

export const DHCP_OPS = {
  REQUEST: 1,
  REPLY: 2,
} as const;

export const DHCP_OPTIONS = {
  PADDING: 0x00,
  SUBNET_MASK: 0x01,
  ROUTER: 0x03,
  DNS_SERVER: 0x06,
  REQUESTED_IP: 0x32,
  LEASE_TIME: 0x33,
  MESSAGE_TYPE: 0x35,
  SERVER_ID: 0x36,
  PARAM_REQUEST: 0x37,
  END: 0xff,
} as const;

export const DHCP_TYPES = {
  DISCOVER: 1,
  OFFER: 2,
  REQUEST: 3,
  DECLINE: 4,
  ACK: 5,
  NAK: 6,
  RELEASE: 7,
  INFORM: 8,
} as const;

export function uint8(n: number) {
  return new Uint8Array([n & 0xff]);
}

export function uint32(n: number) {
  return new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

export function mac_to_bytes(mac: bigint) {
  return new Uint8Array([
    Number((mac >> 40n) & 0xffn),
    Number((mac >> 32n) & 0xffn),
    Number((mac >> 24n) & 0xffn),
    Number((mac >> 16n) & 0xffn),
    Number((mac >> 8n) & 0xffn),
    Number(mac & 0xffn),
  ]);
}

export function extract_ip_ports(packet: TIP4Packet) {
  const $ = new DataView(packet.payload.buffer, packet.payload.byteOffset);

  return {
    src: $.getUint16(0),
    dst: $.getUint16(2),
  };
}

export function inject_ip_ports(packet: TIP4Packet, ports: { src?: number; dst?: number }) {
  const $ = new DataView(packet.payload.buffer, packet.payload.byteOffset);

  if (ports.src !== undefined) $.setUint16(0, ports.src);
  if (ports.dst !== undefined) $.setUint16(2, ports.dst);
}

export function unpack_ethernet_frame(frame: Uint8Array): TEthernetFrame {
  const $ = new DataView(frame.buffer, frame.byteOffset);

  const obj: TEthernetFrame = {
    dst: $.getBigUint64(0) >> 16n,
    src: $.getBigUint64(6) >> 16n,
    etherType: 0,
    payload: null as unknown as Uint8Array,
  };

  const type = $.getUint16(12);
  let offset = 12;

  if (type === ETHER_TAG) {
    offset += 2;
    const tag = $.getUint16(offset);
    offset += 2;

    obj.tag = {
      pcp: (tag >> 13) & 0b111,
      dei: (tag >> 12) & 0b1,
      vid: tag & 0xfff,
    };
  }

  obj.etherType = $.getUint16(offset);
  obj.payload = frame.subarray(offset + 2);

  return obj;
}

export function pack_ethernet_frame(obj: TEthernetFrame): Uint8Array {
  const tag_shift = obj.tag !== undefined ? 4 : 0;
  const frame = new Uint8Array(14 + tag_shift + obj.payload.length);
  const $ = new DataView(frame.buffer);

  $.setBigUint64(0, obj.dst << 16n);
  $.setBigUint64(6, obj.src << 16n);
  if (obj.tag !== undefined) {
    $.setUint16(12, ETHER_TAG);
    $.setUint16(14, ((obj.tag.pcp & 0b111) << 13) | ((obj.tag.dei & 0b1) << 12) | (obj.tag.vid & 0xfff));
  }
  $.setUint16(12 + tag_shift, obj.etherType);
  frame.set(obj.payload, 14 + tag_shift);

  return frame;
}

export type TArpPacket = {
  hwType: number;
  protoType: number;
  hwSize: number;
  protoSize: number;
  opcode: number;
  src_mac: bigint;
  src_ip: number;
  dst_mac: bigint;
  dst_ip: number;
};

export function unpack_arp_packet(packet: Uint8Array): TArpPacket {
  const $ = new DataView(packet.buffer, packet.byteOffset);

  const hwSize = $.getUint8(4);
  const protoSize = $.getUint8(5);

  if (hwSize !== 6 || protoSize !== 4) throw new Error("Unsupported ARP packet");

  return {
    hwType: $.getUint16(0),
    protoType: $.getUint16(2),
    hwSize,
    protoSize,
    opcode: $.getUint16(6),
    src_mac: $.getBigUint64(8) >> 16n,
    src_ip: $.getUint32(14),
    dst_mac: $.getBigUint64(18) >> 16n,
    dst_ip: $.getUint32(24),
  };
}

export function pack_arp_packet(obj: TArpPacket): Uint8Array {
  const packet = new Uint8Array(28);
  const $ = new DataView(packet.buffer);

  $.setUint16(0, obj.hwType);
  $.setUint16(2, obj.protoType);
  $.setUint8(4, obj.hwSize);
  $.setUint8(5, obj.protoSize);
  $.setUint16(6, obj.opcode);
  $.setBigUint64(8, obj.src_mac << 16n);
  $.setUint32(14, obj.src_ip);
  $.setBigUint64(18, obj.dst_mac << 16n);
  $.setUint32(24, obj.dst_ip);

  return packet;
}

export type TIP4Packet = {
  header: {
    version: number;
    ihl: number;
    tos: number;
    length: number;
    id: number;
    flags: number;
    offset: number;
    ttl: number;
    protocol: number;
    checksum: number;
    src: number;
    dst: number;
    options: { type: number; data: Uint8Array }[];
  };
  payload: Uint8Array;
};

export function unpack_ip4_packet(packet: Uint8Array): TIP4Packet {
  const $ = new DataView(packet.buffer, packet.byteOffset);

  const obj: TIP4Packet = {
    header: {
      version: $.getUint8(0) >> 4,
      ihl: $.getUint8(0) & 0xf,
      tos: $.getUint8(1),
      length: $.getUint16(2),
      id: $.getUint16(4),
      flags: $.getUint8(6) >> 5,
      offset: $.getUint16(6) & 0x1fff,
      ttl: $.getUint8(8),
      protocol: $.getUint8(9),
      checksum: $.getUint16(10),
      src: $.getUint32(12),
      dst: $.getUint32(16),
      options: [],
    },
    payload: packet,
  };
  obj.payload = packet.subarray(obj.header.ihl * 4);

  for (let i = 20; i < obj.header.ihl * 4; ) {
    const opt = $.getUint8(i);
    i += 1;
    if (opt === 0) break;
    if (opt === 1) continue;

    const len = $.getUint8(i);
    i += 1;

    obj.header.options.push({
      type: opt,
      data: new Uint8Array(packet.buffer, i, len),
    });
    i += len;
  }

  return obj;
}

export function pack_ip4_packet(obj: TIP4Packet): Uint8Array {
  // IHL
  {
    let ihl = 5;
    for (const option of obj.header.options) {
      ihl += Math.ceil((option.data.length + 2) / 4);
    }
    obj.header.ihl = ihl;
  }

  // Length
  {
    obj.header.length = obj.header.ihl * 4 + obj.payload.length;
  }

  const packet = new Uint8Array(obj.header.ihl * 4 + obj.payload.length);
  const $ = new DataView(packet.buffer);

  $.setUint8(0, (obj.header.version << 4) | obj.header.ihl);
  $.setUint8(1, obj.header.tos);
  $.setUint16(2, obj.header.length);
  $.setUint16(4, obj.header.id);
  $.setUint16(6, (obj.header.flags << 13) | obj.header.offset);
  $.setUint8(8, obj.header.ttl);
  $.setUint8(9, obj.header.protocol);
  $.setUint16(10, obj.header.checksum);
  $.setUint32(12, obj.header.src);
  $.setUint32(16, obj.header.dst);

  let i = 0;
  for (const option of obj.header.options) {
    $.setUint8(20 + i, option.type);
    i += 1;
    $.setUint8(20 + i, option.data.length);
    i += 1;
    packet.set(option.data, 20 + i);
    i += option.data.length;
  }

  packet.set(obj.payload, obj.header.ihl * 4);

  // Checksum
  {
    let sum = 0;
    for (let j = 0; j < obj.header.ihl * 4; j += 2) {
      const word = $.getUint16(j);
      sum += word;
      if (sum > 0xffff) {
        sum = (sum & 0xffff) + (sum >>> 16);
      }
    }
    sum = ~sum & 0xffff;
    if (sum === 0) sum = 0xffff;

    $.setUint16(10, sum);
  }

  return packet;
}

export type TIcmpPacket = {
  type: number;
  code: number;
  checksum: number;
  data: Uint8Array;
  payload: Uint8Array;
};

export function unpack_icmp_packet(packet: Uint8Array): TIcmpPacket {
  const $ = new DataView(packet.buffer, packet.byteOffset);
  return {
    type: $.getUint8(0),
    code: $.getUint8(1),
    checksum: $.getUint16(2),
    data: packet.subarray(4, 8),
    payload: packet.subarray(8),
  };
}

export function pack_icmp_packet(obj: TIcmpPacket): Uint8Array {
  const packet = new Uint8Array(4 + 4 + obj.payload.length);
  const $ = new DataView(packet.buffer, packet.byteOffset);

  $.setUint8(0, obj.type);
  $.setUint8(1, obj.code);
  $.setUint16(2, obj.checksum);
  packet.set(obj.data, 4);
  packet.set(obj.payload, 8);

  return packet;
}

export type TUdpPacket = {
  header: {
    src: number;
    dst: number;
    length: number;
    checksum: number;
  };
  payload: Uint8Array;
};

export function unpack_udp_packet(packet: Uint8Array): TUdpPacket {
  const $ = new DataView(packet.buffer, packet.byteOffset);
  const total_length = $.getUint16(4);
  return {
    header: {
      src: $.getUint16(0),
      dst: $.getUint16(2),
      length: total_length,
      checksum: $.getUint16(6),
    },
    payload: packet.subarray(8, total_length),
  };
}

export function pack_udp_packet(obj: TUdpPacket): Uint8Array {
  const packet = new Uint8Array(8 + obj.payload.length);
  const $ = new DataView(packet.buffer, packet.byteOffset);
  $.setUint16(0, obj.header.src);
  $.setUint16(2, obj.header.dst);
  $.setUint16(4, 8 + obj.payload.length);
  $.setUint16(6, obj.header.checksum);
  packet.set(obj.payload, 8);
  return packet;
}

export type TTcpPacket = {
  header: {
    src: number;
    dst: number;
    seq: number;
    ack: number;
    data_offset: number;
    flags: number;
    window: number;
    checksum: number;
    urgent: number;
    options: Uint8Array;
  };
  payload: Uint8Array;
};

export function unpack_tcp_packet(packet: Uint8Array): TTcpPacket {
  const $ = new DataView(packet.buffer, packet.byteOffset);
  const data_offset = $.getUint8(12) >> 4;
  return {
    header: {
      src: $.getUint16(0),
      dst: $.getUint16(2),
      seq: $.getUint32(4),
      ack: $.getUint32(8),
      data_offset,
      flags: $.getUint16(12) & 0x1ff,
      window: $.getUint16(14),
      checksum: $.getUint16(16),
      urgent: $.getUint16(18),
      options: packet.subarray(20, data_offset * 4),
    },
    payload: packet.subarray(data_offset * 4),
  };
}

export function pack_tcp_packet(obj: TTcpPacket): Uint8Array {
  const header_len = Math.ceil((20 + obj.header.options.length) / 4) * 4;
  const packet = new Uint8Array(header_len + obj.payload.length);
  const $ = new DataView(packet.buffer, packet.byteOffset);

  $.setUint16(0, obj.header.src);
  $.setUint16(2, obj.header.dst);
  $.setUint32(4, obj.header.seq);
  $.setUint32(8, obj.header.ack);
  $.setUint16(12, ((header_len / 4) << 12) | (obj.header.flags & 0x1ff));
  $.setUint16(14, obj.header.window);
  $.setUint16(16, obj.header.checksum);
  $.setUint16(18, obj.header.urgent);
  packet.set(obj.header.options, 20);
  packet.set(obj.payload, header_len);

  return packet;
}

export type TDhcpPacket = {
  header: {
    op: number;
    htype: number;
    hlen: number;
    hops: number;
    xid: number;
    secs: number;
    flags: number;
    ciaddr: number;
    yiaddr: number;
    siaddr: number;
    giaddr: number;
    chaddr: Uint8Array;
    sname: Uint8Array;
    file: Uint8Array;
    options: {
      type: number;
      data: Uint8Array;
    }[];
  };
};

export function unpack_dhcp_packet(packet: Uint8Array): TDhcpPacket {
  const $ = new DataView(packet.buffer, packet.byteOffset);
  return {
    header: {
      op: $.getUint8(0),
      htype: $.getUint8(1),
      hlen: $.getUint8(2),
      hops: $.getUint8(3),
      xid: $.getUint32(4),
      secs: $.getUint16(8),
      flags: $.getUint16(10),
      ciaddr: $.getUint32(12),
      yiaddr: $.getUint32(16),
      siaddr: $.getUint32(20),
      giaddr: $.getUint32(24),
      chaddr: packet.subarray(28, 28 + 16),
      sname: packet.subarray(44, 44 + 64),
      file: packet.subarray(108, 108 + 128),
      options: (function unpack_options(options: Uint8Array) {
        const res: TDhcpPacket["header"]["options"] = [];
        const $opt = new DataView(options.buffer, options.byteOffset);
        for (let i = 0; i < options.length; ) {
          const type = $opt.getUint8(i);
          i += 1;
          if (type === DHCP_OPTIONS.PADDING) continue;
          if (type === DHCP_OPTIONS.END) break;

          const len = $opt.getUint8(i);
          i += 1;
          res.push({
            type,
            data: options.subarray(i, i + len),
          });
          i += len;
        }
        return res;
      })(packet.subarray(240)),
    },
  };
}

export function pack_dhcp_packet(obj: TDhcpPacket): Uint8Array {
  const pack = new Uint8Array(240 + 312);
  const $ = new DataView(pack.buffer);

  $.setUint8(0, obj.header.op);
  $.setUint8(1, obj.header.htype);
  $.setUint8(2, obj.header.hlen);
  $.setUint8(3, obj.header.hops);
  $.setUint32(4, obj.header.xid);
  $.setUint16(8, obj.header.secs);
  $.setUint16(10, obj.header.flags);
  $.setUint32(12, obj.header.ciaddr);
  $.setUint32(16, obj.header.yiaddr);
  $.setUint32(20, obj.header.siaddr);
  $.setUint32(24, obj.header.giaddr);
  pack.set(obj.header.chaddr.slice(0, 16), 28);
  pack.set(obj.header.sname.slice(0, 64), 44);
  pack.set(obj.header.file.slice(0, 128), 108);
  pack.set(new Uint8Array([0x63, 0x82, 0x53, 0x63]), 236);
  let offset = 240;
  {
    let end_found = false;
    for (const opt of obj.header.options) {
      $.setUint8(offset, opt.type);
      offset += 1;
      $.setUint8(offset, opt.data.length);
      offset += 1;
      pack.set(opt.data, offset);
      offset += opt.data.length;
      if (opt.type === DHCP_OPTIONS.END) {
        end_found = true;
        break;
      }
    }
    if (!end_found) {
      $.setUint8(offset, DHCP_OPTIONS.END);
      offset += 1;
    }
  }
  return pack.slice(0, Math.max(300, offset));
}
