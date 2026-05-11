import { SimpleEthernet, Port } from "./device";
import { System, SimpleEthernetDriver } from "./system";
import { OS } from "./os";
import * as ifconfig from "./apps/ifconfig.app";
import * as arp from "./apps/arp.app";
import * as ping from "./apps/ping.app";
import * as dhcp from "./apps/dhcp.app";
import type { Bus } from "./bus";

function onMessage(handler: (message: Bus.Message.Master) => void, options: AddEventListenerOptions = {}) {
  self.addEventListener("message", (e: MessageEvent<Bus.Message.Master>) => handler(e.data), options);
}

function sendMessage(message: Bus.Message.Slave) {
  self.postMessage(message);
}

export function expose(port: number, devicePort: Port) {
  devicePort.connect(({ tx }) => {
    const controller = new AbortController();

    onMessage(
      (msg) => {
        if (msg.$ === "ethernet_frame") {
          if (msg.port !== port) return;
          tx(msg.frame);
        }
      },
      { signal: controller.signal },
    );

    return {
      rx: (frame) => {
        sendMessage({ $: "ethernet_frame", port, frame });
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
  os.on_print = (text) => sendMessage({ $: "print", text });

  for (let i = 0; i < system._devices.length; i += 1) {
    const dev = system._devices[i];

    if (dev instanceof SimpleEthernet) {
      new SimpleEthernetDriver(os, i);
      expose(i, dev.port);
    }
  }

  os.print(`Host ${self.name}\n`);
  os.install({ ...ifconfig, ...arp, ...ping, ...dhcp });

  onMessage((msg) => {
    if (msg.$ === "exec") {
      os.exec(msg.app, msg.args);
    }
  });

  return os;
}
