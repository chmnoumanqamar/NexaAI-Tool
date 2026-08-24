import os
import shutil
import base64
import json
import hashlib
import secrets
import time
import requests
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv
from agent import agent

load_dotenv()

# ---- Google Gemini (voice transcription, free tier) ----
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_TRANSCRIBE_MODEL = "gemini-3.6-flash"

# ---- Supabase Setup ----
raw_url = os.getenv("SUPABASE_URL", "").rstrip("/").replace("/rest/v1", "")
supabase_key = os.getenv("SUPABASE_KEY", "")
supabase: Client | None = None
if raw_url and supabase_key:
    try:
        supabase = create_client(raw_url, supabase_key)
    except Exception as e:
        print(f"Supabase init notice: {e}")

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secure_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ---- Simple account storage (sign up / login / sign out) ----
# Accounts are stored in a local JSON file next to this script — no extra
# database setup needed. Passwords are never stored in plain text.
USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users.json")
SESSIONS: dict[str, str] = {}  # token -> username (in-memory; resets if the server restarts)


def _load_users() -> dict:
    if not os.path.exists(USERS_FILE):
        return {}
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_users(users: dict) -> None:
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)


def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return secrets.compare_digest(_hash_password(password, salt), stored)


def _normalize_answer(answer: str) -> str:
    # Case/space-insensitive so "Lahore" and " lahore " both work when checking later
    return answer.strip().lower()


