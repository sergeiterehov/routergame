import { Device, Port } from "./device";
import type { OS } from "./os/os";
import { Driver } from "./system";

export class SimpleEthernet extends Device {
  type: string = "SimpleEthernet";
  mac = 0n;

  private _link = false;
  private _tx: (frame: Uint8Array) => void = () => null;

  readonly port = new Port(false, ({ tx }) => {
    this._tx = tx;
    return {
      rx: this._handle_rx.bind(this),
      link: this._handle_link.bind(this),
    };
  });

  received?: Uint8Array;

  constructor(mac: bigint) {
    super();
    this.mac = mac;
  }

  private _handle_rx(frame: Uint8Array) {
    this.received = frame;
    this._interrupt();
  }

  private _handle_link(connected: boolean) {
    this._link = connected;
    this._interrupt();
  }

  change_mac(mac: bigint) {
    this.mac = mac;
  }

  get_link() {
    return this._link;
  }

  tx(frame: Uint8Array) {
    if (!this._link) return;
    this._tx(frame);
  }
}

export class SimpleEthernetDriver extends Driver {
  name = "SimpleEthernet";

  _device: SimpleEthernet;
  _iInterface: number = -1;

  constructor(os: OS, iDevice: number) {
    super(os);

    const device = this._os._system._devices[iDevice];
    if (!device) throw new Error("Device not found");
    if (device.type !== "SimpleEthernet") throw new Error("Device is not SimpleEthernet");
    this._device = device as SimpleEthernet;

    this._os.interrupt_register(iDevice, this._handleInterrupt.bind(this));

    this.instance = `SimpleEthernet:${this._device.gid}`;

    this._iInterface = this._os.net.add_interface("ethernet", `eth${iDevice}`, this._iDriver);
    const iface = this._os.net._interfaces[this._iInterface];
    iface.mac = this._device.mac;
    iface.flags.LOWER_UP = this._device.get_link();
    iface.flags.UP = true;
  }

  _handleInterrupt() {
    const dev = this._device;

    if (dev.received) {
      this._os.net.handle_frame(this._iInterface, dev.received);
      dev.received = undefined;
    }

    const iface = this._os.net._interfaces[this._iInterface];
    iface.flags.LOWER_UP = dev.get_link();
  }

  net_send_frame = (iInterface: number, data: Uint8Array) => {
    this._device.tx(data);
  };

  call(cmd: { $: "change_mac"; mac: bigint }) {
    if (cmd.$ === "change_mac") {
      this._device.change_mac(cmd.mac);
      this._os.net._interfaces[this._iInterface].mac = cmd.mac;
    }
  }
}
