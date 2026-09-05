import sqlite3

from core.config import DATABASE_PATH


def get_connection() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)

    connection.row_factory = sqlite3.Row

    return connection


def initialize_database() -> None:
    connection = get_connection()

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS analysis_history (
            audit_id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            data TEXT NOT NULL
        )
        """
    )

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS trade_orders (
            order_id TEXT PRIMARY KEY,
            account_id TEXT,
            client_order_id TEXT,
            symbol TEXT NOT NULL,
            option_symbol TEXT,
            side TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            order_type TEXT NOT NULL,
            limit_price REAL,
            status TEXT NOT NULL,
            filled_avg_price REAL,
            filled_qty INTEGER,
            submitted_at TEXT NOT NULL,
            raw_response TEXT
        )
        """
    )

    # Safe migration for existing SQLite databases
    try:
        connection.execute("ALTER TABLE trade_orders ADD COLUMN account_id TEXT")
    except Exception:
        pass

    try:
        connection.execute(
            """
            UPDATE trade_orders
            SET option_symbol = NULL
            WHERE option_symbol IS NOT NULL
              AND (
                symbol LIKE '%/%'
                OR symbol = option_symbol
                OR NOT (length(option_symbol) > 6 AND option_symbol GLOB '*[0-9]*')
              )
            """
        )
    except Exception:
        pass

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT NOT NULL
        )
        """
    )

    connection.commit()
    connection.close()