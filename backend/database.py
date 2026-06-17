from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "sqlite:///./tunisia_invest.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_light_migrations():
    """
    Idempotent ad-hoc migration for SQLite. There's no Alembic in this project,
    and `Base.metadata.create_all` only creates missing tables — it never adds
    columns to an existing table. Add any new `contract_clauses` columns here
    so existing databases pick them up on next startup.
    """
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(contract_clauses)")}
        if "clause_type" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE contract_clauses ADD COLUMN clause_type TEXT NOT NULL DEFAULT 'obligation'"
            )
        if "trigger_condition" not in cols:
            conn.exec_driver_sql("ALTER TABLE contract_clauses ADD COLUMN trigger_condition TEXT")
        if "right_holder" not in cols:
            conn.exec_driver_sql("ALTER TABLE contract_clauses ADD COLUMN right_holder TEXT")
        if "numbers_json" not in cols:
            conn.exec_driver_sql("ALTER TABLE contract_clauses ADD COLUMN numbers_json TEXT")

        digest_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(weekly_digests)")}
        if "email_sent" not in digest_cols:
            conn.exec_driver_sql("ALTER TABLE weekly_digests ADD COLUMN email_sent BOOLEAN NOT NULL DEFAULT 0")
        if "email_sent_count" not in digest_cols:
            conn.exec_driver_sql("ALTER TABLE weekly_digests ADD COLUMN email_sent_count INTEGER NOT NULL DEFAULT 0")
        if "last_email_sent_at" not in digest_cols:
            conn.exec_driver_sql("ALTER TABLE weekly_digests ADD COLUMN last_email_sent_at DATETIME")
        if "last_sent_body" not in digest_cols:
            conn.exec_driver_sql("ALTER TABLE weekly_digests ADD COLUMN last_sent_body TEXT")
        if "investment_alerts_json" not in digest_cols:
            conn.exec_driver_sql("ALTER TABLE weekly_digests ADD COLUMN investment_alerts_json TEXT NOT NULL DEFAULT '[]'")

        conn.commit()
