import { observer } from "mobx-react-lite";
import { animated, useSpring } from "@react-spring/web";
import { store, TOOL, type TArchConnection } from "./state/store.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { autorun } from "mobx";
import { IconDeviceImac, IconServer2, IconTopologyBus, IconSwitch3 } from "@tabler/icons-react";

const itemSize = 64;

const Type2Color: { [key in string]?: string } = {
  pc: "bg-sky-500/40",
  router: "bg-violet-500/40",
  server: "bg-green-500/40",
  switch: "bg-gray-500/40",
};
const Type2Icon: { [key in string]?: typeof IconDeviceImac } = {
  pc: IconDeviceImac,
  server: IconServer2,
  router: IconSwitch3,
  switch: IconTopologyBus,
};

const ConnectionPortSelector = observer(function ConnectionPortSelector() {
  const { port_selector } = store.connecting_tool;
  if (!port_selector) return;

  const { node, free_ports } = port_selector;

  return (
    <div
      className="absolute rounded-lg bg-base-200 outline outline-base-300 p-1 shadow-lg ml-2 min-w-25 select-none"
      style={{ left: node.ui.x + itemSize, top: node.ui.y }}
    >
      {free_ports.map((p) => {
        return (
          <div
            key={p.id}
            className="px-2 py-1 rounded-md cursor-pointer hover:bg-base-300"
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

const Connection = observer(function Connection(props: { c: TArchConnection }) {
  const { c } = props;
  const { selected_connection_ids, selected_node_ids, tool } = store;

  const is_selected = selected_connection_ids.includes(c.id);
  const is_via_selected = selected_node_ids.includes(c.a_id) || selected_node_ids.includes(c.b_id);

  const base_color = is_selected || is_via_selected ? "#000" : "#666";

  const [a_props, a_api] = useSpring(
    () => ({ config: { duration: 100 }, strokeWidth: is_selected ? 4 : 2, stroke: base_color }),
    [is_selected, base_color],
  );

  const blink_ref = useRef({ base_color });
  blink_ref.current = { base_color };

  useEffect(() => {
    return autorun(() => {
      const _ = store.connection_metrics[c.id]?.last_frame_at;
      if (!_) return;
      a_api.set({ stroke: "#0F0" });
      a_api.start({ stroke: blink_ref.current.base_color, config: { duration: 1_000 } });
    });
  }, [c.id, a_api]);

  const a = store.node_by_id(c.a_id);
  if (!a) return null;
  const b = store.node_by_id(c.b_id);
  if (!b) return null;

  return (
    <animated.line
      className="cursor-pointer"
      x1={a.ui.x + itemSize / 2}
      y1={a.ui.y + itemSize / 2}
      x2={b.ui.x + itemSize / 2}
      y2={b.ui.y + itemSize / 2}
      style={a_props}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();

        if (tool === TOOL.NONE) {
          if (e.shiftKey) {
            store.selected_toggle("connection", c.id);
          } else {
            store.selected_set("connection", c.id);
          }
        }
      }}
    />
  );
});

export const Canvas = observer(function Canvas() {
  const { selected_node_ids, tool, grid } = store;

  const connections = store.arch.connections.filter(
    (c) => selected_node_ids.includes(c.a_id) || selected_node_ids.includes(c.b_id),
  );
  const siblings_ids = connections.map((c) => (selected_node_ids.includes(c.a_id) ? c.b_id : c.a_id));

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
        store.node_move(
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
          if (e.shiftKey) {
            store.selected_toggle("node", drug.id);
          } else {
            store.selected_set("node", drug.id);
          }
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
        if (!e.shiftKey) store.selected_clear();
      }}
    >
      <div ref={canvasRef} className="absolute">
        <svg className="absolute" width={canvas_size.w} height={canvas_size.h}>
          {store.arch.connections.map((c) => (
            <Connection key={c.id} c={c} />
          ))}
        </svg>
        {store.arch.node.map((n) => {
          const color = Type2Color[n.category!];
          const Icon = Type2Icon[n.category!];
          return (
            <div
              key={n.id}
              className={[
                "absolute backdrop-blur-md shadow-2xl cursor-pointer flex text-center text-xs justify-center items-center overflow-hidden rounded-lg border-2",
                "flex flex-col",
                selected_node_ids.includes(n.id)
                  ? "border-base-content"
                  : siblings_ids.includes(n.id)
                    ? `border-base-content/50 border-dashed`
                    : "border-transparent",
                !store.instances[n.id] ? "outline-2 outline-red-300" : "",
                tool === TOOL.CONNECT && store.connecting_tool.a_id === n.id ? "outline-4 outline-indigo-500!" : "",
                color ?? "bg-base-200 text-base-content/30",
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
