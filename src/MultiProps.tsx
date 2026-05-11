import { observer } from "mobx-react-lite";
import { store } from "./state/store";

export const MultiProps = observer(function MultiProps() {
  const node_ids = store.selected_node_ids;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-semibold">{`Selected ${store.selected.length} objects`}</div>
      <div className="flex gap-2 *:grow">
        <div
          className="cursor-pointer text-center rounded-lg p-2 border border-transparent bg-red-400 text-white hover:bg-red-500 select-none"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            for (const id of node_ids) store.node_terminate(id);
          }}
        >
          Power off
        </div>
        <div
          className="cursor-pointer text-center rounded-lg p-2 border border-transparent bg-green-400 text-white hover:bg-green-500 select-none"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            for (const id of node_ids) store.node_reboot(id);
          }}
        >
          Power on
        </div>
      </div>
      <div
        className="cursor-pointer text-center rounded-lg p-2 text-red-500 border border-red-500 hover:bg-red-500 hover:text-white select-none"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          if (confirm("Are you sure?")) {
            for (const id of node_ids) store.node_delete(id);
          }
        }}
      >
        Delete
      </div>
      <div className="h-25 shrink-0"></div>
    </div>
  );
});
