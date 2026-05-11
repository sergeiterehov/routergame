import { observer } from "mobx-react-lite";
import { store, type TArchNode, TOOL } from "./state/store.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { autorun } from "mobx";
import { IconDeviceImac, IconServer2, IconTopologyBus, IconTopologyStar } from "@tabler/icons-react";

const itemSize = 64;

const Type2Color: { [key in TArchNode["type"]]?: string } = {
  pc: "bg-sky-200",
  router: "bg-violet-200",
  server: "bg-green-200",
  l2: "bg-gray-200",
};
const Type2Icon: { [key in TArchNode["type"]]?: typeof IconDeviceImac } = {
  pc: IconDeviceImac,
  router: IconTopologyStar,
  server: IconServer2,
  l2: IconTopologyBus,
};

const ConnectionPortSelector = observer(function ConnectionPortSelector() {
  const { port_selector } = store.connecting_tool;
  if (!port_selector) return;

  const { node, free_ports } = port_selector;

  return (
    <div
      className="absolute rounded-lg bg-white outline outline-black/5 p-1 shadow-md ml-2 min-w-25 select-none"
      style={{ left: node.ui.x + itemSize, top: node.ui.y }}
    >
      {free_ports.map((p) => {
        return (
          <div
            className="px-2 py-1 rounded-md cursor-pointer hover:bg-black/5"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              store.connecting_tool.select_port(p.id);
            }}
          >
            {p.id}
          </div>
        );
      })}
    </div>
  );
});

export const Canvas = observer(function Canvas() {
  const { active_id, tool, grid } = store;

  const connections = store.arch.connections.filter((c) => c.a_id === active_id || c.b_id === active_id);
  const siblings_ids = connections.map((c) => (c.a_id === active_id ? c.b_id : c.a_id));

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [drug, drug_set] = useState<{
    id: string;
    ui: { x: number; y: number };
    start: { x: number; y: number };
    current: { x: number; y: number };
  }>();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const controller = new AbortController();

    root.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        store.viewport_position_set(store.viewport_position.x - e.deltaX, store.viewport_position.y - e.deltaY);
      },
      { passive: false, signal: controller.signal },
    );

    autorun(
      () => {
        canvas.style.left = `${store.viewport_position.x}px`;
        canvas.style.top = `${store.viewport_position.y}px`;
      },
      { signal: controller.signal },
    );

    return () => controller.abort();
  }, []);

  useLayoutEffect(() => {
    if (!drug) return;

    const controller = new AbortController();

    const wrap_grid = (val: number) => (grid > 1 ? grid * Math.round(val / grid) : val);

    document.body.addEventListener(
      "mousemove",
      (e) => {
        drug.current = { x: e.clientX, y: e.clientY };
        store.move_node(
          drug.id,
          wrap_grid(drug.ui.x + (drug.current.x - drug.start.x)),
          wrap_grid(drug.ui.y + (drug.current.y - drug.start.y)),
        );
      },
      { signal: controller.signal },
    );
    document.body.addEventListener(
      "mouseup",
      (e) => {
        if (drug.current.x === drug.start.x && drug.current.y === drug.start.y) {
          e.preventDefault();
          e.stopPropagation();
          store.active_id_set(drug.id);
        }

        drug_set(undefined);
      },
      { signal: controller.signal },
    );

    return () => controller.abort();
  }, [drug, grid]);

  const canvas_size = { w: 0, h: 0 };
  for (const n of store.arch.node) {
    canvas_size.w = Math.max(canvas_size.w, n.ui.x + itemSize);
    canvas_size.h = Math.max(canvas_size.h, n.ui.y + itemSize);
  }

  return (
    <div
      ref={rootRef}
      className="relative w-full h-full overflow-hidden select-none"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        store.active_id_set();
      }}
    >
      <div ref={canvasRef} className="absolute">
        <svg className="absolute" width={canvas_size.w} height={canvas_size.h}>
          {store.arch.connections.map((c) => {
            const a = store.arch.node.find((n) => n.id === c.a_id);
            const b = store.arch.node.find((n) => n.id === c.b_id);
            if (!a || !b) return null;

            return (
              <line
                key={c.id}
                className={`stroke-2 ${connections.includes(c) ? "stroke-sky-700" : "stroke-sky-500"}`}
                x1={a.ui.x + itemSize / 2}
                y1={a.ui.y + itemSize / 2}
                x2={b.ui.x + itemSize / 2}
                y2={b.ui.y + itemSize / 2}
              />
            );
          })}
        </svg>
        {store.arch.node.map((n) => {
          const color = Type2Color[n.type];
          const Icon = Type2Icon[n.type];
          return (
            <div
              key={n.id}
              className={[
                "absolute cursor-pointer flex text-center text-xs justify-center items-center overflow-hidden rounded-lg border-2",
                "flex flex-col",
                n.id === active_id
                  ? "border-black"
                  : siblings_ids.includes(n.id)
                    ? `border-gray-500 border-dashed`
                    : "border-transparent",
                !store.instances[n.id] ? "outline-2 outline-red-300" : "",
                tool === TOOL.CONNECT && store.connecting_tool.a_id === n.id ? "outline-4 outline-indigo-500!" : "",
                color ?? "bg-gray-500 text-gray-400",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                left: n.ui.x,
                top: n.ui.y,
                width: itemSize,
                height: itemSize,
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();

                if (tool === TOOL.NONE) {
                  drug_set({
                    id: n.id,
                    ui: { x: n.ui.x, y: n.ui.y },
                    start: { x: e.clientX, y: e.clientY },
                    current: { x: e.clientX, y: e.clientY },
                  });
                } else if (tool === TOOL.CONNECT) {
                  store.connecting_tool.select_node(n);
                }
              }}
            >
              {Icon && <Icon className="opacity-50" size={24} stroke="1" />}
              <div>{n.name}</div>
            </div>
          );
        })}
        {tool === TOOL.CONNECT && <ConnectionPortSelector />}
      </div>
    </div>
  );
});
