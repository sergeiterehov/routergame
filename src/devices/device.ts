export class Device {
  type: string = "Device";
  gid: string = "";

  _interrupt: () => void = () => {};
}

type TPortConnection = {
  rx: (frame: Uint8Array) => void;
  link: (connected: boolean) => void;
};
type TPortConnect = (api: { tx: (frame: Uint8Array) => void }) => TPortConnection;

export class Port {
  readonly _multicast: boolean;

  _inside: TPortConnection;
  _outsides: TPortConnection[] = [];

  constructor(multicast: boolean, handle_connect: TPortConnect) {
    this._multicast = multicast;
    this._inside = handle_connect({ tx: this._outside_rx.bind(this) });
  }

  connect(handle_connect: TPortConnect) {
    if (!this._multicast && this._outsides.length) throw new Error("Port is already connected");

    const connection = handle_connect({ tx: this._inside.rx });
    this._outsides.push(connection);

    this._inside.link(true);
    for (const outside of this._outsides) outside.link(true);
  }

  disconnect() {
    if (!this._outsides.length) throw new Error("Port is not connected");

    this._inside.link(false);
    for (const outside of this._outsides) outside.link(false);

    this._outsides.splice(0);
  }

  private _outside_rx(frame: Uint8Array) {
    for (const outside of this._outsides) outside.rx(frame);
  }
}
