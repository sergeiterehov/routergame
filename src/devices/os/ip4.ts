import type { Net, TInterface } from "./net";
import {
  ETHER_TYPES,
  IP_BROADCAST,
  IP_PROTOCOLS,
  pack_ethernet_frame,
  pack_icmp_packet,
  pack_ip4_packet,
  unpack_icmp_packet,
  unpack_ip4_packet,
} from "../pack";
import { OSChannel } from "./os";
import { testSameNetwork } from "../format";

export type TRoute = { network: number; prefix: number; gateway?: number; iInterface: number; src?: number };

export class IP4 {
  _forwarding = true;
  _default_ttl = 64;

  _queue: { iInterface: number; ip: number; frame: Uint8Array }[] = [];
  _routes: TRoute[] = [];
  _channel = new OSChannel<{ direction: "in" | "out"; iInterface: number; packet: Uint8Array }>();

  constructor(public readonly net: Net) {}

  handle_packet(iInterface: number, packet: Uint8Array) {
    const pack_view = new DataView(packet.buffer, packet.byteOffset);
    const ttl = pack_view.getUint8(8);
    const dst = pack_view.getUint32(16);

    if (dst === IP_BROADCAST) return this.handle_protocol(iInterface, packet);

    // Own IP
    for (const _iface of this.net._interfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address === dst) {
          return this.handle_protocol(iInterface, packet);
        }
      }
    }

    // Forwarding
    if (!this._forwarding) return;

    if (ttl <= 1) return this.icmp_send_time_exceeded(iInterface, packet);

    const route = this.route(dst);
    if (!route) return;

    pack_view.setUint8(8, ttl - 1);

    this.send_packet(route.iInterface, route.gateway, packet);
  }

  handle_protocol(iInterface: number, packet: Uint8Array) {
    this._channel.postMessage({ direction: "in", iInterface, packet });

    const ip_struct = unpack_ip4_packet(packet);

    // icmp
    if (ip_struct.header.protocol === IP_PROTOCOLS.ICMP) {
      this.icmp_handle(iInterface, packet);
    }

    this.net.socket.handle_packet(iInterface, packet);
  }

  icmp_handle(iInterface: number, ip_packet: Uint8Array) {
    const ip_struct = unpack_ip4_packet(ip_packet);
    const icmp_struct = unpack_icmp_packet(ip_struct.payload);

    // TODO: types 0,3,8

    if (icmp_struct.type === 8) {
      const reply = pack_icmp_packet({
        type: 0,
        code: 0,
        checksum: 0,
        rest: icmp_struct.rest,
        payload: icmp_struct.payload,
      });

      this.send(ip_struct.header.src, IP_PROTOCOLS.ICMP, reply, ip_struct.header.dst);
    }
  }

  send_packet(iInterface: number, ip: number, packet: Uint8Array) {
    const route_iface = this.net._interfaces[iInterface];
    if (route_iface.mac === undefined) return;

    this._channel.postMessage({ direction: "out", iInterface, packet });

    let local_iface: TInterface | undefined;

    for (const _iface of this.net._interfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address === ip) {
          local_iface = _iface;
          break;
        }
      }
    }

    if (local_iface) {
      setTimeout(() => this.handle_packet(local_iface.index, packet));
      return;
    }

    const src_mac = route_iface.mac;
    let dst_mac = -1n; // -1 unknown, -2 pending, -3 fail

    for (const _arp of this.net.arp._table) {
      if (_arp.iInterface === iInterface && _arp.ip === ip) {
        switch (_arp.state) {
          case "success": {
            dst_mac = _arp.mac;
            break;
          }
          case "pending": {
            dst_mac = -2n;
            break;
          }
          case "fail": {
            dst_mac = -3n;
            break;
          }
        }
        break;
      }
    }

    if (dst_mac === -3n) return;

    const frame = pack_ethernet_frame({
      dst: dst_mac,
      src: src_mac,
      etherType: ETHER_TYPES.IPv4,
      payload: packet,
    });

    if (dst_mac < 0n) {
      this._queue.push({ iInterface, ip, frame });
      if (dst_mac === -1n) this.net.arp.send_request(iInterface, ip);
    } else {
      this.net.send_frame(iInterface, frame);
    }
  }

  send(ip: number, protocol: number, payload: Uint8Array, src_ip: number) {
    const route = this.route(ip);
    if (!route) return;

    const packet = pack_ip4_packet({
      header: {
        version: 4,
        dst: ip,
        src: src_ip >= 0 ? src_ip : route.src,
        protocol,
        ttl: this._default_ttl,
        flags: 0,
        id: 0,
        ihl: 0,
        length: 0,
        offset: 0,
        options: [],
        tos: 0,
        checksum: 0,
      },
      payload,
    });

    this.send_packet(route.iInterface, route.gateway, packet);
  }

  route(dst: number) {
    let route: TRoute | undefined;
    for (const _route of this._routes) {
      if (!testSameNetwork(dst, _route.network, _route.prefix)) continue;
      if (!route || _route.prefix > route.prefix) {
        route = _route;
        break;
      }
    }
    if (!route) return;

    const iface = this.net._interfaces[route.iInterface];

    let src = -1;
    if (route.src) {
      src = route.src;
    } else if (iface.ips.length) {
      src = iface.ips[0].address;
    } else {
      return;
    }

    return { ...route, gateway: route.gateway ?? dst, src };
  }

  process_queue(iInterface: number, ip: number) {
    for (let i = 0; i < this._queue.length; i++) {
      const record = this._queue[i];
      if (record.iInterface === iInterface && record.ip === ip) {
        const dst_mac = this.net.arp.resolve(iInterface, ip);
        if (dst_mac < 0n) continue;

        const frame = record.frame;
        const view = new DataView(frame.buffer, frame.byteOffset);
        view.setBigUint64(0, (view.getBigUint64(0) & 0xffffn) | (dst_mac << 16n));

        this.net.send_frame(record.iInterface, frame);
      }
    }
  }

  icmp_send_time_exceeded(iInterface: number, origin_packet: Uint8Array) {
    const origin_view = new DataView(origin_packet.buffer, origin_packet.byteOffset);

    const src = origin_view.getUint32(12);
    const ihl = (origin_view.getUint8(0) & 0x0f) * 4;

    const route = this.route(src);
    if (!route) return;

    const embedded_len = Math.min(origin_packet.length, ihl + 8);

    const response = pack_ip4_packet({
      header: {
        version: 4,
        dst: src,
        src: route.src,
        protocol: 1,
        ttl: this._default_ttl,
        flags: 0,
        id: 0,
        ihl: 0,
        length: 0,
        offset: 0,
        options: [],
        tos: 0,
        checksum: 0,
      },
      payload: pack_icmp_packet({
        type: 11,
        code: 0,
        checksum: 0,
        rest: new Uint8Array(4),
        payload: origin_packet.slice(0, embedded_len),
      }),
    });

    this.send_packet(iInterface, route.gateway, response);
  }
}
