export class Device {
  type: string = "Device";
  gid: string = "";

  _interrupt: () => void = () => {};
}

export class UTPEthernetFrames {
  private _a?: Device;
  private _aReceive?: (frame: Uint8Array) => void;
  private _b?: Device;
  private _bReceive?: (frame: Uint8Array) => void;

  connect(device: Device, receive: (frame: Uint8Array) => void) {
    if (!this._a) {
      this._a = device;
      this._aReceive = receive;
    } else if (!this._b) {
      this._b = device;
      this._bReceive = receive;
    } else {
      throw new Error("Already connected");
    }
  }
  send(src: Device, frame: Uint8Array) {
    if (this._a === src && this._bReceive) {
      this._bReceive(frame);
    } else if (this._b === src && this._aReceive) {
      this._aReceive(frame);
    }
  }
}

export class SimpleEthernet extends Device {
  type: string = "SimpleEthernet";
  mac = 0n;

  utp?: UTPEthernetFrames;

  received?: Uint8Array;

  constructor(mac: bigint) {
    super();
    this.mac = mac;
  }

  connect(utp: UTPEthernetFrames) {
    this.utp = utp;
    utp.connect(this, this._receive.bind(this));
  }

  _receive(frame: Uint8Array) {
    this.received = frame;
    this._interrupt();
  }

  _send(frame: Uint8Array) {
    if (!this.utp) return;
    this.utp.send(this, frame);
  }
}
