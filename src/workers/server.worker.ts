import { beginWorkerOS } from "./helpers";

beginWorkerOS({
  type: "Server",
  ethernet: [{ mac: 0x00n }, { mac: 0x01n }],
});
