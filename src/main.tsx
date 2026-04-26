import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TestWorker from "./devices/pc.worker.ts?worker";
import { hexdump, parseIPv4 } from "./devices/format.ts";

const w = new TestWorker();

w.addEventListener("message", (e) => {
  if (e.data.$ === "ethernet_frame") {
    console.log(`PC[${e.data.port}] <=`, hexdump(e.data.frame));
  }
});

// Arp Request
{
  const frame = new Uint8Array(6 + 6 + 2 + 28);
  const view = new DataView(frame.buffer);
  view.setBigUint64(0, 0xff_ff_ff_ff_ff_ffn << 16n);
  view.setBigUint64(6, 0xaa_bb_cc_dd_ee_ffn << 16n);
  view.setUint16(12, 0x0806);
  view.setUint16(14, 0x0001);
  view.setUint16(16, 0x0800);
  view.setUint8(18, 0x06);
  view.setUint8(19, 0x04);
  view.setUint16(20, 0x0001);
  view.setBigUint64(22, 0xff_00_ff_00_ff_00n << 16n);
  view.setUint32(28, parseIPv4("192.168.0.5"));
  view.setBigUint64(32, 0x00n);
  view.setUint32(38, parseIPv4("192.168.0.2"));

  w.postMessage({ $: "ethernet_frame", port: 0, frame });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div>See console...</div>
  </StrictMode>,
);
