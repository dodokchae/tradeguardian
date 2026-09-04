from fastapi import APIRouter
from models.trade import TradeProposal
from models.decision import AnalysisResult
from agents.guardian_agent import evaluate_trade

router = APIRouter(
    prefix="/analyze",
    tags=["Analysis"],
)


@router.post("/", response_model=AnalysisResult)
def analyze_trade(proposal: TradeProposal) -> AnalysisResult:
    """
    Analyze a trade proposal against TradeGuardian policy rules
    via the autonomous Guardian Agent.
    """
    return evaluate_trade(proposal)