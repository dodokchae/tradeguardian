import json
import logging
import os
import shutil
import subprocess
from typing import Any

from core.config import ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_BASE_URL

logger = logging.getLogger("TradeGuardian.CLI")


def get_alpaca_cli_path() -> str | None:
    """Find the path to the official alpaca CLI executable if installed."""
    return shutil.which("alpaca")


def is_cli_available() -> bool:
    """Check whether the Alpaca CLI binary is installed and executable."""
    return get_alpaca_cli_path() is not None


def run_alpaca_cli(args: list[str]) -> dict[str, Any]:
    """
    Run an Alpaca CLI command with credentials supplied via environment.
    Falls back gracefully with an informative message if CLI is not installed.
    """
    cli_path = get_alpaca_cli_path()
    if not cli_path:
        return {
            "success": False,
            "error": "Alpaca CLI ('alpaca') is not installed in the system PATH.",
            "installation": (
                "Install via Go: `go install github.com/alpacahq/cli/cmd/alpaca@latest` "
                "or Homebrew: `brew install alpacahq/tap/cli`"
            ),
        }

    env = os.environ.copy()
    env["APCA_API_KEY_ID"] = ALPACA_API_KEY
    env["APCA_API_SECRET_KEY"] = ALPACA_SECRET_KEY
    env["APCA_API_BASE_URL"] = ALPACA_BASE_URL

    cmd = [cli_path] + args
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
        )

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        # Attempt to parse JSON if output appears to be JSON
        data = None
        if stdout.startswith("{") or stdout.startswith("["):
            try:
                data = json.loads(stdout)
            except Exception:
                data = stdout
        else:
            data = stdout

        return {
            "success": result.returncode == 0,
            "exit_code": result.returncode,
            "data": data,
            "error": stderr if result.returncode != 0 else None,
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to execute Alpaca CLI: {str(e)}",
        }
