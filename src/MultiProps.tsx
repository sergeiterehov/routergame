import { observer } from "mobx-react-lite";
import { store } from "./state/store";

export const MultiProps = observer(function MultiProps() {
  const { selected_node_ids, selected_connection_ids } = store;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-semibold">{`Selected ${store.selected.length} objects`}</div>
      {selected_node_ids.length > 0 && (
        <div className="flex gap-2 *:grow">
          <div
            className="cursor-pointer text-center rounded-lg p-2 border border-transparent bg-red-400 text-white hover:bg-red-500 select-none"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              for (const id of selected_node_ids) store.node_terminate(id);
            }}
          >
            Power off
          </div>
          <div
            className="cursor-pointer text-center rounded-lg p-2 border border-transparent bg-green-400 text-white hover:bg-green-500 select-none"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              for (const id of selected_node_ids) {
                if (!store.instances[id]) store.node_reboot(id);
              }
            }}
          >
            Power on
          </div>
        </div>
      )}
      <div
        className="cursor-pointer text-center rounded-lg p-2 text-red-500 border border-red-500 hover:bg-red-500 hover:text-white select-none"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          if (confirm("Are you sure?")) {
            for (const id of selected_connection_ids) store.connection_delete(id);
            for (const id of selected_node_ids) store.node_delete(id);
          }
        }}
      >
        Delete
      </div>
      <div className="h-25 shrink-0"></div>
    </div>
  );
});
