import type { OS, TApp, TAppContext } from "../os/os";
import { with_commander } from "./app.lib";

const _PACKAGES: Record<
  string,
  {
    description: string;
    get: () => Promise<Record<string, TApp>>;
  }
> = {
  net_tools: {
    description: "Network tools",
    get: () => import("./net_tools.pkg"),
  },
  iputils: {
    description: "IP utils",
    get: () => import("./iputils.pkg"),
  },
  dhcp: {
    description: "DHCP client and server",
    get: () => import("./dhcp.pkg"),
  },
  fw: {
    description: "Firewall",
    get: () => import("./fw.pkg"),
  },
  bind8: {
    description: "DNS server",
    get: () => import("./bind8.pkg"),
  },
  nginy: {
    description: "NGINX-like Web Server",
    get: () => import("./nginy.pkg"),
  },
  url: {
    description: "Curl-like HTTP client",
    get: () => import("./url.pkg"),
  },
};

const _install = async (os: OS, ctx: TAppContext, args: { names: string[] }) => {
  const { names } = args;

  for (const name of names) {
    if (!Object.hasOwn(_PACKAGES, name)) {
      throw new Error(`Package ${name} not found`);
    }
  }

  for (const name of names) {
    os.print(`Installing ${name}...\n`);
    const apps = await _PACKAGES[name].get();
    os.install(apps);
  }
};

const _ls = async (os: OS, ctx: TAppContext) => {
  os.print("Available packages:\n");
  let apps_counter = 0;
  for (const name of Object.keys(_PACKAGES)) {
    const pkg = _PACKAGES[name];
    os.print(`${name}: ${pkg.description}\n`);

    const apps = await new Promise<Record<string, TApp>>((resolve, reject) => {
      pkg.get().then(resolve, reject);
      ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });

    for (const app of Object.keys(apps)) {
      os.print(`\t- ${app}\n`);
      apps_counter += 1;
    }
  }
  os.print(`Total: ${Object.keys(_PACKAGES).length} packages, ${apps_counter} apps\n`);
};

export const pkg = with_commander({
  ls: {
    desc: "Show all available packages and applications",
    fn: () => (os, _, ctx) => _ls(os, ctx),
  },
  install: {
    desc: "Install one or more packages",
    args: [{ alias: "name", type: "string", multiple: true, required: true, desc: "Package name" }],
    fn: (parsed) => (os, _, ctx) => _install(os, ctx, { names: parsed.name! }),
  },
});
