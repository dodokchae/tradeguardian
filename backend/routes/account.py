from fastapi import APIRouter, HTTPException, Response

from services.alpaca_service import get_account

router = APIRouter(
    prefix="/account",
    tags=["Account"],
)


@router.get("/")
def read_account(response: Response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    try:
        account = get_account()

        return {
            "id": str(account.id),
            "status": str(account.status),
            "cash": str(account.cash),
            "equity": str(account.equity),
            "last_equity": str(getattr(account, "last_equity", account.equity)),
            "buying_power": str(account.buying_power),
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve Alpaca account: {str(error)}",
        )