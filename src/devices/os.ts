import { testSameNetwork } from "./format";
import {
  ARP_OPCODES,
  ETHER_TYPES,
  IP_BROADCAST,
  IP_PROTOCOLS,
  MAC_BROADCAST,
  pack_arp_packet,
  pack_ethernet_frame,
  pack_icmp_packet,
  pack_ip4_packet,
  pack_udp_packet,
  unpack_icmp_packet,
  unpack_ip4_packet,
  unpack_udp_packet,
} from "./pack";
import type { System, Driver } from "./system";

const CAM_TTL = 60_000;

const ARP_TIMEOUT_MS = 3_000;
const ARP_TTL_MS = 60_000;
const ARP_RETRY_MS = 5_000;

class OSChannel<T = unknown> extends EventTarget {
  private _eventMap = {
    message: new MessageEvent("message", { data: null as T }),
  };

  postMessage(message: T): void {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }

  addEventListener<K extends keyof typeof this._eventMap>(
    type: K,
    listener: (this: OSChannel, ev: (typeof this._eventMap)[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  removeEventListener<K extends keyof typeof this._eventMap>(
    type: K,
    listener: (this: OSChannel, ev: (typeof this._eventMap)[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }
}

export type TIP4 = { address: number; prefix: number };
export type TInterface = {
  index: number;
  type: "bridge" | "ethernet";
  name: string;
  flags: {
    UP?: boolean;
    LOWER_UP?: boolean;
  };
  mac?: bigint;
  iDriver: number;
  iMasterInterface?: number;
  ips: TIP4[];
};
export type TBridgeFDB = { iBridge: number; mac: bigint; iPort: number; expiresAt: number };
export type TArpRecord = {
  iInterface: number;
  ip: number;
  mac: bigint;
  expiresAt: number;
  state: "pending" | "success" | "fail";
};
export type TRoute = { network: number; prefix: number; gateway?: number; iInterface: number; src?: number };
export type TSocket = {
  ip: number;
} & (
  | { protocol: "raw"; on_data: (data: Uint8Array, ip: number, iface: TInterface) => void }
  | { protocol: "icmp"; on_data: (data: Uint8Array, ip: number, iface: TInterface) => void }
  | { protocol: "udp"; port: number; on_data: (data: Uint8Array, ip: number, port: number, iface: TInterface) => void }
);

export class OS {
  _system: System;

  _drivers: Driver[] = [];
  _apps: { [key: string]: (os: OS, args: string[]) => void } = {};

  _fs: { [key: string]: string } = {};

  _netForwarding = true;
  _netDefaultTTL = 64;

  _netInterfaces: TInterface[] = [];
  _netBridgeFDB: TBridgeFDB[] = [];
  _netARPTable: TArpRecord[] = [];
  _netIp4Queue: { iInterface: number; ip: number; frame: Uint8Array }[] = [];
  _netRoutes: TRoute[] = [];

  _netArpChannel = new OSChannel<"pending" | "fail" | "success" | "retry">();
  _netIp4Channel = new OSChannel<{ direction: "in" | "out"; iInterface: number; packet: Uint8Array }>();

  _netSockets: TSocket[] = [];

  on_print?: (text: string) => void;
  on_fs?: (fs: { [key: string]: string | undefined }) => void;

  constructor(system: System) {
    this._system = system;
    this._system._interrupt = (deviceIndex) => {
      this._interruptHandlers[deviceIndex]?.();
    };

    setInterval(this.timer_handle_1s.bind(this), 1000);
  }

  timer_handle_1s() {
    this.net_arp_actualize();
    this.net_br_fdb_actualize();
  }

  deadline(ms: number) {
    const start = Date.now();
    return {
      get start() {
        return start;
      },
      get left() {
        return ms - (Date.now() - start);
      },
    };
  }

  async channel_sync<T>(channel: OSChannel<T>, deadline: { left: number }) {
    return new Promise<[T] | [void, Error]>((resolve) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        resolve([undefined, new Error("TIMEOUT")]);
      }, deadline.left);
      channel.addEventListener(
        "message",
        (e) => {
          clearTimeout(timeout);
          resolve([e.data]);
        },
        { signal: controller.signal },
      );
    });
  }

  print(...text: string[]) {
    this.on_print?.(text.join(""));
  }

  install(apps: typeof this._apps) {
    Object.assign(this._apps, apps);
    this.print(`Installed: ${Object.keys(apps).join(", ")}\n`);
  }

  async exec(name: string, args: string[] = []) {
    const app = this._apps[name];
    if (!app) return this.print(`Unknown app: ${name}\n`);
    try {
      await app(this, args);
    } catch (e) {
      this.print(`[${name} exit error] ${e}\n`);
    }
  }

  _interruptHandlers: { [key: number]: () => void } = {};
  interrupt_register(iDevice: number, handler: () => void) {
    this._interruptHandlers[iDevice] = handler;
  }

  fs_read(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    return this._fs[path];
  }
  fs_write(path: string, data: string) {
    if (!path.startsWith("/")) path = "/" + path;
    this._fs[path] = data;
    this.on_fs?.({ [path]: data });
  }
  fs_rm(path: string) {
    const keys: string[] = [];

    if (!path.startsWith("/")) path = "/" + path;
    delete this._fs[path];
    keys.push(path);

    if (!path.endsWith("/")) path += "/";
    for (const key of Object.keys(this._fs)) {
      if (key.startsWith(path)) {
        delete this._fs[key];
        keys.push(key);
      }
    }

    this.on_fs?.(Object.fromEntries(keys.map((key) => [key, undefined])));
  }
  fs_exists(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    if (path in this._fs) return true;
    if (!path.endsWith("/")) path += "/";
    for (const key of Object.keys(this._fs)) {
      if (key.startsWith(path)) return true;
    }
    return false;
  }
  fs_list(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    if (!path.endsWith("/")) path += "/";

    const result: string[] = [];
    for (const key of Object.keys(this._fs)) {
      if (!key.startsWith(path)) continue;
      const inner = key.substring(path.length);
      const index = inner.indexOf("/");
      result.push(index === -1 ? inner : inner.substring(0, index));
    }

    return result;
  }
  fs_is_dir(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    if (!path.endsWith("/")) path += "/";
    for (const key of Object.keys(this._fs)) {
      if (key.startsWith(path)) return true;
    }
  }

  net_add_interface(type: TInterface["type"], name: string, iDriver: number) {
    const index = this._netInterfaces.length;
    this._netInterfaces.push({ index, type, name, iDriver, ips: [], flags: {} });
    return index;
  }

  net_change_mac(iInterface: number, mac: bigint) {
    const iface = this._netInterfaces[iInterface];
    const driver = this._drivers[iface.iDriver];
    driver.call({ $: "change_mac", mac });
  }

  net_br_fdb_update(iBridge: number, mac: bigint, iPort: number) {
    for (const _record of this._netBridgeFDB) {
      if (_record.mac !== mac || _record.iBridge !== iBridge) continue;
      _record.mac = mac;
      _record.iPort = iPort;
      _record.expiresAt = Date.now() + CAM_TTL;
      return;
    }

    this._netBridgeFDB.push({ iBridge, mac, iPort, expiresAt: Date.now() + CAM_TTL });
  }

  net_br_fdb_resolve(iBridge: number, mac: bigint) {
    for (const entry of this._netBridgeFDB) {
      if (entry.mac !== mac || entry.iBridge !== iBridge) continue;
      return entry.iPort;
    }
    return -1;
  }

  net_br_send(iBridge: number, mac: bigint, frame: Uint8Array, iSourcePort: number = -1) {
    const iface_learned = this._netInterfaces[this.net_br_fdb_resolve(iBridge, mac)];

    if (iface_learned) {
      this.net_send_frame(iface_learned.index, frame);
    } else {
      // Broadcast
      for (const _iface_port of this._netInterfaces) {
        if (_iface_port.iMasterInterface !== iBridge) continue;
        if (_iface_port.index === iSourcePort) continue;
        this.net_send_frame(_iface_port.index, frame);
      }
    }
  }

  net_br_fdb_actualize() {
    const now = Date.now();

    for (let i = 0; i < this._netBridgeFDB.length; i += 1) {
      if (this._netBridgeFDB[i].expiresAt < now) {
        this._netBridgeFDB.splice(i, 1);
        i -= 1;
      }
    }
  }

  net_send_frame(iInterface: number, frame: Uint8Array) {
    const iface = this._netInterfaces[iInterface];

    if (!iface.flags.UP) return;

    if (iface.type === "bridge") {
      const mac_dst = new DataView(frame.buffer, frame.byteOffset).getBigUint64(0) >> 16n;
      this.net_br_send(iface.index, mac_dst, frame);

      return;
    }

    const driver = this._drivers[iface.iDriver];
    driver.net_send_frame?.(iInterface, frame);
  }

  net_handle_frame(iInterfaceOrigin: number, frame: Uint8Array) {
    let iface = this._netInterfaces[iInterfaceOrigin];

    if (iface.iMasterInterface !== undefined) {
      iface = this._netInterfaces[iface.iMasterInterface];
    }

    const view = new DataView(frame.buffer);
    const dstMac = view.getBigUint64(0) >> 16n;
    const srcMac = view.getBigUint64(6) >> 16n;

    if (iface.type === "bridge") {
      this.net_br_fdb_update(iface.index, srcMac, iInterfaceOrigin);

      if (dstMac !== iface.mac) {
        this.net_br_send(iface.index, dstMac, frame, iInterfaceOrigin);
      }
    }

    // reject if not our mac or broadcast
    if (dstMac !== iface.mac && dstMac !== MAC_BROADCAST) return;

    const etherType = view.getUint16(12);

    if (etherType === ETHER_TYPES.IPv4) {
      // ARP update
      const srcIp = view.getUint32(14 + 12);
      for_arp: for (const _iface of this._netInterfaces) {
        for (const _ip of _iface.ips) {
          if (!testSameNetwork(srcIp, _ip.address, _ip.prefix)) continue;
          this.net_arp_update(iface.index, srcIp, srcMac);
          break for_arp;
        }
      }

      // IPv4
      const payload = frame.slice(14);
      this.net_ip4_handle_packet(iface.index, payload);
    } else if (etherType === ETHER_TYPES.ARP) {
      this.net_arp_handle(iface.index, frame);
    }
  }

  net_ip4_handle_packet(iInterface: number, packet: Uint8Array) {
    const pack_view = new DataView(packet.buffer, packet.byteOffset);
    const ttl = pack_view.getUint8(8);
    const dst = pack_view.getUint32(16);

    if (dst === IP_BROADCAST) return this.net_ip4_handle_protocol(iInterface, packet);

    // Own IP
    for (const _iface of this._netInterfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address === dst) {
          return this.net_ip4_handle_protocol(iInterface, packet);
        }
      }
    }

    // Forwarding
    if (!this._netForwarding) return;

    if (ttl <= 1) return this.net_icmp_send_time_exceeded(iInterface, packet);

    const route = this.net_ip4_route(dst);
    if (!route) return;

    pack_view.setUint8(8, ttl - 1);

    this.net_ip4_send_packet(route.iInterface, route.gateway, packet);
  }

