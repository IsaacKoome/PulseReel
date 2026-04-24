import { existsSync } from "fs";
import path from "path";
import { readdirSync } from "fs";
import net from "net";

function detectPythonExecutable() {
  const configured = process.env.PULSEREEL_PYTHON_EXECUTABLE?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }

  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Python", "Python311", "python.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Python", "Python312", "python.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Python", "Python310", "python.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return configured || "";
}

export type BackendCapabilities = {
  heavyProvider: string;
  pythonExecutableConfigured: boolean;
  pythonBridgeReady: boolean;
  pythonExecutablePath?: string;
  customBackendCommandConfigured: boolean;
  remoteModelBackendConfigured: boolean;
  remoteModelBackendReachable: boolean;
  remoteModelBackendMode?: string;
  remoteModelBackendComfyUiConfigured: boolean;
  remoteModelBackendDurableStorageConfigured: boolean;
  comfyUiInstallDetected: boolean;
  comfyUiVenvReady: boolean;
  comfyUiConfigured: boolean;
  comfyUiWorkflowExists: boolean;
  comfyUiServerReachable: boolean;
  comfyUiCheckpointReady: boolean;
  comfyUiCheckpointDir?: string;
  comfyUiAvailableCheckpoints: string[];
  comfyUiCanAutoStart: boolean;
  realModelBackendReady: boolean;
  activeHeavyPath: "fast-local" | "python-bridge" | "custom-backend-command" | "remote-model-backend" | "comfyui-backend";
  summary: string;
};

function canConnectToPort(host: string, port: number) {
  try {
    const socket = new net.Socket();
    socket.setTimeout(300);
    socket.connect(port, host);
    return new Promise<boolean>((resolve) => {
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      const close = () => {
        socket.destroy();
        resolve(false);
      };
      socket.on("timeout", close);
      socket.on("error", close);
    });
  } catch {
    return Promise.resolve(false);
  }
}

async function fetchRemoteWorkerHealth(remoteModelBackendUrl: string) {
  try {
    const renderUrl = new URL(remoteModelBackendUrl);
    renderUrl.pathname = renderUrl.pathname.replace(/\/pulsereel\/render\/?$/, "/health");
    if (!renderUrl.pathname.endsWith("/health")) {
      renderUrl.pathname = "/health";
    }

    const response = await fetch(renderUrl.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      return {
        reachable: false,
        mode: undefined,
        comfyuiConfigured: false,
        durableStorageConfigured: false,
      };
    }

    const payload = (await response.json()) as {
      mode?: string;
      comfyuiConfigured?: boolean;
      durableStorageConfigured?: boolean;
    };

    return {
      reachable: true,
      mode: payload.mode,
      comfyuiConfigured: Boolean(payload.comfyuiConfigured),
      durableStorageConfigured: Boolean(payload.durableStorageConfigured),
    };
  } catch {
    return {
      reachable: false,
      mode: undefined,
      comfyuiConfigured: false,
      durableStorageConfigured: false,
    };
  }
}

