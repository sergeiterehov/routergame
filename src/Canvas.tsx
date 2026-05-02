import TestWorker from "./devices/pc.worker.ts?worker";
import { hexdump } from "./devices/format.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type TArchPC = {
  id: string;
  type: "pc";
  name: string;
  ports: { id: string; type: "ethernet" }[];
  ethernetPorts: { id: string; mac: string }[];
  init: string[];
  ui: { x: number; y: number };
};
type TArchNode = TArchPC;
type TArchConnection = {
  id: string;
  a_id: string;
  a_pid: string;
  b_id: string;
  b_pid: string;
  delay: number;
  speed: number;
};

type TArchitecture = {
  title: string;
  node: TArchNode[];
  connections: TArchConnection[];
};

const arch: TArchitecture = {
  title: "Test",
  node: [
    {
      id: "pc0",
      type: "pc",
      name: "PC 0",
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
      ],
      ethernetPorts: [
        { id: "eth0", mac: "00:00:00:aa:aa:00" },
        { id: "eth1", mac: "00:00:00:bb:bb:00" },
      ],
      init: ["iface eth0 add 10.0.0.1/24", "route add 10.0.0.0/24 dev eth0"],
      ui: { x: 50, y: 50 },
    },
    {
      id: "pc1",
      type: "pc",
      name: "PC 1",
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
      ],
      ethernetPorts: [
        { id: "eth0", mac: "00:00:00:aa:aa:01" },
        { id: "eth1", mac: "00:00:00:bb:bb:01" },
      ],
      init: [
        "iface eth0 add 10.0.0.2/24",
        "route add 10.0.0.0/24 dev eth0",
        "iface eth1 add 192.168.0.2/24",
        "route add 192.168.0.0/24 dev eth1",
      ],
      ui: { x: 150, y: 50 },
    },
    {
      id: "pc2",
      type: "pc",
      name: "PC 2",
      ports: [
        { id: "eth0", type: "ethernet" },
        { id: "eth1", type: "ethernet" },
      ],
      ethernetPorts: [
        { id: "eth0", mac: "00:00:00:aa:aa:02" },
        { id: "eth1", mac: "00:00:00:bb:bb:02" },
      ],
      init: ["iface eth0 add 192.168.0.1/24", "route add 192.168.0.0/24 dev eth0"],
      ui: { x: 150, y: 150 },
    },
  ],
  connections: [
    { id: "c0", a_id: "pc0", a_pid: "eth0", b_id: "pc1", b_pid: "eth0", delay: 0, speed: 100_000_000 },
    { id: "c1", a_id: "pc1", a_pid: "eth1", b_id: "pc2", b_pid: "eth0", delay: 0, speed: 100_000_000 },
  ],
};

export function Canvas() {
  const [activePc, setActivePc] = useState<string>("");
  const [tty, setTty] = useState<{ [key: string]: string }>({});
  const [pcs] = useState<{ [key: string]: Worker }>(() => {
    const _pcs: { [key: string]: Worker } = {};

    for (const n of arch.node) {
      const w = new TestWorker({ name: n.id });

      w.addEventListener("message", (e) => {
        if (e.data.$ === "ethernet_frame") {
          const pid = n.ports[e.data.port].id;
          for (const c of arch.connections) {
            let targetNode: TArchNode | undefined;
            let targetPort: number | undefined;

            if (c.a_id === n.id && c.a_pid === pid) {
              targetNode = arch.node.find((n) => n.id === c.b_id);
              targetPort = targetNode?.ports.findIndex((p) => p.id === c.b_pid);
            } else if (c.b_id === n.id && c.b_pid === pid) {
              targetNode = arch.node.find((n) => n.id === c.a_id);
              targetPort = targetNode?.ports.findIndex((p) => p.id === c.a_pid);
            } else {
              continue;
            }

            if (!targetNode || targetPort === undefined || targetPort === -1) continue;

            const target = _pcs[targetNode.id];
            if (!target) continue;

            console.log(`PC[${n.id}:${e.data.port}] => PC[${targetNode.id}:${targetPort}]\n${hexdump(e.data.frame)}`);

            const time = c.delay + (1000 * e.data.frame.length) / c.speed;
            setTimeout(() => target.postMessage({ $: "ethernet_frame", port: targetPort, frame: e.data.frame }), time);
            break;
          }
        } else if (e.data.$ === "print") {
          setTty((prev) => ({ ...prev, [n.id]: (prev[n.id] || "") + e.data.text }));
        }
      });

      for (const eth of n.ethernetPorts) {
        w.postMessage({ $: "exec", app: "iface", args: [eth.id, "mac", eth.mac] });
      }

      for (const cmd of n.init) {
        const [app, ...args] = cmd.split(/\s+/);
        w.postMessage({ $: "exec", app, args });
      }

      _pcs[n.id] = w;
    }

    return _pcs;
  });
  const [pHistory, setPHistory] = useState<number>(-1);
  const [history, setHistory] = useState<string[]>([]);
  const [cmd, setCmd] = useState<string>("");
  const consoleRef = useRef<HTMLPreElement>(null);
  const actualCmd = pHistory !== -1 ? history[pHistory] : cmd;

  useLayoutEffect(() => consoleRef.current?.scrollTo({ top: 999999 }), [tty]);

  useEffect(
    () => () => {
      for (const pc of Object.values(pcs)) {
        pc.terminate();
      }
    },
    [],
  );

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
              className={`absolute bg-sky-200 rounded-lg border-2 ${n.id === activePc ? "border-black" : "border-transparent"}`}
              style={{ left: n.ui.x, top: n.ui.y, width: itemSize, height: itemSize }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActivePc(n.id);
              }}
            >
              {n.name}
            </div>
          );
        }
      })}
      <div
        className="absolute flex flex-col bg-black text-white"
        style={{ left: 100, top: 200, width: 600, height: 400 }}
      >
        <pre ref={consoleRef} className="grow overflow-x-hidden overflow-y-scroll whitespace-pre-wrap wrap-break-word">
          {tty[activePc]}
        </pre>
        <input
          className="block font-mono border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm invalid:border-pink-500 invalid:text-pink-600 focus:border-sky-500 focus:outline focus:outline-sky-500 focus:invalid:border-pink-500 focus:invalid:outline-pink-500 disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-500 disabled:shadow-none sm:text-sm dark:disabled:border-gray-700 dark:disabled:bg-gray-800/20"
          placeholder="#"
          disabled={!activePc}
          value={actualCmd}
          onChange={(e) => {
            setCmd(e.currentTarget.value);
            setPHistory(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();

              setTty((prev) => ({ ...prev, [activePc]: (prev[activePc] || "") + "# " + actualCmd + "\n" }));
              setHistory((prev) => [...prev, actualCmd]);
              setPHistory(-1);
              setCmd("");

              const [app, ...args] = actualCmd.split(/\s+/);

              if (app === "clear") return setTty((prev) => ({ ...prev, [activePc]: "" }));
              pcs[activePc]?.postMessage({ $: "exec", app, args });

              return;
            }

            if (e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();

              if (!history.length) return;

              setPHistory((prev) => {
                if (prev === -1) return history.length - 1;

                return Math.max(0, prev - 1);
              });
            }

            if (e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();

              if (!history.length) return;

              setPHistory((prev) => {
                if (prev === -1) return prev;
                if (prev === history.length - 1) return -1;

                return Math.min(history.length - 1, prev + 1);
              });
            }
          }}
        />
      </div>
    </div>
  );
}
