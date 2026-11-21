#!/usr/bin/env python3
"""LastMagazine desktop launcher.

Boots the Vite dev server (`npm run dev`), waits until it answers on
http://localhost:5173, then opens the game in a native desktop window
(pywebview, 1280x720). Closing the window — or pressing Ctrl+C — shuts the
Node server down so nothing is left running in the background.

Usage:
  python launcher.py              # dev server + desktop window (default)
  python launcher.py --browser    # dev server + system browser instead of webview
  python launcher.py --check      # verify the toolchain and server boot/shutdown, no GUI
"""

from __future__ import annotations

import argparse
import atexit
import os
import platform
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

HOST = "localhost"
PORT = 5173
URL = f"http://{HOST}:{PORT}/"
WINDOW_W = 1280
WINDOW_H = 720
WAIT_SECONDS = 60  # first boot can be slow (cold vite dependency scan)
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
IS_WINDOWS = platform.system() == "Windows"


class LauncherError(Exception):
    """A fatal, user-facing problem with a helpful message."""


def info(msg: str) -> None:
    print(f"[launcher] {msg}", flush=True)


# ----------------------------------------------------------------- toolchain
def find_npm() -> str:
    npm = shutil.which("npm") or (shutil.which("npm.cmd") if IS_WINDOWS else None)
    if not npm:
        raise LauncherError(
            "Node.js / npm was not found on PATH.\n"
            "  → Install Node.js 18 or newer from https://nodejs.org\n"
            "  → Close and reopen your terminal, then run this script again."
        )
    node = shutil.which("node") or (shutil.which("node.exe") if IS_WINDOWS else None)
    if not node:
        raise LauncherError(
            "npm was found but `node` was not on PATH.\n"
            "  → Reinstall Node.js from https://nodejs.org (repair install)."
        )
    return npm


def run_quiet(npm: str, args: list[str]) -> None:
    """Run an npm command, streaming output; abort with its tail on failure."""
    proc = subprocess.run(
        [npm, *args],
        cwd=PROJECT_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode != 0:
        tail = "\n".join((proc.stdout or "").strip().splitlines()[-15:])
        raise LauncherError(f"`npm {' '.join(args)}` failed (exit {proc.returncode}):\n{tail}")


def ensure_dependencies(npm: str) -> None:
    if os.path.isdir(os.path.join(PROJECT_ROOT, "node_modules")):
        return
    info("node_modules is missing — running `npm install` (one-time, may take a minute)...")
    run_quiet(npm, ["install"])


# ------------------------------------------------------------- server process
def spawn_server(npm: str) -> subprocess.Popen:
    kwargs: dict = dict(
        cwd=PROJECT_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if IS_WINDOWS:
        # keep the npm console window hidden; taskkill /T handles the tree
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    else:
        # own process group → we can kill npm *and* vite in one signal
        kwargs["preexec_fn"] = os.setsid  # type: ignore[arg-type]
    return subprocess.Popen([npm, "run", "dev"], **kwargs)


def dump_server_output(proc: subprocess.Popen) -> str:
    """Best-effort: grab whatever the server printed so far (non-blocking on POSIX)."""
    try:
        out = proc.communicate(timeout=3)[0] if proc.poll() is not None else ""
    except Exception:
        out = ""
    return (out or "").strip()


def stop_server(proc: subprocess.Popen | None) -> None:
    """Kill the npm process tree; escalate to SIGKILL/taskkill if needed."""
    if proc is None or proc.poll() is not None:
        return
    info("stopping the dev server...")
    try:
        if IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            try:
                proc.wait(timeout=8)
                return
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        proc.wait(timeout=8)
    except Exception as exc:  # never crash on shutdown
        info(f"warning: could not stop server cleanly ({exc}); it may need manual killing.")
    info("server stopped.")


def wait_for_server(proc: subprocess.Popen, timeout: int) -> None:
    """Poll the URL until Vite answers, watching for early server death."""
    info(f"waiting for the dev server on {URL} (up to {timeout}s)...")
    deadline = time.time() + timeout
    last_err: str = ""
    while time.time() < deadline:
        if proc.poll() is not None:
            tail = dump_server_output(proc)
            raise LauncherError(
                "the dev server exited before becoming reachable.\n"
                f"{tail}\n"
                f"  → Common cause: something else already uses port {PORT}. "
                "Close it (or change PORT in launcher.py) and retry."
            )
        try:
            with urllib.request.urlopen(URL, timeout=1.5) as resp:
                if resp.status == 200:
                    info("server is up.")
                    return
        except urllib.error.HTTPError as exc:
            last_err = f"HTTP {exc.code}"
        except Exception as exc:  # noqa: BLE001 — connection refused, etc.
            last_err = str(exc)
        time.sleep(0.4)
    tail = dump_server_output(proc)
    stop_server(proc)
    raise LauncherError(
        f"the dev server did not answer within {timeout}s (last error: {last_err or 'none'}).\n{tail}"
    )


# ------------------------------------------------------------------ frontends
def open_webview() -> None:
    try:
        import webview  # pywebview
    except ImportError:
        raise LauncherError(
            "pywebview is not installed for this Python interpreter.\n"
            "  → Run:  pip install pywebview\n"
            "  → (or launch with:  python launcher.py --browser  to skip the desktop window)"
        ) from None

    info(f"opening desktop window ({WINDOW_W}x{WINDOW_H})...")
    webview.create_window(
        "LastMagazine — Bodycam FPS",
        URL,
        width=WINDOW_W,
        height=WINDOW_H,
        min_size=(960, 540),
        background_color="#000000",
    )
    # blocks until the window is closed; server shutdown happens in main()'s finally
    webview.start()


def open_browser() -> None:
    info("opening the game in your default browser...")
    webbrowser.open(URL)
    info("close the tab, then press Ctrl+C here to stop the server.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass


# ----------------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LastMagazine desktop launcher")
    parser.add_argument("--browser", action="store_true", help="open in the default browser instead of a pywebview window")
    parser.add_argument("--check", action="store_true", help="verify the toolchain + server boot/shutdown, no GUI")
    args = parser.parse_args(argv)

    server: subprocess.Popen | None = None
    atexit.register(stop_server, server)  # last-resort safety net
    try:
        info(f"project: {PROJECT_ROOT}")
        npm = find_npm()
        info(f"using npm: {npm}")
        ensure_dependencies(npm)

        server = spawn_server(npm)
        atexit.unregister(stop_server)
        atexit.register(stop_server, server)
        wait_for_server(server, WAIT_SECONDS)

        if args.check:
            info("check passed: toolchain OK, server boot + HTTP 200 + shutdown OK.")
            return 0

        if args.browser:
            open_browser()
        else:
            open_webview()
        return 0
    except LauncherError as exc:
        print(f"\n[launcher] failed: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n[launcher] interrupted — shutting down.", file=sys.stderr)
        return 130
    finally:
        stop_server(server)


if __name__ == "__main__":
    sys.exit(main())
