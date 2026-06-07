import { setIntervalRecursive } from "../helpers";
import {
  ARP_OPCODES,
  ETHER_TYPES,
  MAC_BROADCAST,
  pack_arp_packet,
  unpack_arp_packet,
  type TEthernetFrame,
} from "../pack";
import type { Net } from "./net";

const ARP_TIMEOUT_MS = 3_000;
const ARP_TTL_MS = 60_000;
const ARP_RETRY_MS = 5_000;

export type TArpRecord = {
  iInterface: number;
  ip: number;
  mac: bigint;
  expiresAt: number;
  state: "pending" | "success" | "fail";
};

export type TArpListener = { ip: number; on_change?: (arp: TArpRecord) => void };

export class ARP {
  _table: TArpRecord[] = [];
  _listeners: TArpListener[] = [];

  constructor(public readonly net: Net) {
    setIntervalRecursive(this._timer_handle_1s.bind(this), 1000);
  }

  private _timer_handle_1s() {
    this._actualize();
  }

  create_listener(ip: number) {
    const listener: TArpListener = { ip };
    return listener;
  }

  remove_listener(listener: TArpListener) {
    const index = this._listeners.indexOf(listener);
    if (index === -1) return;
    this._listeners.splice(index, 1);
  }

  send_request(iInterface: number, ip: number) {
    const iface = this.net._interfaces[iInterface];
    const src_mac = iface.mac;
    if (!src_mac) return;

    const sender_ip = iface.ips[0];
    if (!sender_ip) return;

    const frame: TEthernetFrame = {
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
        src_ip: sender_ip.ip,
        dst_ip: ip,
        dst_mac: 0n,
      }),
    };

    this.net.send_frame(iInterface, frame);

    const arp: TArpRecord = {
      iInterface,
      ip,
      mac: 0n,
      state: "pending",
      expiresAt: Date.now() + ARP_TIMEOUT_MS,
    };

    this._table.push(arp);

    this._notify_listeners(arp);
  }

  update(iInterface: number, ip: number, mac: bigint) {
    for (const _arp of this._table) {
      if (_arp.iInterface === iInterface && _arp.ip === ip) {
        _arp.mac = mac;
        _arp.state = "success";
        _arp.expiresAt = Date.now() + ARP_TTL_MS;

        this._notify_listeners(_arp);
        return;
      }
    }

    const arp: TArpRecord = {
      iInterface,
      mac,
      ip,
      state: "success",
      expiresAt: Date.now() + ARP_TTL_MS,
    };

    this._table.push(arp);

    this._notify_listeners(arp);
  }

  handle(iInterface: number, frame: TEthernetFrame) {
    const iface = this.net._interfaces[iInterface];
    if (!iface.mac) return;

    if (frame.etherType !== ETHER_TYPES.ARP) return;

    const arp = unpack_arp_packet(frame.payload);
    const { opcode, src_mac, src_ip, dst_ip } = arp;

    if (opcode === ARP_OPCODES.REQUEST) {
      // Request
      for (const _iface of this.net._interfaces) {
        if (!_iface) continue;
        for (const _ip of _iface.ips) {
          if (_ip.ip === dst_ip) {
            const frame: TEthernetFrame = {
              dst: src_mac,
              src: iface.mac,
              etherType: ETHER_TYPES.ARP,
              payload: pack_arp_packet({
                hwType: ARP_OPCODES.REPLY,
                protoType: ETHER_TYPES.IPv4,
                hwSize: 6,
                protoSize: 4,
                opcode: ARP_OPCODES.REPLY,
                src_mac: iface.mac,
                src_ip: _ip.ip,
                dst_mac: src_mac,
                dst_ip: src_ip,
              }),
            };

            this.net.send_frame(iInterface, frame);

            return;
          }
        }
      }
    } else if (opcode === ARP_OPCODES.REPLY) {
      // Reply
      let arp: TArpRecord | undefined;
      for (const _arp of this._table) {
        if (_arp.iInterface === iInterface && _arp.ip === src_ip) {
          arp = _arp;
          break;
        }
      }
      if (!arp) return;

      arp.state = "success";
      arp.mac = src_mac;
      arp.expiresAt = Date.now() + ARP_TTL_MS;

      this.net.ip4.buffer_process(iInterface, src_ip);

      this._notify_listeners(arp);
    }
  }

  get_record(iInterface: number, ip: number) {
    for (const _entry of this._table) {
      if (_entry.iInterface === iInterface && _entry.ip === ip) {
        return _entry;
      }
    }
  }

  private _notify_listeners(arp: TArpRecord) {
    for (const listener of this._listeners) {
      if (listener.ip !== 0 && listener.ip !== arp.ip) continue;
      listener.on_change?.(arp);
    }
  }

  private _actualize() {
    const now = Date.now();

    for (let i = 0; i < this._table.length; i++) {
      const arp = this._table[i];
      if (arp.expiresAt < now) {
        if (arp.state === "pending") {
          arp.state = "fail";
          arp.expiresAt = now + ARP_RETRY_MS;

          this.net.ip4.buffer_process(arp.iInterface, arp.ip);

          this._notify_listeners(arp);
        } else {
          this._table.splice(i, 1);
          i--;
        }
        continue;
      }
    }
  }
}
