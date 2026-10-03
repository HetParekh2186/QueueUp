import asyncio
import logging
import time
from contextlib import asynccontextmanager

import sqlalchemy as sa
from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException

from app.config import settings
from app.db import engine, get_session
from app.errors import DomainError
from app.logconfig import configure_logging
from app.realtime import listen_forever, publisher
from app.routers import admin, auth, checkins, events, me, orders, stats, ws

log = logging.getLogger("queueup.http")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings.check_production_secrets()
    subscriber = asyncio.create_task(listen_forever(settings.redis_url))
    yield
    subscriber.cancel()
    await publisher.close()
    await engine.dispose()


app = FastAPI(
    title="QueueUp API",
    version="1.0.0",
    description="Event ticketing & check-in that never sells the same seat twice.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_log(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    log.info(
        "request",
        extra={
            "ctx": {
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "ms": round((time.perf_counter() - start) * 1000, 1),
            }
        },
    )
    return response


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=jsonable_encoder({"error": exc.error, **exc.extra}))


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    body = exc.detail if isinstance(exc.detail, dict) else {"error": exc.detail}
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422, content=jsonable_encoder({"error": "validation_error", "details": exc.errors()})
    )


@app.get("/health", tags=["ops"])
async def health(session: AsyncSession = Depends(get_session)) -> JSONResponse:
    checks = {}
    try:
        await session.execute(sa.text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "down"
    try:
        await publisher.redis.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "down"  # degraded, not dead: real-time and rate limits only
    healthy = checks["database"] == "ok"
    return JSONResponse(status_code=200 if healthy else 503, content={"status": "ok" if healthy else "down", **checks})


for module in (auth, events, orders, me, checkins, ws, admin, stats):
    app.include_router(module.router)
