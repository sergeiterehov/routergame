export type TEthernetFrame = {
  dst: bigint;
  src: bigint;
  etherType: number;
  payload: Uint8Array;
};

export function unpack_ethernet_frame(frame: Uint8Array): TEthernetFrame {
  const $ = new DataView(frame.buffer, frame.byteOffset);

  return {
    dst: $.getBigUint64(0) >> 16n,
    src: $.getBigUint64(6) >> 16n,
    etherType: $.getUint16(12),
    payload: frame.subarray(14),
  };
}

export function pack_ethernet_frame(obj: TEthernetFrame): Uint8Array {
  const frame = new Uint8Array(14 + obj.payload.length);
  const $ = new DataView(frame.buffer);

  $.setBigUint64(0, obj.dst << 16n);
  $.setBigUint64(6, obj.src << 16n);
  $.setUint16(12, obj.etherType);
  frame.set(obj.payload, 14);

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

  return {
    hwType: $.getUint16(0),
    protoType: $.getUint16(2),
    hwSize: $.getUint8(4),
    protoSize: $.getUint8(5),
    opcode: $.getUint16(6),
    src_mac: $.getBigUint64(8) >> 16n,
    src_ip: $.getUint32(14),
    dst_mac: $.getBigUint64(18) >> 16n,
    dst_ip: $.getUint32(22),
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

  for (let i = 0; i < obj.header.ihl * 4; ) {
    const opt = $.getUint8(20 + i);
    i += 1;
    if (opt === 0) break;
    if (opt === 1) continue;

    const len = $.getUint8(20 + i);
    i += 1;

    obj.header.options.push({
      type: opt,
      data: new Uint8Array(packet.buffer, 20 + i, len),
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
      ihl += 1;
      ihl += Math.ceil(option.data.length / 4);
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

type TIcmpPacket = {
  type: number;
  code: number;
  checksum: number;
  rest: Uint8Array;
  payload: Uint8Array;
};

export function unpack_icmp_packet(packet: Uint8Array): TIcmpPacket {
  const $ = new DataView(packet.buffer, packet.byteOffset);
  return {
    type: $.getUint8(0),
    code: $.getUint8(1),
    checksum: $.getUint16(2),
    rest: packet.subarray(4, 8),
    payload: packet.subarray(8),
  };
}

export function pack_icmp_packet(obj: TIcmpPacket): Uint8Array {
  const packet = new Uint8Array(4 + 4 + obj.payload.length);
  const $ = new DataView(packet.buffer, packet.byteOffset);

  $.setUint8(0, obj.type);
  $.setUint8(1, obj.code);
  $.setUint16(2, obj.checksum);
  packet.set(obj.rest, 4);
  packet.set(obj.payload, 8);

  return packet;
}
