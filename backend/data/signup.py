import logging
import os
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr

load_dotenv()

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Authentication"])

# Sheet Webhook URL (Yahan apna URL dalein)
GOOGLE_SHEET_WEBHOOK_URL = os.getenv("SHEETS_SCRIPT_API")

def _call_sheet(payload: dict) -> dict:
    
    if not GOOGLE_SHEET_WEBHOOK_URL:
        # Log server-side for the developer; say nothing specific to the client.
        logger.error("SHEETS_SCRIPT_API is not set — check the .env file.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The server is not configured yet. Please try again later.",
        )

    try:
        response = requests.post(GOOGLE_SHEET_WEBHOOK_URL, json=payload, timeout=10)
    except requests.exceptions.RequestException as exc:
        logger.error("Sheet webhook request failed: %s", exc.__class__.__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach the account service. Please try again.",
        )

    try:
        result = response.json()
    except ValueError:
        # Apps Script returns an HTML error page when the script itself throws.
        logger.error("Sheet webhook returned non-JSON (HTTP %s).", response.status_code)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The account service returned an unexpected response.",
        )

    if not isinstance(result, dict):
        logger.error("Sheet webhook returned %s, expected an object.", type(result).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The account service returned an unexpected response.",
        )

    return result


class UserSignupSchema(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Optional[str] = "Student"
    grade: Optional[str] = "10th"


@router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup_user(user: UserSignupSchema):
    payload = {
        "action": "signup",
        "name": user.name,
        "email": user.email,
        "password": user.password,
        "role": user.role,
        "grade": user.grade,
    }

    result = _call_sheet(payload)

    if result.get("status") == "success":
        return {
            "success": True,
            "message": result.get("message"),
            "user": {
                "name": user.name,
                "email": user.email,
                "role": user.role,
            },
        }

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=result.get("message", "Signup failed"),
    )