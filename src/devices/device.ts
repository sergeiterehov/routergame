import { SEC } from "./format";
import { setIntervalRecursive } from "./helpers";

export class Device {
  type: string = "Device";
  gid: string = "";

  _interrupt: () => void = () => {};
}

export const PORT_LINK_BYTES = {
  DOWN: 0x00,
  UP: 0xff,
};

export type TPortConnection = {
  rx: (frame: Uint8Array) => void;
  link: (connected: boolean) => void;
};
export type TPortConnect = (api: { tx: (frame: Uint8Array) => void }) => TPortConnection;

const _up_bytes = new Uint8Array([PORT_LINK_BYTES.UP]);
const _down_bytes = new Uint8Array([PORT_LINK_BYTES.DOWN]);

const _BEACON_INTERVAL_MS = 1 * SEC;
const _BEACON_TTL_MS = 3 * SEC;

export class Port {
  readonly _multicast: boolean;

  _enabled: boolean = true;
  private _last_outside_beacon = 0;

  _link: boolean = false;

  _inside: TPortConnection;
  _outsides: TPortConnection[] = [];

  constructor(multicast: boolean, handle_connect: TPortConnect) {
    this._multicast = multicast;
    this._inside = handle_connect({ tx: this._tx_outside.bind(this) });

    setIntervalRecursive(this._handle_timer_beacon.bind(this), _BEACON_INTERVAL_MS);
  }

  private _handle_timer_beacon() {
    if (!this._enabled) return;
    this._tx_outside(_up_bytes);

    if (Date.now() - this._last_outside_beacon > _BEACON_TTL_MS) this._set_link(false);
  }

  connect(handle_connect: TPortConnect) {
    if (!this._multicast && this._outsides.length) throw new Error("Port is already connected");

    const connection = handle_connect({ tx: this._rx_outside.bind(this) });
    this._outsides.push(connection);

    this._handle_timer_beacon();
  }

  disconnect() {
    if (!this._outsides.length) throw new Error("Port is not connected");

    this._set_link(false);

    this._outsides.splice(0);
  }

  private _rx_outside(frame: Uint8Array) {
    // Status byte
    if (frame.byteLength === 1) {
      if (frame[0] === PORT_LINK_BYTES.DOWN) {
        this._set_link(false);
      } else if (frame[0] === PORT_LINK_BYTES.UP) {
        this._last_outside_beacon = Date.now();
        this._set_link(true);
      }

      return;
    }

    this._inside.rx(frame);
  }

  private _tx_outside(frame: Uint8Array) {
    for (const outside of this._outsides) outside.rx(frame);
  }

  private _set_link(link: boolean) {
    if (this._link === link) return;

    this._link = link;
    this._inside.link(link);
  }
}
