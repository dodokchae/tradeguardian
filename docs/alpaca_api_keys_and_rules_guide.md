# Alpaca API Keys, Account Switching, and Platform Rules Guide

This document provides a comprehensive technical and regulatory review regarding Alpaca API keys, switching paper trading accounts, and compliance with Alpaca’s terms of service and market regulations.

---

## 1. Executive Summary & Direct Answers

### Q1: If you change `ALPACA_API_KEY` and `ALPACA_SECRET_KEY`, does it actually change into another paper trading account if valid?
> **Answer: YES, 100% immediately.**  
> Alpaca’s REST and WebSocket APIs use stateless HTTP headers (`APCA-API-KEY-ID` and `APCA-API-SECRET-KEY`). Every request made to Alpaca’s endpoints (`/v2/account`, `/v2/positions`, `/v2/orders`, etc.) is cryptographically authenticated and resolved directly to the specific account belonging to that key pair.  
> As soon as TradeGuardian connects with new valid keys, the entire system (account equity, cash, buying power, open positions, order history, and MCP tools) immediately reflects that target paper account.

### Q2: Does changing keys or using multiple paper trading accounts break any Alpaca rule or terms of service?
> **Answer: NO.**  
> Alpaca officially supports, provides, and encourages multiple paper trading accounts for developers and algorithmic trading teams. There is **no prohibition** against creating multiple paper accounts, resetting them, or switching API keys between different test environments.

---

## 2. Technical Mechanics: How Key Switching Works in TradeGuardian

### A. Authentication Architecture
In TradeGuardian’s backend (`backend/services/alpaca_service.py`):
```python
from alpaca.trading.client import TradingClient
from core.config import ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_PAPER

trading_client = TradingClient(
    api_key=ALPACA_API_KEY,
    secret_key=ALPACA_SECRET_KEY,
    paper=True,  # Routes to https://paper-api.alpaca.markets
)
```
When `trading_client.get_account()` or `trading_client.get_all_positions()` executes:
1. The client attaches:
   - `APCA-API-KEY-ID: <ALPACA_API_KEY>`
   - `APCA-API-SECRET-KEY: <ALPACA_SECRET_KEY>`
2. Alpaca validates the HMAC credentials against their account directory.
3. Alpaca returns the exact portfolio state corresponding to the account tied to that key pair.

### B. What You Need to Do When Changing Keys
Because Python loads environment variables into memory at process startup:
1. Update `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` in `backend/.env`.
2. **Restart the FastAPI backend** (`uvicorn main:app`) so the new keys are read into `core.config`.
3. Open the TradeGuardian **Settings** page in the browser and click **"Test Connection"**. It will immediately ping the new account and display its live status, currency, and buying power.

---

## 3. Regulatory & Platform Rules: What is Allowed vs. Prohibited

| Category | Allowed / Standard Practice | Prohibited / Rule Violation |
| :--- | :--- | :--- |
| **Paper Accounts** | Creating multiple paper accounts; generating and resetting paper keys; running simultaneous bot simulations across accounts. | None. Paper trading is an isolated sandbox with simulated liquidity. |
| **Endpoint Matching** | Using Paper keys (`PK...`) with `paper-api.alpaca.markets`; using Live keys (`AK...`) with `api.alpaca.markets`. | Calling Live endpoints with Paper keys (returns `401 Unauthorized` / `403 Forbidden`). |
| **Rate Limits** | Up to **200 requests per minute** per account (burst limit of **10 requests/second**). | Exceeding 200 req/min triggers `HTTP 429 Too Many Requests`. Excessive flooding can lead to temporary IP throttle. |
| **Market Data Usage** | Consuming IEX (free) or SIP market data for algorithmic trade decisions and personal dashboard display. | Publicly republishing, reselling, or broadcasting raw exchange data feeds to third parties (violates exchange licenses). |
| **Credential Security** | Keeping Secret Keys strictly in server-side `.env` files or backend secret vaults. | Hardcoding secret keys in public client-side code, Git commits, or public repositories. |
| **Live Account Multiplicity** | One primary individual taxable brokerage account per legal person (plus IRAs or legal business accounts). | Creating duplicate live brokerage accounts under the same individual SSN/identity without authorized institutional registration. |

---

## 4. Key Alpaca Trading Rules to Keep in Mind

### 1. Pattern Day Trader (PDT) Rule (FINRA Rule 4210)
- **Live Trading**: Executing 4 or more day trades within 5 business days in a margin account with under $25,000 equity marks the account as a Pattern Day Trader and restricts day trading for 90 days.
- **Paper Trading**: Alpaca’s paper simulator enforces PDT logic only if the simulated balance falls below $25,000. Because paper accounts start with $100,000, you have full flexibility to day trade unless equity drops below $25k.

### 2. Paper Account Resets
- In the Alpaca Web Dashboard, you can:
  - Generate new API keys for an existing paper account.
  - Reset the paper account balance back to the default $100,000.
  - Create separate paper trading sub-accounts for testing different autonomous swarms.
- **Note**: When you regenerate keys on the dashboard, the old keys are immediately invalidated by Alpaca.

---

## 5. Security & Verification Checklist

- [x] **Key Format**: Paper keys typically start with `PK...` and secrets are 40 hexadecimal characters.
- [x] **Base URL**: Paper trading must always connect to `https://paper-api.alpaca.markets`.
- [x] **Enforced Safety**: TradeGuardian has permanently disabled live account toggles in the UI to guarantee no live capital can ever be placed at risk during autonomous agent runs.
- [x] **Connection Verification**: Use the Settings tab's **Test Connection** button to confirm latency and connectivity whenever credentials change.
