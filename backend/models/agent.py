from enum import Enum

from pydantic import BaseModel, Field


class MarketDirection(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


class OptionType(str, Enum):
    CALL = "call"
    PUT = "put"


class OpportunityStatus(str, Enum):
    DETECTED = "detected"
    REJECTED = "rejected"
    APPROVED = "approved"


class MarketOpportunity(BaseModel):
    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Underlying stock ticker symbol",
    )

    direction: MarketDirection

    confidence: float = Field(
        ...,
        ge=0,
        le=100,
        description="Agent confidence score",
    )

    current_price: float = Field(
        ...,
        gt=0,
        description="Current underlying market price",
    )

    reasoning: list[str]

    status: OpportunityStatus = (
        OpportunityStatus.DETECTED
    )

    rvol: float | None = Field(
        default=None,
        description="Relative volume vs 20-period baseline",
    )

    asset_class: str | None = Field(
        default="us_equity",
        description="Asset class: 'us_equity' or 'crypto'",
    )

    atr: float | None = Field(
        default=None,
        description="14-period Average True Range for dynamic volatility buffers",
    )

    suggested_sl_price: float | None = Field(
        default=None,
        description="Technically calculated smart Stop-Loss price",
    )

    suggested_tp_price: float | None = Field(
        default=None,
        description="Technically calculated smart Take-Profit price",
    )

    suggested_sl_pct: float | None = Field(
        default=None,
        description="Stop-Loss percentage distance from entry",
    )

    suggested_tp_pct: float | None = Field(
        default=None,
        description="Take-Profit percentage yield from entry",
    )

    risk_reward_ratio: float | None = Field(
        default=None,
        description="Asymmetric Risk-to-Reward ratio (e.g. 1:2.4)",
    )

    roc_30d: float | None = Field(
        default=None,
        description="30-day percentage rate of change (Macro velocity)",
    )

    sma50: float | None = Field(
        default=None,
        description="50-day Simple Moving Average",
    )

    pct_from_sma20: float | None = Field(
        default=None,
        description="Percentage distance from 20-day SMA",
    )

    pct_from_sma50: float | None = Field(
        default=None,
        description="Percentage distance from 50-day SMA",
    )

    z_score_20d: float | None = Field(
        default=None,
        description="Standard deviations from 20-day SMA mean",
    )

    adx: float | None = Field(
        default=None,
        description="14-period Average Directional Index (Trend strength)",
    )

    market_regime: str | None = Field(
        default="TREND_CONTINUATION",
        description="Classified regime: PULLBACK_ENTRY, SQUEEZE_BREAKOUT, OVEREXTENDED_MOMENTUM, RANGING_CHOP, etc.",
    )

    is_overextended: bool | None = Field(
        default=False,
        description="Flag indicating statistical or parabolic overextension",
    )

    volume_trend: str | None = Field(
        default="NORMAL",
        description="Volume status: ACCUMULATION, EXHAUSTION, EXPANSION, or NORMAL",
    )

    pullback_support_price: float | None = Field(
        default=None,
        description="Estimated high-probability mean-reversion retest support price",
    )

    expected_value: float | None = Field(
        default=None,
        description="Actuarial probabilistic Expected Value in dollars",
    )


class OptionContractProposal(BaseModel):
    symbol: str = Field(
        ...,
        min_length=1,
        description="Underlying stock ticker",
    )

    option_symbol: str = Field(
        ...,
        min_length=1,
        description="Alpaca option contract symbol",
    )

    option_type: OptionType

    strike_price: float = Field(
        ...,
        gt=0,
    )

    expiration_date: str

    quantity: int = Field(
        ...,
        gt=0,
    )

    estimated_premium: float = Field(
        ...,
        gt=0,
        description="Estimated premium per contract",
    )

    strategy: str

    reasoning: list[str]


class AgentTradeProposal(BaseModel):
    opportunity: MarketOpportunity

    option_contract: OptionContractProposal

    agent_confidence: float = Field(
        ...,
        ge=0,
        le=100,
    )


class DevilAdvocateReview(BaseModel):
    approved: bool

    risk_score: float = Field(
        ...,
        ge=0,
        le=100,
        description="Higher score means greater risk",
    )

    concerns: list[str]

    recommendation: str

    adversarial_verdict: str | None = Field(
        default=None,
        description="Executive adversarial verdict: APPROVED_FAVORABLE_STRUCTURE, CAUTION_OVEREXTENDED, HIGH_RISK_CHASE, etc.",
    )