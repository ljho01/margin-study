import { invoke, isTauri } from "@tauri-apps/api/core";
export type Workspace = { id: string; name: string; path: string };
export type WorkspaceEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};
export async function chooseWorkspace() {
  return invoke<string | null>("choose_workspace");
}
export async function trustWorkspace(path: string) {
  return invoke<Workspace>("trust_workspace", { path });
}
export async function listWorkspaces() {
  return isTauri() ? invoke<Workspace[]>("list_workspaces") : [];
}
export async function listDirectory(workspaceId: string, path = "") {
  return invoke<WorkspaceEntry[]>("list_workspace_directory", {
    workspaceId,
    path,
  });
}
export async function readWorkspacePDF(workspaceId: string, path: string) {
  const result = await invoke<ArrayBuffer | number[]>("read_workspace_pdf", {
    workspaceId,
    path,
  });
  return result instanceof ArrayBuffer ? result : new Uint8Array(result).buffer;
}
/** Renames within the same folder; returns the new relative path. */
export async function renameEntry(
  workspaceId: string,
  path: string,
  name: string,
) {
  return invoke<string>("rename_workspace_entry", { workspaceId, path, name });
}
/** Moves into another folder of the workspace; returns the new relative path. */
export async function moveEntry(
  workspaceId: string,
  path: string,
  directory: string,
) {
  return invoke<string>("move_workspace_entry", {
    workspaceId,
    path,
    directory,
  });
}
/** Moves to the macOS Trash, like Finder's Move to Trash. */
export async function trashEntry(workspaceId: string, path: string) {
  await invoke("trash_workspace_entry", { workspaceId, path });
}
/** Opens the enclosing folder in Finder with the item selected. */
export async function revealEntry(workspaceId: string, path: string) {
  await invoke("reveal_workspace_entry", { workspaceId, path });
}
