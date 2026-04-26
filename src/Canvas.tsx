import TestWorker from "./devices/pc.worker.ts?worker";
import { hexdump, parseIPv4 } from "./devices/format.ts";
import { pack_arp_packet, pack_ethernet_frame } from "./devices/pack.ts";

const w = new TestWorker();

w.addEventListener("message", (e) => {
  if (e.data.$ === "ethernet_frame") {
    console.log(`PC[${e.data.port}] <=`, hexdump(e.data.frame));
  }
});

// Arp Request
{
  const frame = pack_ethernet_frame({
    dst: 0xff_ff_ff_ff_ff_ffn,
    src: 0xaa_bb_cc_dd_ee_ffn,
    etherType: 0x0806,
    payload: pack_arp_packet({
      hwType: 0x0001,
      protoType: 0x0800,
      hwSize: 6,
      protoSize: 4,
      op: 0x0001,
      src_mac: 0xff_00_ff_00_ff_00n,
      src_ip: parseIPv4("192.168.0.5"),
      dst_mac: 0x00n,
      dst_ip: parseIPv4("192.168.0.2"),
    }),
  });

  w.postMessage({ $: "ethernet_frame", port: 0, frame });
}

type TArchPC = {
  id: string;
  type: "pc";
  name: string;
  ports: { id: string; type: "ethernet" }[];
  ethernetPorts: { id: string; mac: string }[];
  ui: { x: number; y: number };
};
type TArchNode = TArchPC;
type TArchConnection = { id: string; a_id: string; a_pid: string; b_id: string; b_pid: string };

type TArchitecture = {
  title: string;
  node: TArchNode[];
  connections: TArchConnection[];
};

export function Canvas() {
  const arch: TArchitecture = {
    title: "Test",
    node: [
      {
        id: "pc0",
        type: "pc",
        name: "PC 0",
        ports: [{ id: "eth0", type: "ethernet" }],
        ethernetPorts: [{ id: "eth0", mac: "00:00:00:aa:aa:00" }],
        ui: { x: 0, y: 100 },
      },
      {
        id: "pc1",
        type: "pc",
        name: "PC 1",
        ports: [{ id: "eth0", type: "ethernet" }],
        ethernetPorts: [{ id: "eth0", mac: "00:00:00:aa:aa:01" }],
        ui: { x: 100, y: 100 },
      },
    ],
    connections: [{ id: "c0", a_id: "pc0", a_pid: "eth0", b_id: "pc1", b_pid: "eth0" }],
  };

  const itemSize = 48;

  return (
    <div className="relative" style={{ width: 1024, height: 768 }}>
      <svg className="absolute">
        {arch.connections.map((c) => {
          const a = arch.node.find((n) => n.id === c.a_id);
          const b = arch.node.find((n) => n.id === c.b_id);
          if (!a || !b) return null;

          return (
            <line
              key={c.id}
              className="stroke-2 stroke-sky-700"
              x1={a.ui.x + itemSize / 2}
              y1={a.ui.y + itemSize / 2}
              x2={b.ui.x + itemSize / 2}
              y2={b.ui.y + itemSize / 2}
            />
          );
        })}
      </svg>
      {arch.node.map((n) => {
        if (n.type === "pc") {
          return (
            <div
              key={n.id}
              className="absolute bg-sky-200 rounded-lg"
              style={{ left: n.ui.x, top: n.ui.y, width: itemSize, height: itemSize }}
            >
              {n.name}
            </div>
          );
        }
      })}
      <div className="absolute">
        <input
          className="block rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm invalid:border-pink-500 invalid:text-pink-600 focus:border-sky-500 focus:outline focus:outline-sky-500 focus:invalid:border-pink-500 focus:invalid:outline-pink-500 disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-500 disabled:shadow-none sm:text-sm dark:disabled:border-gray-700 dark:disabled:bg-gray-800/20"
          placeholder="Name"
        />
      </div>
    </div>
  );
}
