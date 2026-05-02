import { SimpleEthernet, Port } from "./device";
import { System, SimpleEthernetDriver } from "./system";
import { OS } from "./os";
import * as ifconfig from "./apps/ifconfig.app";
import * as arp from "./apps/arp.app";
import * as ping from "./apps/ping.app";

export function expose(port: number, devicePort: Port) {
  devicePort.connect(({ tx }) => {
    const controller = new AbortController();

    self.addEventListener(
      "message",
      (e: MessageEvent<{ $: "ethernet_frame"; port: number; frame: Uint8Array }>) => {
        if (e.data.$ === "ethernet_frame") {
          if (e.data.port !== port) return;
          tx(e.data.frame);
        }
      },
      { signal: controller.signal },
    );

    return {
      rx: (frame) => {
        self.postMessage({ $: "ethernet_frame", port, frame });
      },
      link: (connected) => {
        if (!connected) controller.abort();
      },
    };
  });
}

export function beginWorker(config: { type: string; ethernet?: { mac: bigint }[] } = { type: "unknown" }) {
  console.log("Hello", config.type, self.name);

  const system = new System();

  if (config.ethernet) {
    for (const { mac } of config.ethernet) {
      system.addDevice(new SimpleEthernet(mac));
    }
  }

  const os = new OS(system);
  os.on_print = (text) => self.postMessage({ $: "print", text });

  for (let i = 0; i < system._devices.length; i += 1) {
    const dev = system._devices[i];

    if (dev instanceof SimpleEthernet) {
      new SimpleEthernetDriver(os, i);
      expose(i, dev.port);
    }
  }

  os.print(`Host ${self.name}\n`);
  os.install({ ...ifconfig, ...arp, ...ping });

  self.addEventListener("message", (e: MessageEvent<{ $: "exec"; app: string; args: string[] }>) => {
    if (e.data.$ === "exec") {
      os.exec(e.data.app, e.data.args);
    }
  });
}
