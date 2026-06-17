import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Investor

SECRET_KEY = "tunisinvest-secret-key-change-in-production-2024"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# ── Password hashing (stdlib — no passlib/bcrypt dependency) ─────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 260_000
    ).hex()
    return f"pbkdf2${salt}${key}"


def verify_password(plain: str, stored: str) -> bool:
    try:
        _, salt, key = stored.split("$")
        new_key = hashlib.pbkdf2_hmac(
            "sha256", plain.encode("utf-8"), salt.encode("utf-8"), 260_000
        ).hex()
        return secrets.compare_digest(new_key, key)
    except Exception:
        return False


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_access_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_investor(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Optional[Investor]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            return None
        investor_id = int(sub)
    except (JWTError, ValueError, TypeError):
        return None
    return db.query(Investor).filter(Investor.id == investor_id).first()


def require_investor(
    investor: Optional[Investor] = Depends(get_current_investor),
) -> Investor:
    if not investor:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return investor


# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    investor: dict


class InvestorOut(BaseModel):
    id: int
    email: str
    full_name: Optional[str]

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(Investor).filter(Investor.email == req.email.lower()).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    investor = Investor(
        email=req.email.lower(),
        hashed_password=hash_password(req.password),
        full_name=req.full_name,
    )
    db.add(investor)
    db.commit()
    db.refresh(investor)

    token = create_access_token({"sub": str(investor.id)})
    return TokenResponse(
        access_token=token,
        investor={"id": investor.id, "email": investor.email, "full_name": investor.full_name},
    )


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    investor = db.query(Investor).filter(Investor.email == form.username.lower()).first()
    if not investor or not verify_password(form.password, investor.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token({"sub": str(investor.id)})
    return TokenResponse(
        access_token=token,
        investor={"id": investor.id, "email": investor.email, "full_name": investor.full_name},
    )


@router.get("/me", response_model=InvestorOut)
def me(investor: Investor = Depends(require_investor)):
    return investor
