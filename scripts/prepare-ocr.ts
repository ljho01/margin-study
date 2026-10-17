import { mkdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const source = new URL("./ocr.swift", import.meta.url).pathname;
const target = new URL("../src-tauri/binaries/margin-ocr", import.meta.url)
  .pathname;
const fresh = await Promise.all([stat(source), stat(target)])
  .then(([a, b]) => b.mtimeMs >= a.mtimeMs)
  .catch(() => false);
if (!fresh) {
  await mkdir(new URL("../src-tauri/binaries", import.meta.url), {
    recursive: true,
  });
  execFileSync(
    "xcrun",
    ["swiftc", "-O", "-target", "arm64-apple-macos13", source, "-o", target],
    {
      stdio: "inherit",
    },
  );
  execFileSync("codesign", ["--force", "--sign", "-", target], {
    stdio: "inherit",
  });
}