export async function getBackendCapabilities(): Promise<BackendCapabilities> {
  const heavyProvider = process.env.PULSEREEL_HEAVY_PROVIDER?.trim() || "open-model-adapter";
  const pythonExecutable = detectPythonExecutable();
  const customBackendCommand = process.env.PULSEREEL_MODEL_BACKEND_COMMAND?.trim();
  const remoteModelBackendUrl = process.env.PULSEREEL_REMOTE_MODEL_BACKEND_URL?.trim();
  const comfyUiUrl = process.env.PULSEREEL_COMFYUI_URL?.trim();
  const comfyUiWorkflow = process.env.PULSEREEL_COMFYUI_WORKFLOW_TEMPLATE?.trim();
  const comfyUiRoot = path.join(process.cwd(), "tools", "ComfyUI");
  const comfyUiVenvPython = path.join(comfyUiRoot, ".venv", "Scripts", "python.exe");
  const checkpointDir = path.join(comfyUiRoot, "models", "checkpoints");

  const pythonExecutableConfigured = Boolean(pythonExecutable);
  const pythonBridgeReady = pythonExecutableConfigured;
  const customBackendCommandConfigured = Boolean(customBackendCommand);
  const remoteModelBackendConfigured = Boolean(remoteModelBackendUrl);
  const remoteModelBackendHealth = remoteModelBackendConfigured
    ? await fetchRemoteWorkerHealth(remoteModelBackendUrl!)
    : {
        reachable: false,
        mode: undefined,
        comfyuiConfigured: false,
        durableStorageConfigured: false,
      };
  const comfyUiInstallDetected = existsSync(path.join(comfyUiRoot, "main.py"));
  const comfyUiVenvReady = existsSync(comfyUiVenvPython);
  const comfyUiConfigured = Boolean(comfyUiUrl && comfyUiWorkflow);
  const comfyUiWorkflowExists = Boolean(comfyUiWorkflow && existsSync(comfyUiWorkflow));
  const comfyUiServerReachable = comfyUiUrl
    ? await (() => {
        try {
          const parsed = new URL(comfyUiUrl);
          return canConnectToPort(parsed.hostname, Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)));
        } catch {
          return Promise.resolve(false);
        }
      })()
    : false;
  const comfyUiCheckpointReady = existsSync(checkpointDir)
    ? readdirSync(checkpointDir).some(
        (entry) =>
          !entry.toLowerCase().includes("put_checkpoints_here") &&
          /\.(safetensors|ckpt|pt)$/i.test(entry),
      )
    : false;
  const comfyUiAvailableCheckpoints = existsSync(checkpointDir)
    ? readdirSync(checkpointDir).filter(
        (entry) =>
          !entry.toLowerCase().includes("put_checkpoints_here") &&
          /\.(safetensors|ckpt|pt)$/i.test(entry),
      )
    : [];
  const comfyUiCanAutoStart =
    comfyUiInstallDetected &&
    comfyUiVenvReady &&
    existsSync(path.join(process.cwd(), "scripts", "start-comfyui.ps1"));
  const realModelBackendReady =
    customBackendCommandConfigured ||
    (remoteModelBackendConfigured && remoteModelBackendHealth.reachable) ||
    (comfyUiConfigured && comfyUiWorkflowExists && comfyUiServerReachable && comfyUiCheckpointReady);

  const activeHeavyPath =
    customBackendCommandConfigured
      ? "custom-backend-command"
      : remoteModelBackendConfigured
        ? "remote-model-backend"
      : comfyUiConfigured && comfyUiWorkflowExists && comfyUiServerReachable && comfyUiCheckpointReady
        ? "comfyui-backend"
        : pythonBridgeReady
          ? "python-bridge"
          : "fast-local";

  const summary =
    activeHeavyPath === "comfyui-backend"
      ? "Real ComfyUI backend is configured for heavy generation."
      : activeHeavyPath === "custom-backend-command"
        ? "Custom model backend command is configured for heavy generation."
        : activeHeavyPath === "remote-model-backend"
          ? remoteModelBackendHealth.reachable
            ? remoteModelBackendHealth.durableStorageConfigured
              ? "Remote model backend is live and durable hosted output storage is configured for production heavy generation."
              : "Remote model backend is live for production heavy generation, but durable output storage is not configured yet."
            : "Remote model backend URL is configured, but the worker is not reachable right now."
          : activeHeavyPath === "python-bridge"
          ? comfyUiInstallDetected && comfyUiVenvReady && !comfyUiCheckpointReady
            ? "Python bridge is configured. ComfyUI is installed locally, but you still need a real checkpoint model before heavy generation can switch over."
            : "Python bridge is configured, but no real external model backend is fully wired yet."
          : "Heavy mode currently falls back to the built-in local runner.";

  return {
    heavyProvider,
    pythonExecutableConfigured,
    pythonBridgeReady,
    pythonExecutablePath: pythonExecutable || undefined,
    customBackendCommandConfigured,
    remoteModelBackendConfigured,
    remoteModelBackendReachable: remoteModelBackendHealth.reachable,
    remoteModelBackendMode: remoteModelBackendHealth.mode,
    remoteModelBackendComfyUiConfigured: remoteModelBackendHealth.comfyuiConfigured,
    remoteModelBackendDurableStorageConfigured: remoteModelBackendHealth.durableStorageConfigured,
    comfyUiInstallDetected,
    comfyUiVenvReady,
    comfyUiConfigured,
    comfyUiWorkflowExists,
    comfyUiServerReachable,
    comfyUiCheckpointReady,
    comfyUiCheckpointDir: checkpointDir,
    comfyUiAvailableCheckpoints,
    comfyUiCanAutoStart,
    realModelBackendReady,
    activeHeavyPath,
    summary,
  };
}
