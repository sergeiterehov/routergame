import { Device, Port } from "../device";
import { System } from "../system";
import { expose, onMessage } from "./helpers";

const EXPIRE_INTERVAL_MS = 1_000;
const TTL_MS = 30_000;

class HardwareEthernet extends Device {
  type: string = "HardwareEthernet";

  private _tx: (frame: Uint8Array) => void = () => null;
  private _handle_link: (connected: boolean) => void;
  private _handle_rx: (frame: Uint8Array) => void;

  readonly port: Port;

  constructor(handle_link: (connected: boolean) => void, handle_rx: (frame: Uint8Array) => void) {
    super();
    this._handle_link = handle_link;
    this._handle_rx = handle_rx;

    this.port = new Port(false, ({ tx }) => {
      this._tx = tx;
      return {
        rx: this._handle_rx,
        link: this._handle_link,
      };
    });
  }

  tx(frame: Uint8Array) {
    this._tx(frame);
  }
}

class L2 extends System {
  private _learned: Map<bigint, { port: number; expires_at: number }> = new Map();
  private _links: boolean[];

  constructor(ports: number) {
    super();

    this._links = new Array(ports).fill(false);

    for (let i = 0; i < ports; i++) {
      const port = i;
      const dev = new HardwareEthernet(
        (connected) => this._handle_link(port, connected),
        (frame) => this._handle_rx(port, frame),
      );
      this.addDevice(dev);
    }

    setInterval(this._timer_expire_learned.bind(this), EXPIRE_INTERVAL_MS);
  }

  private _handle_link(port: number, connected: boolean) {
    this._links[port] = connected;
  }

  private _handle_rx(port: number, frame: Uint8Array) {
    const view = new DataView(frame.buffer, frame.byteOffset);
    const dst = view.getBigUint64(0) >> 16n;
    const src = view.getBigUint64(6) >> 16n;
    const known = this._learned.get(dst);

    if (known === undefined) {
      for (let i = 0; i < this._devices.length; i++) {
        if (i === port) continue;
        if (!this._links[i]) continue;
        const dev = this._devices[i] as HardwareEthernet;
        dev.tx(frame);
      }
    } else if (known.port !== port) {
      if (this._links[known.port]) {
        const dev = this._devices[known.port] as HardwareEthernet;
        dev.tx(frame);
      }
    }

    this._learn(src, port);
  }

  private _learn(mac: bigint, port: number) {
    this._learned.set(mac, {
      port,
      expires_at: Date.now() + TTL_MS,
    });
  }

  private _timer_expire_learned() {
    for (const [mac, learned] of this._learned) {
      if (learned.expires_at < Date.now()) {
        this._learned.delete(mac);
      }
    }
  }
}

function begin() {
  console.log("Hello unmanaged L2", self.name);

  const sys = new L2(16);

  onMessage((msg) => {
    if (msg.$ === "link/up") {
      const dev = sys._devices[msg.port];
      if (!(dev instanceof HardwareEthernet)) return;
      if (dev.port._outsides.length) return;
      expose(msg.port, dev.port);
    } else if (msg.$ === "link/down") {
      const dev = sys._devices[msg.port];
      if (!(dev instanceof HardwareEthernet)) return;
      dev.port.disconnect();
    }
  });
}

begin();
