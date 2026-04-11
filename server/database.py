"""SQLite database setup with async SQLAlchemy."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from server.config import DATABASE_URL

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def _migrate_shared_solutions(conn) -> None:
    """Idempotent migration: upgrade shared_solutions from old schema.

    Old schema had UniqueConstraint(user_id, exercise_id) and no comment_count column,
    which prevented users from submitting multiple solutions (LeetCode-style history).
    """
    result = await conn.exec_driver_sql("PRAGMA table_info(shared_solutions)")
    cols = [row[1] for row in result.fetchall()]
    if not cols:
        return  # Table doesn't exist yet; create_all will handle it

    needs_rebuild = "comment_count" not in cols
    if not needs_rebuild:
        # Also check whether there's still a leftover unique index on (user_id, exercise_id)
        idx_res = await conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='shared_solutions' AND sql LIKE '%UNIQUE%'"
        )
        if idx_res.fetchall():
            needs_rebuild = True

    if not needs_rebuild:
        return

    await conn.exec_driver_sql("""
        CREATE TABLE shared_solutions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            exercise_id INTEGER NOT NULL REFERENCES exercises(id),
            code TEXT NOT NULL,
            explanation TEXT,
            upvotes INTEGER DEFAULT 0,
            comment_count INTEGER DEFAULT 0,
            created_at DATETIME
        )
    """)
    await conn.exec_driver_sql("""
        INSERT INTO shared_solutions_new (id, user_id, exercise_id, code, explanation, upvotes, comment_count, created_at)
        SELECT id, user_id, exercise_id, code, explanation, upvotes, 0, created_at FROM shared_solutions
    """)
    await conn.exec_driver_sql("DROP TABLE shared_solutions")
    await conn.exec_driver_sql("ALTER TABLE shared_solutions_new RENAME TO shared_solutions")
    await conn.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_shared_solutions_exercise ON shared_solutions (exercise_id)"
    )


async def init_db():
    """Create all tables."""
    async with engine.begin() as conn:
        from server.models import Base  # noqa: F811
        # Run migrations BEFORE create_all so new tables (like solution_comments) can be added cleanly
        await _migrate_shared_solutions(conn)
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session
