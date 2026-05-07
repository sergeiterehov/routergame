import { observer } from "mobx-react-lite";
import { store, type TArchNode } from "./store.ts";
import { useEffect, useState } from "react";

const itemSize = 64;

const Type2Color: { [key in TArchNode["type"]]?: string } = {
  pc: "bg-sky-200",
  router: "bg-violet-200",
  server: "bg-green-200",
  l2: "bg-gray-200",
};

export const Canvas = observer(function Canvas() {
  const { active_id } = store;

  const connections = store.arch.connections.filter((c) => c.a_id === active_id || c.b_id === active_id);
  const siblings_ids = connections.map((c) => (c.a_id === active_id ? c.b_id : c.a_id));

  const [grid, grid_set] = useState(50);
  const [drug, drug_set] = useState<{
    id: string;
    ui: { x: number; y: number };
    start: { x: number; y: number };
    current: { x: number; y: number };
  }>();

  useEffect(() => {
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
    document.body.addEventListener("mouseup", () => drug_set(undefined), { signal: controller.signal });

    return () => controller.abort();
  }, [drug, grid]);

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        store.active_id_set();
      }}
    >
      <svg className="absolute w-full h-full">
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
        return (
          <div
            key={n.id}
            className={`absolute cursor-pointer flex text-center justify-center items-center overflow-hidden rounded-lg border-2 ${n.id === active_id ? "border-black" : siblings_ids.includes(n.id) ? `border-gray-500 border-dashed` : "border-transparent"} ${store.instances[n.id] ? "" : "outline-2 outline-red-300"} ${color ?? "bg-gray-500 text-gray-400"}`}
            style={{
              left: n.ui.x,
              top: n.ui.y,
              width: itemSize,
              height: itemSize,
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              store.active_id_set(n.id);
            }}
            onMouseDown={(e) => {
              drug_set({
                id: n.id,
                ui: { x: n.ui.x, y: n.ui.y },
                start: { x: e.clientX, y: e.clientY },
                current: { x: e.clientX, y: e.clientY },
              });
            }}
          >
            {n.name}
          </div>
        );
      })}
    </div>
  );
});
