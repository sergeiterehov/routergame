import { Port } from "./device";
import { System } from "./system";
import { OS } from "./os/os";
import { init } from "./apps/init.app";
import * as ifconfig from "./apps/ifconfig.app";
import * as arp from "./apps/arp.app";
import * as ping from "./apps/ping.app";
import * as dhcp from "./apps/dhcp.app";
import * as cat from "./apps/cat.app";
import type { Bus } from "./bus";
import { SimpleEthernet, SimpleEthernetDriver } from "./simpleEthernet";

export function onMessage(handler: (message: Bus.Message.Master) => void, options: AddEventListenerOptions = {}) {
  self.addEventListener("message", (e: MessageEvent<Bus.Message.Master>) => handler(e.data), options);
}

export function sendMessage(message: Bus.Message.Slave) {
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
  os.fs.on_change = (fs) => sendMessage({ $: "fs", fs });

  for (let i = 0; i < system._devices.length; i += 1) {
    const dev = system._devices[i];

    // Устанавливаем драйверы
    if (dev instanceof SimpleEthernet) {
      new SimpleEthernetDriver(os, i);
    }
  }

  os.print(`Host ${self.name}\n`);
  os.install({ init, ...ifconfig, ...arp, ...ping, ...dhcp, ...cat });

  onMessage((msg) => {
    if (msg.$ === "exec") {
      os.exec(msg.app, msg.args);
    } else if (msg.$ === "link/up") {
      const dev = system._devices.at(msg.port);
      if (!(dev instanceof SimpleEthernet)) return;
      if (dev.port._outsides.length) return;

      expose(msg.port, dev.port);
    } else if (msg.$ === "link/down") {
      const dev = system._devices.at(msg.port);
      if (!(dev instanceof SimpleEthernet)) return;

      dev.port.disconnect();
    } else if (msg.$ === "fs") {
      for (const [key, value] of Object.entries(msg.fs)) {
        if (typeof value === "string") {
          os.fs._fs[key] = value;
        } else {
          delete os.fs._fs[key];
        }
      }
    }
  });

  return os;
}
