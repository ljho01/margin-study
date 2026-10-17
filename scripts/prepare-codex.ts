import { copyFile, chmod, access, mkdir, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const binaries = new URL("../src-tauri/binaries/", import.meta.url);
let source = process.env.MARGIN_CODEX_BINARY;
if (!source) {
  try {
    source = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Codex CLI가 필요합니다. 설치 후 다시 빌드하세요.");
  }
}
await access(source);
const real = await realpath(source);
// Models that expose tools only through Code Mode need the host next to codex.
const hosts = [
  process.env.MARGIN_CODE_MODE_HOST,
  join(dirname(real), "codex-code-mode-host"),
  join(dirname(real), "../../../bin/codex-code-mode-host"),
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex-code-mode-host",
  "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex-code-mode-host",
].filter((path): path is string => !!path);
let host: string | undefined;
for (const candidate of hosts) {
  try {
    await access(candidate);
    host = candidate;
    break;
  } catch {}
}
if (!host)
  throw new Error(
    "codex-code-mode-host가 필요합니다. MARGIN_CODE_MODE_HOST로 경로를 지정하세요.",
  );

await mkdir(binaries, { recursive: true });
for (const [from, name] of [
  [real, "codex"],
  [host, "codex-code-mode-host"],
] as const) {
  const target = new URL(name, binaries).pathname;
  await copyFile(from, target);
  await chmod(target, 0o755);
  // An executable copied out of a signed .app still refers to its old Info.plist.
  // Give each standalone runtime its own signature before packaging it.
  if (process.platform === "darwin")
    execFileSync("codesign", ["--force", "--sign", "-", target], {
      stdio: "inherit",
    });
}
console.log("Codex runtime bundled.");
