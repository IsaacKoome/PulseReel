import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";

function comfyUiPaths() {
  const root = path.join(/*turbopackIgnore: true*/ process.cwd(), "tools", "ComfyUI");
  return {
    root,
    mainScript: path.join(root, "main.py"),
    venvPython: path.join(root, ".venv", "Scripts", "python.exe"),
    startScript: path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "start-comfyui.ps1"),
  };
}

export function canAutoStartComfyUi() {
  const paths = comfyUiPaths();
  return existsSync(paths.mainScript) && existsSync(paths.venvPython) && existsSync(paths.startScript);
}

export async function startComfyUiServer() {
  if (!canAutoStartComfyUi()) {
    throw new Error("Local ComfyUI install is incomplete. Expected app, venv, and start script.");
  }

  if (process.platform !== "win32") {
    throw new Error("Automatic ComfyUI startup is currently implemented for Windows only.");
  }

  const { startScript } = comfyUiPaths();
  const powershellPath = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      powershellPath,
      ["-ExecutionPolicy", "Bypass", "-File", startScript],
      {
        cwd: /*turbopackIgnore: true*/ process.cwd(),
        env: process.env,
        windowsHide: true,
        detached: true,
        stdio: "ignore",
      },
    );

    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
