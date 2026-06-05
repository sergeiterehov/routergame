import { beginWorkerOS } from "./helpers";

beginWorkerOS({
  type: "PC",
  ethernet: [{ mac: 0x00n }],
});
