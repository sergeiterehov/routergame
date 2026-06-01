import type { OS, TApp } from "../os/os";
import { test_args } from "./app.lib";

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
  bind9: {
    description: "DNS server",
    get: () => import("./bind9.pkg"),
  },
  nginx: {
    description: "Nginx Web Server",
    get: () => import("./nginx.pkg"),
  },
  curl: {
    description: "HTTP client",
    get: () => import("./curl.pkg"),
  },
};

export const pkg: TApp = async (os, args, ctx) => {
  if (test_args(args, "install", Boolean)) {
    const names = args.slice(1);

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
  } else if (test_args(args, "ls")) {
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
  } else {
    throw new Error("usage:\n\tls\n\tinstall <package>");
  }
};
