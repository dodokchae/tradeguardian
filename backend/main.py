from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.account import router as account_router
from routes.portfolio import router as portfolio_router
from routes.analyze import router as analyze_router
from routes.market import router as market_router
from routes.history import router as history_router
from routes.assets import router as assets_router
from routes.live import router as live_router
from routes.agents import router as agents_router
from routes.mcp import router as mcp_router
from routes.trade import router as trade_router
from routes.positions import router as positions_router
from routes.tradeguardian import router as tradeguardian_router
from routes.settings import router as settings_router




from core.database import initialize_database


initialize_database()


app = FastAPI(
    title="TradeGuardian API",
    description="AI-powered trade verification, Alpaca MCP execution, and risk control system",
    version="0.2.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(account_router)
app.include_router(portfolio_router)
app.include_router(analyze_router)
app.include_router(market_router)
app.include_router(history_router)
app.include_router(assets_router)
app.include_router(live_router)
app.include_router(agents_router)
app.include_router(mcp_router)
app.include_router(trade_router)
app.include_router(positions_router)
app.include_router(tradeguardian_router)
app.include_router(settings_router)


@app.get("/")
def root():
    return {
        "message": "TradeGuardian API is running"
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy"
    }