import type { OS } from "./os";

export const DRIVER_CALLS = {
  NIC_MAC_SET: 0,
  NIC_UP: 1,
  NIC_DOWN: 2,
} as const;

export type TDriverCall =
  | { $: typeof DRIVER_CALLS.NIC_MAC_SET; mac: bigint }
  | { $: typeof DRIVER_CALLS.NIC_UP }
  | { $: typeof DRIVER_CALLS.NIC_DOWN };

export class Driver {
  name: string = "";
  instance: string = "";

  _os: OS;
  _iDriver: number = -1;

  net_send_frame?: (iInterface: number, data: Uint8Array) => number;

  constructor(os: OS) {
    this._os = os;
    this._iDriver = this._os._drivers.length;
    this._os._drivers.push(this);
  }

  call(_cmd: TDriverCall) {}
}
