from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.mcp_service import list_mcp_tools, call_mcp_tool, get_mcp_call_history
from services.cli_service import is_cli_available, run_alpaca_cli

router = APIRouter(
    prefix="/mcp",
    tags=["Alpaca MCP & CLI"],
)


@router.get("/logs")
def get_mcp_logs():
    """Stream recent live FastMCP tool invocation logs."""
    return {
        "logs": get_mcp_call_history(),
    }


class CallMcpToolRequest(BaseModel):
    tool_name: str = Field(..., description="Name of the Alpaca MCP tool to call")
    arguments: dict[str, Any] = Field(default_factory=dict, description="Arguments for the tool")


class RunCliRequest(BaseModel):
    args: list[str] = Field(..., description="Command arguments for Alpaca CLI")


@router.get("/status")
async def get_mcp_status():
    """
    Check the connection and readiness of the Alpaca MCP Server and CLI integration.
    """
    try:
        tools = await list_mcp_tools()
        return {
            "status": "connected",
            "server": "Alpaca MCP Server (FastMCP)",
            "version": "2.3.1",
            "environment": "paper",
            "total_tools": len(tools),
            "cli_available": is_cli_available(),
            "tools_sample": [
                {"name": t["name"], "description": t["description"][:100] + "..."}
                for t in tools[:8]
            ],
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Alpaca MCP Server: {str(e)}",
        )


@router.get("/tools")
async def get_all_mcp_tools():
    """
    List all available tools provided dynamically by the Alpaca MCP Server.
    """
    try:
        tools = await list_mcp_tools()
        return {
            "total": len(tools),
            "tools": tools,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list MCP tools: {str(e)}",
        )


@router.post("/call")
async def execute_mcp_tool(payload: CallMcpToolRequest):
    """
    Execute an arbitrary Alpaca MCP tool directly on behalf of an agent.
    """
    try:
        result = await call_mcp_tool(payload.tool_name, payload.arguments)
        return {
            "success": True,
            "tool_name": payload.tool_name,
            "result": result,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error executing MCP tool '{payload.tool_name}': {str(e)}",
        )


@router.post("/cli")
def execute_alpaca_cli(payload: RunCliRequest):
    """
    Execute a command via the official Alpaca CLI.
    """
    result = run_alpaca_cli(payload.args)
    return result
