// @effect-diagnostics nodeBuiltinImport:off - Drives the real shell installer through a PTY and a gated HTTPS fixture.
import { HostProcessArchitecture, HostProcessPlatform } from "@e6tools/shared/hostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttps from "node:https";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

const installerPath = NodePath.resolve(import.meta.dirname, "install.sh");

function writeCert(directory: string) {
  const cert = NodePath.join(directory, "cert.pem");
  const key = NodePath.join(directory, "key.pem");
  NodeChildProcess.execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ]);
  return { cert, key };
}

async function writeCosign(binDir: string) {
  await NodeFSP.mkdir(binDir, { recursive: true });
  const script = `#!/bin/sh
set -eu
bundle=
previous=
blob=
for argument in "$@"; do
  if [ "$previous" = "--bundle" ]; then
    bundle=$argument
  fi
  previous=$argument
  blob=$argument
done
[ -n "$bundle" ] && [ -f "$bundle" ] || exit 2
cmp -s "$blob" "$COSIGN_TRUSTED_CHECKSUMS"
`;
  const path = NodePath.join(binDir, "cosign");
  await NodeFSP.writeFile(path, script, { mode: 0o755 });
  return path;
}

// util-linux's script gives the real installer a terminal without a browser or extra packages.
describe.skipIf(HostProcessPlatform.defaultValue() !== "linux")("installer terminal", () => {
  it.each([false, true])(
    "preserves download and install behavior (download failure: %s)",
    async (fail) => {
      const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-install-progress-"));
      const version = "1.2.3";
      const stem = `e6-${version}-linux-${HostProcessArchitecture.defaultValue()}`;
      const archiveName = `${stem}.tar.gz`;
      let resumeDownload: (() => void) | undefined;
      let sawPartialProgress = false;
      let output = "";
      await NodeFSP.mkdir(NodePath.join(root, stem));
      await NodeFSP.writeFile(NodePath.join(root, stem, "e6"), "#!/bin/sh\necho 'e6 v1.2.3'\n", {
        mode: 0o755,
      });
      await NodeFSP.writeFile(
        NodePath.join(root, stem, "payload"),
        NodeCrypto.randomBytes(64 * 1024),
      );
      NodeChildProcess.execFileSync("tar", [
        "-czf",
        NodePath.join(root, archiveName),
        "-C",
        root,
        stem,
      ]);
      const archive = await NodeFSP.readFile(NodePath.join(root, archiveName));
      const checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
      const sums = `${checksum}  ${archiveName}\n`;
      const trustedSums = NodePath.join(root, "trusted-SHA256SUMS");
      await NodeFSP.writeFile(trustedSums, sums);
      await writeCosign(NodePath.join(root, "bin-tools"));
      const { cert, key } = writeCert(root);
      const server = NodeHttps.createServer(
        { cert: await NodeFSP.readFile(cert), key: await NodeFSP.readFile(key) },
        (request, response) => {
          if (request.url?.endsWith("/SHA256SUMS.bundle")) {
            response.end("bundle\n");
          } else if (request.url?.endsWith("/SHA256SUMS")) {
            response.end(sums);
          } else if (fail) {
            response.writeHead(500).end();
          } else {
            response.writeHead(200, { "Content-Length": archive.length });
            resumeDownload = () => response.end(archive.subarray(Math.floor(archive.length / 2)));
            response.write(archive.subarray(0, Math.floor(archive.length / 2)));
          }
        },
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
      const installer = installerPath.replaceAll("'", "'\\''");
      const child = NodeChildProcess.spawn("script", ["-qec", `sh '${installer}'`, "/dev/null"], {
        env: {
          ...process.env,
          TERM: "xterm",
          NO_COLOR: "1",
          E6CODE_VERSION: version,
          E6CODE_HOME: NodePath.join(root, "home"),
          E6CODE_INSTALL_BIN_DIR: NodePath.join(root, "bin"),
          E6CODE_RELEASE_BASE_URL: `https://127.0.0.1:${address.port}`,
          E6CODE_SKIP_SIGNATURE_VERIFY: "",
          COSIGN_TRUSTED_CHECKSUMS: trustedSums,
          CURL_CA_BUNDLE: cert,
          SSL_CERT_FILE: cert,
          PATH: `${NodePath.join(root, "bin-tools")}:${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        if (!sawPartialProgress && /\b[1-9]\d?%/.test(output)) {
          sawPartialProgress = true;
          resumeDownload?.();
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.on("error", reject);
          child.on("close", resolve);
        });
        const versions = NodePath.join(root, "home/runtime/versions");
        if (fail) {
          expect(code).not.toBe(0);
          expect(output).toContain("500");
          expect(output).not.toContain("100%");
          expect(output).not.toContain("Installed E6 Code");
          expect(await NodeFSP.readdir(versions)).toEqual([]);
        } else {
          expect(code).toBe(0);
          expect(sawPartialProgress).toBe(true);
          expect(output).toContain("100%");
          expect(output).toContain("0.1 / 0.1 MB");
          expect(output).toContain("Installed E6 Code 1.2.3");
          expect(
            await NodeFSP.readFile(NodePath.join(versions, version, ".install-complete"), "utf8"),
          ).toBe("1.2.3\n");
          expect(
            NodeChildProcess.execFileSync(NodePath.join(root, "bin/e6"), ["--version"], {
              encoding: "utf8",
            }).trim(),
          ).toBe("e6 v1.2.3");
          expect(await NodeFSP.readdir(versions)).toEqual([version]);
        }
      } finally {
        if (child.exitCode === null) child.kill();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await NodeFSP.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects a tampered SHA256SUMS whose checksum matches the archive", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-install-tamper-"));
    const version = "1.2.3";
    const stem = `e6-${version}-linux-${HostProcessArchitecture.defaultValue()}`;
    const archiveName = `${stem}.tar.gz`;
    await NodeFSP.mkdir(NodePath.join(root, stem));
    await NodeFSP.writeFile(NodePath.join(root, stem, "e6"), "#!/bin/sh\necho 'tampered'\n", {
      mode: 0o755,
    });
    NodeChildProcess.execFileSync("tar", [
      "-czf",
      NodePath.join(root, archiveName),
      "-C",
      root,
      stem,
    ]);
    const archive = await NodeFSP.readFile(NodePath.join(root, archiveName));
    const checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
    const tamperedSums = `${checksum}  ${archiveName}\n`;
    const trustedSums = NodePath.join(root, "trusted-SHA256SUMS");
    await NodeFSP.writeFile(trustedSums, `${"a".repeat(64)}  ${archiveName}\n`);
    await writeCosign(NodePath.join(root, "bin-tools"));
    const { cert, key } = writeCert(root);
    const server = NodeHttps.createServer(
      { cert: await NodeFSP.readFile(cert), key: await NodeFSP.readFile(key) },
      (request, response) => {
        if (request.url?.endsWith("/SHA256SUMS.bundle")) response.end("bundle\n");
        else if (request.url?.endsWith("/SHA256SUMS")) response.end(tamperedSums);
        else {
          response.writeHead(200, { "Content-Length": archive.length });
          response.end(archive);
        }
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    let output = "";
    const child = NodeChildProcess.spawn("sh", [installerPath], {
      env: {
        ...process.env,
        TERM: "dumb",
        E6CODE_VERSION: version,
        E6CODE_HOME: NodePath.join(root, "home"),
        E6CODE_INSTALL_BIN_DIR: NodePath.join(root, "bin"),
        E6CODE_RELEASE_BASE_URL: `https://127.0.0.1:${address.port}`,
        E6CODE_SKIP_SIGNATURE_VERIFY: "1",
        COSIGN_TRUSTED_CHECKSUMS: trustedSums,
        CURL_CA_BUNDLE: cert,
        SSL_CERT_FILE: cert,
        PATH: `${NodePath.join(root, "bin-tools")}:/usr/bin:/bin`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      expect(code).not.toBe(0);
      expect(output).toContain("signature verification failed for SHA256SUMS");
      expect(output).not.toContain("Installed E6 Code");
      expect(await NodeFSP.readdir(NodePath.join(root, "home/runtime/versions"))).toEqual([]);
    } finally {
      if (child.exitCode === null) child.kill();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to skip signature verification for a non-default release host", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "e6-install-skip-"));
    const version = "1.2.3";
    const stem = `e6-${version}-linux-${HostProcessArchitecture.defaultValue()}`;
    const archiveName = `${stem}.tar.gz`;
    await NodeFSP.mkdir(NodePath.join(root, stem));
    await NodeFSP.writeFile(NodePath.join(root, stem, "e6"), "#!/bin/sh\necho 'e6'\n", {
      mode: 0o755,
    });
    NodeChildProcess.execFileSync("tar", [
      "-czf",
      NodePath.join(root, archiveName),
      "-C",
      root,
      stem,
    ]);
    const archive = await NodeFSP.readFile(NodePath.join(root, archiveName));
    const checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
    const { cert, key } = writeCert(root);
    const minimalBin = NodePath.join(root, "minimal-bin");
    await NodeFSP.mkdir(minimalBin);
    for (const name of [
      "curl",
      "tar",
      "sha256sum",
      "grep",
      "sed",
      "head",
      "mktemp",
      "uname",
      "cat",
      "mkdir",
      "ln",
      "cut",
      "rm",
      "mv",
      "wc",
    ]) {
      const source = NodeChildProcess.execFileSync("/bin/sh", ["-c", `command -v ${name}`], {
        encoding: "utf8",
      }).trim();
      await NodeFSP.symlink(source, NodePath.join(minimalBin, name));
    }
    const server = NodeHttps.createServer(
      { cert: await NodeFSP.readFile(cert), key: await NodeFSP.readFile(key) },
      (request, response) => {
        if (request.url?.endsWith("/SHA256SUMS")) {
          response.end(`${checksum}  ${archiveName}\n`);
        } else {
          response.writeHead(200, { "Content-Length": archive.length });
          response.end(archive);
        }
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    let output = "";
    const child = NodeChildProcess.spawn("/bin/sh", [installerPath], {
      env: {
        ...process.env,
        TERM: "dumb",
        E6CODE_VERSION: version,
        E6CODE_HOME: NodePath.join(root, "home"),
        E6CODE_INSTALL_BIN_DIR: NodePath.join(root, "bin"),
        E6CODE_RELEASE_BASE_URL: `https://127.0.0.1:${address.port}`,
        E6CODE_SKIP_SIGNATURE_VERIFY: "1",
        CURL_CA_BUNDLE: cert,
        SSL_CERT_FILE: cert,
        PATH: minimalBin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      expect(code).not.toBe(0);
      expect(output).toContain("cannot be skipped");
      expect(output).not.toContain("Installed E6 Code");
      expect(output).not.toContain("WARNING: signature verification skipped");
    } finally {
      if (child.exitCode === null) child.kill();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