def _hash_answer(answer: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", _normalize_answer(answer).encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}${digest.hex()}"


def _verify_answer(answer: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return secrets.compare_digest(_hash_answer(answer, salt), stored)


def _public_user(user: dict) -> dict:
    return {"name": user["name"], "username": user["username"], "age": user["age"]}


# ---- FastAPI App ----
app = FastAPI(title="AI Collaborative Workspace API", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Models ----
class ChatRequest(BaseModel):
    workspace_id: str
    user_id: str
    user_name: str | None = "Member"
    message: str
    thread_id: str | None = None  # which member-thread / branch this message belongs to
    reply_to_id: str | None = None
    reply_to_user_name: str | None = None
    reply_to_content: str | None = None

class BranchRequest(BaseModel):
    workspace_id: str
    parent_thread_id: str
    parent_owner_id: str
    parent_owner_name: str
    branch_point_message_id: str | None = None
    branch_owner_id: str
    branch_owner_name: str

class NotificationReadRequest(BaseModel):
    id: str

class SignupRequest(BaseModel):
    name: str
    username: str
    password: str
    age: int
    security_question: str
    security_answer: str

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenRequest(BaseModel):
    token: str

class ForgotPasswordRequest(BaseModel):
    username: str
    security_answer: str
    new_password: str

# ---- Routes ----

@app.get("/")
def read_root():
    return {"status": "AI Workspace Server is running", "version": "2.0"}

# Create a new account
@app.post("/api/auth/signup")
def signup(request: SignupRequest):
    name = request.name.strip()
    username = request.username.strip().lower()
    password = request.password
    age = request.age
    security_question = request.security_question.strip()
    security_answer = request.security_answer.strip()

    if not name or not username or not password:
        raise HTTPException(status_code=400, detail="Name, username, and password are all required.")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    if age is None or age <= 0 or age > 120:
        raise HTTPException(status_code=400, detail="Please enter a valid age.")
    if not security_question or not security_answer:
        raise HTTPException(status_code=400, detail="Please choose a security question and give an answer.")

    users = _load_users()
    if username in users:
        raise HTTPException(status_code=409, detail="That username is already taken.")

    users[username] = {
        "name": name,
        "username": username,
        "password": _hash_password(password),
        "age": age,
        "security_question": security_question,
        "security_answer": _hash_answer(security_answer),
        "created_at": time.time(),
    }
    _save_users(users)

    token = secrets.token_hex(24)
    SESSIONS[token] = username
    return {"status": "success", "token": token, "user": _public_user(users[username])}

# Log in to an existing account
@app.post("/api/auth/login")
def login(request: LoginRequest):
    username = request.username.strip().lower()
    users = _load_users()
    user = users.get(username)
    if not user or not _verify_password(request.password, user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")

    token = secrets.token_hex(24)
    SESSIONS[token] = username
    return {"status": "success", "token": token, "user": _public_user(user)}

# Look up a user's security question (step 1 of "forgot password")
@app.get("/api/auth/security-question")
def get_security_question(username: str):
    username = username.strip().lower()
    users = _load_users()
    user = users.get(username)
    if not user or not user.get("security_question"):
        raise HTTPException(status_code=404, detail="No account with a security question found for that username.")
    return {"status": "success", "security_question": user["security_question"]}

# Reset password using the security answer (step 2 of "forgot password")
@app.post("/api/auth/forgot-password")
def forgot_password(request: ForgotPasswordRequest):
    username = request.username.strip().lower()
    new_password = request.new_password

    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")

    users = _load_users()
    user = users.get(username)
    if not user or not user.get("security_answer"):
        raise HTTPException(status_code=404, detail="No account with a security question found for that username.")

    if not _verify_answer(request.security_answer, user["security_answer"]):
        raise HTTPException(status_code=401, detail="That answer doesn't match. Please try again.")

    user["password"] = _hash_password(new_password)
    users[username] = user
    _save_users(users)

    # Log the account out everywhere so an old, possibly-compromised session can't be reused
    for token in [t for t, u in SESSIONS.items() if u == username]:
        SESSIONS.pop(token, None)

    return {"status": "success", "message": "Password updated. Please log in with your new password."}

# Restore a session (called on page load if a token is saved in the browser)
@app.post("/api/auth/me")
def auth_me(request: TokenRequest):
    username = SESSIONS.get(request.token)
    if not username:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    users = _load_users()
    user = users.get(username)
    if not user:
        raise HTTPException(status_code=401, detail="Account not found.")
    return {"status": "success", "user": _public_user(user)}

# Sign out
@app.post("/api/auth/logout")
def logout(request: TokenRequest):
    SESSIONS.pop(request.token, None)
    return {"status": "success"}

# Upload a file (image, PDF, excel, csv, etc.)
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        # Sanitize filename
        safe_filename = os.path.basename(file.filename)
        file_location = os.path.join(UPLOAD_DIR, safe_filename)
        with open(file_location, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {
            "status": "success",
            "filename": safe_filename,
            "download_url": f"http://localhost:8000/api/download/{safe_filename}",
            "message": f"File '{safe_filename}' uploaded successfully."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")

# Download a generated or uploaded file
@app.get("/api/download/{filename}")
async def download_file(filename: str):
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File '{safe_filename}' not found in storage.")
    
    # Map common MIME types
    ext = safe_filename.lower().split(".")[-1]
    mime_types = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "csv": "text/csv",
        "zip": "application/zip",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "txt": "text/plain"
    }
    media_type = mime_types.get(ext, "application/octet-stream")

    return FileResponse(
        path=file_path,
        filename=safe_filename,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'}
    )

# List files in workspace
@app.get("/api/files")
def list_files():
    try:
        files = os.listdir(UPLOAD_DIR)
        file_details = []
        for f in files:
            if f.startswith(".") or f.lower() == ".gitkeep":
                continue
            fp = os.path.join(UPLOAD_DIR, f)
            if os.path.isfile(fp):
                file_details.append({
                    "name": f,
                    "size": os.path.getsize(fp),
                    "download_url": f"http://localhost:8000/api/download/{f}"
                })
        return {"files": file_details}
    except Exception as e:
        return {"files": [], "error": str(e)}

# Transcribe voice input to text using Google Gemini (free tier)
@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY is not set in Server/.env. Add it and restart the server."
        )
    try:
        audio_bytes = await file.read()
        mime_type = file.content_type or "audio/webm"
        b64_audio = base64.b64encode(audio_bytes).decode("utf-8")
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_TRANSCRIBE_MODEL}:generateContent",
            headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY},
            json={
                "contents": [{
                    "parts": [
                        {"text": "Transcribe this audio exactly as spoken. Reply with only the transcribed text, no extra commentary."},
                        {"inline_data": {"mime_type": mime_type, "data": b64_audio}}
                    ]
                }]
            },
            timeout=60,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Gemini transcription error: {resp.text}")
        data = resp.json()
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError):
            text = ""
        return {"text": text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

# Get workspace message history
@app.get("/api/workspace/{workspace_id}/messages")
async def get_workspace_messages(workspace_id: str):
    if not supabase:
        return {"messages": []}
    try:
        response = (
            supabase.table("messages")
            .select("*")
            .eq("workspace_id", workspace_id)
            .order("created_at")
            .execute()
        )
        return {"messages": response.data}
    except Exception as e:
        return {"messages": [], "notice": str(e)}

# Get messages for one specific thread inside a workspace.
# A "thread" is either a member's own personal thread ("member-<user_id>")
# or a branch ("branch-<id>"). For a branch, we stitch together the parent
# thread's history up to the branch point + the branch's own new messages,
# so the branch reads like "continue where they left off" without ever
# touching the original thread's rows.
@app.get("/api/workspace/{workspace_id}/thread/{thread_id}/messages")
async def get_thread_messages(workspace_id: str, thread_id: str):
    if not supabase:
        return {"messages": [], "inherited_count": 0}
    try:
        own_res = (
            supabase.table("messages")
            .select("*")
            .eq("workspace_id", workspace_id)
            .eq("thread_id", thread_id)
            .order("created_at")
            .execute()
        )
        own_msgs = own_res.data or []

        inherited_msgs = []
        if thread_id.startswith("branch-"):
            branch_res = supabase.table("branches").select("*").eq("id", thread_id).execute()
            branch = (branch_res.data or [None])[0]
            if branch:
                parent_thread_id = branch["parent_thread_id"]
                branch_point = branch.get("branch_point_message_id")
                parent_query = supabase.table("messages").select("*").eq("workspace_id", workspace_id)
                if parent_thread_id:
                    parent_query = parent_query.eq("thread_id", parent_thread_id)
                parent_res = parent_query.order("created_at").execute()
                parent_all = parent_res.data or []
                if branch_point:
                    idx = next((i for i, m in enumerate(parent_all) if m.get("id") == branch_point), None)
                    inherited_msgs = parent_all[: idx + 1] if idx is not None else parent_all
                else:
                    inherited_msgs = parent_all

        return {"messages": inherited_msgs + own_msgs, "inherited_count": len(inherited_msgs)}
    except Exception as e:
        return {"messages": [], "inherited_count": 0, "notice": str(e)}

# List each member's personal thread + all branches inside a project workspace,
# so the sidebar can show "Fahad's chat", "Nouman's chat", etc.
@app.get("/api/workspace/{workspace_id}/threads")
def list_threads(workspace_id: str):
    if not supabase:
        return {"threads": [], "branches": []}
    try:
        res = (
            supabase.table("messages")
            .select("thread_id,user_id,user_name,content,role,created_at")
            .eq("workspace_id", workspace_id)
            .order("created_at")
            .execute()
        )
        rows = res.data or []
        member_threads: dict[str, dict] = {}
        for r in rows:
            tid = r.get("thread_id") or f"member-{r['user_id']}"
            if tid.startswith("branch-") or r.get("role") == "ai":
                continue
            member_threads[tid] = {
                "thread_id": tid,
                "owner_id": r["user_id"],
                "owner_name": r["user_name"],
                "last_message": r["content"],
                "last_at": r["created_at"],
            }
        branches_res = supabase.table("branches").select("*").eq("workspace_id", workspace_id).execute()
        branches_data = []
        for b in (branches_res.data or []):
            branches_data.append({
                **b,
                "branch_id": b.get("id"),
                "id": b.get("id"),
            })
        return {"threads": list(member_threads.values()), "branches": branches_data}
    except Exception as e:
        return {"threads": [], "branches": [], "notice": str(e)}

# Create a branch: fork someone else's thread into your own separate
# conversation from this point onward, and notify them that you did.
@app.post("/api/workspace/branch")
def create_branch(request: BranchRequest):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected.")
    branch_id = f"branch-{secrets.token_hex(6)}"
    try:
        supabase.table("branches").insert({
            "id": branch_id,
            "workspace_id": request.workspace_id,
            "parent_thread_id": request.parent_thread_id,
            "parent_owner_id": request.parent_owner_id,
            "parent_owner_name": request.parent_owner_name,
            "branch_point_message_id": request.branch_point_message_id,
            "branch_owner_id": request.branch_owner_id,
            "branch_owner_name": request.branch_owner_name,
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not create branch: {e}")

    # Notify the original thread's owner — best-effort, branch already exists either way
    if request.parent_owner_id != request.branch_owner_id:
        try:
            supabase.table("notifications").insert({
                "workspace_id": request.workspace_id,
                "to_user_id": request.parent_owner_id,
                "from_user_id": request.branch_owner_id,
                "from_user_name": request.branch_owner_name,
                "type": "branch",
                "branch_id": branch_id,
                "message": f"{request.branch_owner_name} continued your chat from where you left off.",
            }).execute()
        except Exception as e:
            print(f"notification insert notice: {e}")

    return {"status": "success", "branch_id": branch_id}

# Notifications for one user (e.g. "Nouman continued your chat")
@app.get("/api/notifications")
def get_notifications(user_id: str):
    if not supabase:
        return {"notifications": []}
    try:
        res = (
            supabase.table("notifications")
            .select("*")
            .eq("to_user_id", user_id)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        return {"notifications": res.data or []}
    except Exception as e:
        return {"notifications": [], "notice": str(e)}

@app.post("/api/notifications/read")
def mark_notification_read(request: NotificationReadRequest):
    if supabase:
        try:
            supabase.table("notifications").update({"read": True}).eq("id", request.id).execute()
        except Exception as e:
            print(f"notification read notice: {e}")
    return {"status": "success"}

# Main chat endpoint
@app.post("/api/chat")
async def send_message(request: ChatRequest):
    display_user = request.user_name if request.user_name else request.user_id
    thread_id = request.thread_id or f"member-{request.user_id}"

    # Save user message to Supabase
    if supabase:
        try:
            supabase.table("messages").insert({
                "workspace_id": request.workspace_id,
                "user_id": request.user_id,
                "user_name": display_user,
                "content": request.message,
                "role": "user",
                "thread_id": thread_id,
                "reply_to_id": request.reply_to_id,
                "reply_to_user_name": request.reply_to_user_name,
                "reply_to_content": request.reply_to_content,
            }).execute()
        except Exception as e:
            print(f"Supabase user msg notice: {e}")

    # Run AI agent with multi-tasking capabilities
    try:
        result = await agent.ainvoke({
            "messages": [{"role": "user", "content": request.message}]
        })
        msgs = result.get("messages", [])
        ai_text = msgs[-1].content if msgs else "Task completed."
    except Exception as e:
        print(f"Agent error: {e}")
        ai_text = f"⚠️ Agent error: {str(e)}"

    # Save AI reply to Supabase
    if supabase:
        try:
            supabase.table("messages").insert({
                "workspace_id": request.workspace_id,
                "user_id": "ai-agent",
                "user_name": "NexaAI",
                "content": ai_text,
                "role": "ai",
                "thread_id": thread_id,
            }).execute()
        except Exception as e:
            print(f"Supabase AI msg notice: {e}")

    return {"status": "success", "reply": ai_text}


# ---- Run Server ----
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)