import { type OS } from "./os";
import { testSameNetwork } from "../format";
import { ETHER_TYPES, MAC_BROADCAST } from "../pack";
import { Bridge } from "./br";
import { IP4 } from "./ip4";
import { Socket } from "./socket";
import { ARP } from "./arp";

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

export class Net {
  _interfaces: TInterface[] = [];

  readonly br = new Bridge(this);
  readonly arp = new ARP(this);
  readonly ip4 = new IP4(this);
  readonly socket = new Socket(this);

  constructor(public readonly os: OS) {}

  add_interface(type: TInterface["type"], name: string, iDriver: number) {
    const index = this._interfaces.length;
    this._interfaces.push({ index, type, name, iDriver, ips: [], flags: {} });
    return index;
  }

  change_mac(iInterface: number, mac: bigint) {
    const iface = this._interfaces[iInterface];
    const driver = this.os._drivers[iface.iDriver];
    driver.call({ $: "change_mac", mac });
  }

  send_frame(iInterface: number, frame: Uint8Array) {
    const iface = this._interfaces[iInterface];

    if (!iface.flags.UP) return;

    if (iface.type === "bridge") {
      const mac_dst = new DataView(frame.buffer, frame.byteOffset).getBigUint64(0) >> 16n;
      this.br.send(iface.index, mac_dst, frame);

      return;
    }

    const driver = this.os._drivers[iface.iDriver];
    driver.net_send_frame?.(iInterface, frame);
  }

  handle_frame(iInterfaceOrigin: number, frame: Uint8Array) {
    let iface = this._interfaces[iInterfaceOrigin];

    if (iface.iMasterInterface !== undefined) {
      iface = this._interfaces[iface.iMasterInterface];
    }

    const view = new DataView(frame.buffer);
    const dstMac = view.getBigUint64(0) >> 16n;
    const srcMac = view.getBigUint64(6) >> 16n;

    if (iface.type === "bridge") {
      this.br.fdb_update(iface.index, srcMac, iInterfaceOrigin);

      if (dstMac !== iface.mac) {
        this.br.send(iface.index, dstMac, frame, iInterfaceOrigin);
      }
    }

    // reject if not our mac or broadcast
    if (dstMac !== iface.mac && dstMac !== MAC_BROADCAST) return;

    const etherType = view.getUint16(12);

    if (etherType === ETHER_TYPES.IPv4) {
      // ARP update
      const srcIp = view.getUint32(14 + 12);
      for_arp: for (const _iface of this._interfaces) {
        for (const _ip of _iface.ips) {
          if (!testSameNetwork(srcIp, _ip.address, _ip.prefix)) continue;
          this.arp.update(iface.index, srcIp, srcMac);
          break for_arp;
        }
      }

      // IPv4
      const payload = frame.slice(14);
      this.ip4.handle_packet(iface.index, payload);
    } else if (etherType === ETHER_TYPES.ARP) {
      this.arp.handle(iface.index, frame);
    }
  }
}