  net_ip4_handle_protocol(iInterface: number, packet: Uint8Array) {
    this._netIp4Channel.postMessage({ direction: "in", iInterface, packet });

    const ip_struct = unpack_ip4_packet(packet);

    // icmp
    if (ip_struct.header.protocol === IP_PROTOCOLS.ICMP) {
      this.net_ip4_icmp_handle(iInterface, packet);
    }

    const iface = this._netInterfaces[iInterface];

    for (const socket of this._netSockets) {
      if (socket.ip !== 0 && socket.ip !== ip_struct.header.dst) continue;
      if (socket.protocol === "raw") {
        socket.on_data(packet, ip_struct.header.src, iface);
      } else if (ip_struct.header.protocol === IP_PROTOCOLS.ICMP && socket.protocol === "icmp") {
        socket.on_data(ip_struct.payload, ip_struct.header.src, iface);
      } else if (socket.protocol === "udp" && ip_struct.header.protocol === IP_PROTOCOLS.UDP) {
        const udp_struct = unpack_udp_packet(ip_struct.payload);
        if (socket.port === udp_struct.header.dst) {
          socket.on_data(udp_struct.payload, ip_struct.header.src, udp_struct.header.src, iface);
        }
      }
    }
  }

  socket_send_raw(socket: TSocket, data: Uint8Array) {
    if (socket.protocol !== "raw") return;

    const struct = unpack_ip4_packet(data);

    const route = this.net_ip4_route(struct.header.dst);
    if (!route) return;

    return this.net_ip4_send_packet(route.iInterface, route.gateway, data);
  }

