import { beginWorker } from "../worker";

beginWorker({
  type: "Server",
  ethernet: [{ mac: 0x00n }, { mac: 0x01n }],
});
