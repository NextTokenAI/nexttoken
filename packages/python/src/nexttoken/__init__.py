"""NextToken SDK - Simple client for the NextToken Gateway."""

from importlib.metadata import PackageNotFoundError, version as _pkg_version

from .agents import Agent, Agents, Run, RunResult
from .client import NextToken
from .email import Email
from .fetch import Fetch
from .integrations import Integrations
from .search import Search
from .workspaces import Workspace, Workspaces

try:
    __version__ = _pkg_version("nexttoken")
except PackageNotFoundError:
    __version__ = "0.0.0+local"
__all__ = [
    "NextToken",
    "Agent",
    "Agents",
    "Email",
    "Fetch",
    "Integrations",
    "Run",
    "RunResult",
    "Search",
    "Workspace",
    "Workspaces",
    "__version__",
]
