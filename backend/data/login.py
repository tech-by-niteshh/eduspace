import logging
import os

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr

load_dotenv()

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Authentication"])

GOOGLE_SHEET_WEBHOOK_URL = os.getenv("SHEETS_SCRIPT_API")

def _call_sheet(payload: dict) -> dict:
    """POST to the Google Sheet webhook and return its JSON object.

    Raises HTTPException with a message that is safe to show in the browser.
    The raw exception text is deliberately NOT forwarded: requests embeds the
    full request URL in its errors, which would publish the private
    SHEETS_SCRIPT_API webhook to anyone who triggers a network failure.
    """
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


class UserLoginSchema(BaseModel):
    email: EmailStr
    password: str


@router.post("/login", status_code=status.HTTP_200_OK)
def login_user(user: UserLoginSchema):
    payload = {
        "action": "login",
        "email": user.email,
        "password": user.password,
    }

    result = _call_sheet(payload)

    if result.get("status") == "success":
        return {
            "success": True,
            "message": "Login successful! Redirecting...",
            "user": result.get("user"),
        }

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=result.get("message", "Invalid credentials"),
    )