  socket_send_udp(socket: TSocket, data: Uint8Array, ip: number, port: number) {
    if (socket.protocol !== "udp") return;

    const payload = pack_udp_packet({ header: { dst: port, src: socket.port, length: 0, checksum: 0 }, payload: data });

    return this.net_ip4_send(ip, IP_PROTOCOLS.UDP, payload, -1);
  }

  net_ip4_icmp_handle(iInterface: number, ip_packet: Uint8Array) {
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

      this.net_ip4_send(ip_struct.header.src, IP_PROTOCOLS.ICMP, reply, ip_struct.header.dst);
    }
  }

  net_icmp_send_time_exceeded(iInterface: number, origin_packet: Uint8Array) {
    const origin_view = new DataView(origin_packet.buffer, origin_packet.byteOffset);

    const src = origin_view.getUint32(12);
    const ihl = (origin_view.getUint8(0) & 0x0f) * 4;

    const route = this.net_ip4_route(src);
    if (!route) return;

    const embedded_len = Math.min(origin_packet.length, ihl + 8);

    const response = pack_ip4_packet({
      header: {
        version: 4,
        dst: src,
        src: route.src,
        protocol: 1,
        ttl: this._netDefaultTTL,
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

    this.net_ip4_send_packet(iInterface, route.gateway, response);
  }

  net_ip4_send_packet(iInterface: number, ip: number, packet: Uint8Array) {
    const route_iface = this._netInterfaces[iInterface];
    if (route_iface.mac === undefined) return;

    this._netIp4Channel.postMessage({ direction: "out", iInterface, packet });

    let local_iface: TInterface | undefined;

    for (const _iface of this._netInterfaces) {
      for (const _ip of _iface.ips) {
        if (_ip.address === ip) {
          local_iface = _iface;
          break;
        }
      }
    }

    if (local_iface) {
      setTimeout(() => this.net_ip4_handle_packet(local_iface.index, packet));
      return;
    }

    const src_mac = route_iface.mac;
    let dst_mac = -1n; // -1 unknown, -2 pending, -3 fail

    for (const _arp of this._netARPTable) {
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
      this._netIp4Queue.push({ iInterface, ip, frame });
      if (dst_mac === -1n) this.net_arp_send_request(iInterface, ip);
    } else {
      this.net_send_frame(iInterface, frame);
    }
  }

  net_ip4_send(ip: number, protocol: number, payload: Uint8Array, src_ip: number) {
    const route = this.net_ip4_route(ip);
    if (!route) return;

    const packet = pack_ip4_packet({
      header: {
        version: 4,
        dst: ip,
        src: src_ip >= 0 ? src_ip : route.src,
        protocol,
        ttl: this._netDefaultTTL,
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

    this.net_ip4_send_packet(route.iInterface, route.gateway, packet);
  }

  net_ip4_route(dst: number) {
    let route: TRoute | undefined;
    for (const _route of this._netRoutes) {
      if (!testSameNetwork(dst, _route.network, _route.prefix)) continue;
      if (!route || _route.prefix > route.prefix) {
        route = _route;
        break;
      }
    }
    if (!route) return;

    const iface = this._netInterfaces[route.iInterface];

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

  net_arp_send_request(iInterface: number, ip: number) {
    const iface = this._netInterfaces[iInterface];
    const src_mac = iface.mac;
    if (!src_mac) return;

    const sender_ip = iface.ips[0];
    if (!sender_ip) return;

    const frame = pack_ethernet_frame({
      dst: MAC_BROADCAST,
      src: src_mac,
      etherType: ETHER_TYPES.ARP,
      payload: pack_arp_packet({
        hwType: 0x0001,
        protoType: ETHER_TYPES.IPv4,
        hwSize: 6,
        protoSize: 4,
        opcode: ARP_OPCODES.REQUEST,
        src_mac,
        src_ip: sender_ip.address,
        dst_ip: ip,
        dst_mac: 0n,
      }),
    });

    this.net_send_frame(iInterface, frame);

    this._netARPTable.push({
      iInterface,
      ip,
      mac: 0n,
      state: "pending",
      expiresAt: Date.now() + ARP_TIMEOUT_MS,
    });

    this._netArpChannel.postMessage("pending");
  }

  net_arp_update(iInterface: number, ip: number, mac: bigint) {
    for (const entry of this._netARPTable) {
      if (entry.iInterface === iInterface && entry.ip === ip) {
        entry.mac = mac;
        entry.state = "success";
        entry.expiresAt = Date.now() + ARP_TTL_MS;
        return;
      }
    }

    this._netARPTable.push({
      iInterface,
      mac,
      ip,
      state: "success",
      expiresAt: Date.now() + ARP_TTL_MS,
    });
  }

  net_arp_handle(iInterface: number, frame: Uint8Array) {
    const iface = this._netInterfaces[iInterface];

    const view = new DataView(frame.buffer, frame.byteOffset);
    const opcode = view.getUint16(20);

    if (opcode === 0x0001) {
      // Request
      if (!iface.mac) return;

      const remote_mac = view.getBigUint64(6) >> 16n;
      const remote_ip = view.getUint32(28);
      const who_is_ip = view.getUint32(38);

      for (const _iface of this._netInterfaces) {
        for (const _ip of _iface.ips) {
          if (_ip.address === who_is_ip) {
            const frame = pack_ethernet_frame({
              dst: remote_mac,
              src: iface.mac,
              etherType: ETHER_TYPES.ARP,
              payload: pack_arp_packet({
                hwType: 0x0001,
                protoType: ETHER_TYPES.IPv4,
                hwSize: 6,
                protoSize: 4,
                opcode: ARP_OPCODES.REPLY,
                src_mac: iface.mac,
                src_ip: who_is_ip,
                dst_mac: remote_mac,
                dst_ip: remote_ip,
              }),
            });

            this.net_send_frame(iInterface, frame);

            return;
          }
        }
      }
    } else if (opcode === 0x0002) {
      // Reply
      const mac = view.getBigUint64(22) >> 16n;
      const ip = view.getUint32(28);

      let arp: TArpRecord | undefined;
      for (const _arp of this._netARPTable) {
        if (_arp.iInterface === iInterface && _arp.ip === ip) {
          arp = _arp;
          break;
        }
      }
      if (!arp) return;

      arp.state = "success";
      arp.mac = mac;
      arp.expiresAt = Date.now() + ARP_TTL_MS;

      this._netArpChannel.postMessage("success");

      this.net_ip4_process_queue(iInterface, ip);
    }
  }

  net_arp_resolve(iInterface: number, ip: number) {
    for (const _entry of this._netARPTable) {
      if (_entry.iInterface === iInterface && _entry.ip === ip) {
        if (_entry.state === "success") {
          return _entry.mac;
        }
      }
    }

    return -1n;
  }

  net_arp_actualize() {
    const now = Date.now();
    let failed = 0;
    let removed = 0;

    for (let i = 0; i < this._netARPTable.length; i++) {
      const arp = this._netARPTable[i];
      if (arp.expiresAt < now) {
        if (arp.state === "pending") {
          arp.state = "fail";
          arp.expiresAt = now + ARP_RETRY_MS;
          failed += 1;
        } else {
          this._netARPTable.splice(i, 1);
          removed += 1;
          i--;
        }
        continue;
      }
    }

    if (failed) this._netArpChannel.postMessage("fail");
    if (removed) this._netArpChannel.postMessage("retry");
  }

  net_ip4_process_queue(iInterface: number, ip: number) {
    for (let i = 0; i < this._netIp4Queue.length; i++) {
      const record = this._netIp4Queue[i];
      if (record.iInterface === iInterface && record.ip === ip) {
        const dst_mac = this.net_arp_resolve(iInterface, ip);
        if (dst_mac < 0n) continue;

        const frame = record.frame;
        const view = new DataView(frame.buffer, frame.byteOffset);
        view.setBigUint64(0, (view.getBigUint64(0) & 0xffffn) | (dst_mac << 16n));

        this.net_send_frame(record.iInterface, frame);
      }
    }
  }
}
