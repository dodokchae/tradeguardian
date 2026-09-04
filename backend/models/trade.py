from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class TradeSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class TradeProposal(BaseModel):
    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Stock ticker symbol",
    )

    side: TradeSide

    quantity: float = Field(
        ...,
        gt=0,
        description="Number of shares to trade",
    )

    entry_price: float | None = Field(
        default=None,
        gt=0,
    )

    stop_loss: float | None = Field(
        default=None,
        gt=0,
    )

    take_profit: float | None = Field(
        default=None,
        gt=0,
    )

    order_type: str | None = Field(
        default=None,
        description="Optional order type (e.g. Market, Limit)",
    )

    @field_validator("side", mode="before")
    @classmethod
    def normalize_side(cls, value: Any) -> Any:
        if isinstance(value, str):
            v = value.strip().lower()
            if "buy" in v or "long" in v:
                return "buy"
            elif "sell" in v or "short" in v:
                return "sell"
            return v
        return value