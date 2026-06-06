import type { Bus } from "./bus";
import type { Port } from "../core/device";

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
