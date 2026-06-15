import os
import sys
import asyncio
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import base64
import json
import uvicorn
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

try:
    from google import genai
    from google.genai import types
    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

app = FastAPI(title="Yukizi AI Chatbot Sidecar")

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    print(f"Validation Error: {exc}", file=sys.stderr)
    print(f"Body: {await request.body()}", file=sys.stderr)
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

# ==========================================
# STATE MANAGEMENT (Prompt & Active Model)
# ==========================================
PROMPT_FILE = "system_prompt.txt"
MODEL_FILE = "current_model.txt"

DEFAULT_PROMPT = """You are the official AI Customer Support Agent for Yukizi, a premier e-commerce platform.
Your role is to assist customers with their shopping experience, answer questions about products, and help with order inquiries.
You must be professional, concise, and helpful. Do not answer questions that are completely unrelated to e-commerce, shopping, or Yukizi.
"""

def load_text_file(filename: str, default_val: str) -> str:
    if os.path.exists(filename):
        with open(filename, 'r', encoding='utf-8') as f:
            return f.read().strip()
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(default_val)
    return default_val

# Initialize state
ACTIVE_SYSTEM_INSTRUCTION = load_text_file(PROMPT_FILE, DEFAULT_PROMPT)
ACTIVE_MODEL = load_text_file(MODEL_FILE, "gemini-2.5-flash")

# ==========================================
# MODELS
# ==========================================
class Attachment(BaseModel):
    name: str
    data: str
    type: str

class ChatMessage(BaseModel):
    role: str
    content: Optional[str] = ""
    attachments: Optional[List[Attachment]] = []

class ChatRequest(BaseModel):
    message: Optional[str] = ""
    history: Optional[List[ChatMessage]] = []
    attachments: Optional[List[Attachment]] = []

class PromptRequest(BaseModel):
    prompt: str

class ConversationTrainRequest(BaseModel):
    history: List[ChatMessage]
    custom_name: Optional[str] = "yukizi-custom-bot"

# ==========================================
# DATABASE TOOLS (Level 2)
# ==========================================
def get_db_connection():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url or not HAS_PSYCOPG2:
        return None
    try:
        return psycopg2.connect(db_url)
    except Exception as e:
        print(f"Database connection error: {e}", sys.stderr)
        return None

def search_products(query: str) -> str:
    """Searches the database for products matching the query."""
    conn = get_db_connection()
    if not conn: return "Error: Could not connect to database."
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT name, manufacturer, mrp, \"isActive\" FROM products WHERE name ILIKE %s OR manufacturer ILIKE %s LIMIT 5",
                (f"%{query}%", f"%{query}%")
            )
            rows = cur.fetchall()
            return str(rows) if rows else f"No products found matching '{query}'."
    except Exception as e:
        return f"Error executing query: {str(e)}"
    finally:
        conn.close()

def get_order_status(order_id: str) -> str:
    """Gets the status of an order given its ID."""
    conn = get_db_connection()
    if not conn: return "Error: Could not connect to database."
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id, \"orderStatus\", \"paymentStatus\", \"totalAmount\" FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
            return str(row) if row else f"Order '{order_id}' not found."
    except Exception as e:
        return f"Error executing query: {str(e)}"
    finally:
        conn.close()

# ==========================================
# BACKGROUND TUNING MONITOR
# ==========================================
async def monitor_tuning_job(job_id: str, client: Any):
    """Polls Gemini tuning job and auto-switches model upon completion."""
    global ACTIVE_MODEL
    print(f"Started monitoring tuning job: {job_id}")
    while True:
        try:
            # Note: Depending on the SDK version, the exact method to get operation might vary.
            # Using client.tuned_models.get(...) assuming job_id is the model name.
            model_info = client.tuned_models.get(model=job_id)
            state = getattr(model_info, 'state', str(model_info))
            print(f"Tuning Job {job_id} status: {state}")
            
            if state == 'ACTIVE' or state == 'SUCCEEDED':
                ACTIVE_MODEL = job_id
                with open(MODEL_FILE, 'w', encoding='utf-8') as f:
                    f.write(job_id)
                print(f"Model {job_id} successfully trained! Auto-switched ACTIVE_MODEL to {job_id}.")
                break
            elif state in ['FAILED', 'CANCELLED']:
                print(f"Model tuning failed or cancelled. Sticking to {ACTIVE_MODEL}.")
                break
            
            await asyncio.sleep(60) # Poll every 60 seconds
        except Exception as e:
            print(f"Error checking tuning status for {job_id}: {e}")
            await asyncio.sleep(60)

# ==========================================
# ENDPOINTS
# ==========================================
@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "has_gemini_sdk": HAS_GEMINI,
        "has_api_key": bool(os.environ.get("GEMINI_API_KEY")),
        "active_model": ACTIVE_MODEL
    }

@app.post("/train/prompt")
def update_prompt(req: PromptRequest):
    global ACTIVE_SYSTEM_INSTRUCTION
    ACTIVE_SYSTEM_INSTRUCTION = req.prompt
    with open(PROMPT_FILE, 'w', encoding='utf-8') as f:
        f.write(req.prompt)
    return {"message": "System prompt updated successfully.", "active_prompt": ACTIVE_SYSTEM_INSTRUCTION}

@app.post("/train/dataset")
async def upload_dataset(background_tasks: BackgroundTasks, file: UploadFile = File(...), custom_name: str = Form("yukizi-custom-bot")):
    global ACTIVE_SYSTEM_INSTRUCTION
    
    # Save the uploaded jsonl
    temp_file = f"temp_{file.filename}"
    with open(temp_file, "wb") as f:
        f.write(await file.read())
        
    try:
        dataset_text = "\n[NEW BATCH OF LEARNED EXAMPLES]\n"
        with open(temp_file, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip(): continue
                try:
                    data = json.loads(line)
                    user_text = data.get("text_input", "")
                    model_text = data.get("output", "")
                    if user_text and model_text:
                        dataset_text += f"User: {user_text}\nAssistant: {model_text}\n\n"
                except Exception:
                    pass
        
        ACTIVE_SYSTEM_INSTRUCTION += dataset_text
        with open(PROMPT_FILE, 'w', encoding='utf-8') as f:
            f.write(ACTIVE_SYSTEM_INSTRUCTION)
            
        return {
            "message": "Dataset successfully learned and appended to System Instructions.",
            "job_id": "CONTEXT_INJECTION_" + custom_name,
            "status": "SUCCEEDED"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process dataset: {str(e)}")
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)

@app.get("/train/status/{job_id}")
def check_tuning_status(job_id: str):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not HAS_GEMINI or not api_key:
        raise HTTPException(status_code=500, detail="Gemini SDK/API Key not configured.")
    try:
        client = genai.Client(api_key=api_key)
        model_info = client.tuned_models.get(model=job_id)
        state = getattr(model_info, 'state', 'UNKNOWN')
        return {
            "job_id": job_id,
            "status": state,
            "is_active_model": (ACTIVE_MODEL == job_id)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch status: {str(e)}")

@app.post("/train/conversation")
async def train_conversation(background_tasks: BackgroundTasks, req: ConversationTrainRequest):
    global ACTIVE_SYSTEM_INSTRUCTION
    
    if len(req.history) < 2:
        raise HTTPException(status_code=400, detail="Not enough conversation history to train on.")

    try:
        conversation_text = "\n[NEW LEARNED EXAMPLE]\n"
        for i in range(len(req.history) - 1):
            if req.history[i].role == "user" and req.history[i+1].role in ["assistant", "model"]:
                user_text = req.history[i].content or ""
                model_text = req.history[i+1].content or ""
                if user_text and model_text:
                    conversation_text += f"User: {user_text}\nAssistant: {model_text}\n\n"
        
        if conversation_text == "\n[NEW LEARNED EXAMPLE]\n":
             raise HTTPException(status_code=400, detail="No valid user-assistant exchanges found to train on.")
             
        ACTIVE_SYSTEM_INSTRUCTION += conversation_text
        with open(PROMPT_FILE, 'w', encoding='utf-8') as f:
            f.write(ACTIVE_SYSTEM_INSTRUCTION)

        return {
            "message": "Conversation successfully learned and appended to System Instructions.",
            "job_id": "CONTEXT_INJECTION_" + (req.custom_name or "bot"),
            "status": "SUCCEEDED"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process conversation: {str(e)}")

@app.post("/chat")
async def chat(request: ChatRequest):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not HAS_GEMINI or not api_key or api_key.strip() == "":
        return {"response": f"[MOCK MODE] (Model: {ACTIVE_MODEL}) SDK/API key missing. You said: '{request.message}'"}
        
    try:
        client = genai.Client(api_key=api_key)
        gemini_history = []
        if request.history:
            for msg in request.history:
                role = "model" if msg.role in ["model", "assistant"] else "user"
                parts = []
                if msg.content:
                    parts.append(types.Part.from_text(text=msg.content))
                if msg.attachments:
                    for att in msg.attachments:
                        if att.data.startswith('data:'):
                            mime_type = att.data.split(';')[0].split(':')[1]
                            b64_data = att.data.split(',')[1]
                            parts.append(types.Part.from_bytes(data=base64.b64decode(b64_data), mime_type=mime_type))
                if not parts:
                    parts.append(types.Part.from_text(text="[Attachment only]"))
                gemini_history.append(types.Content(role=role, parts=parts))
        
        chat_session = client.chats.create(
            model=ACTIVE_MODEL,
            config=types.GenerateContentConfig(
                system_instruction=ACTIVE_SYSTEM_INSTRUCTION,
                tools=[search_products, get_order_status]
            ),
            history=gemini_history
        )
        
        current_parts = []
        if request.message:
            current_parts.append(request.message)
        if request.attachments:
            for att in request.attachments:
                if att.data.startswith('data:'):
                    mime_type = att.data.split(';')[0].split(':')[1]
                    b64_data = att.data.split(',')[1]
                    current_parts.append(types.Part.from_bytes(data=base64.b64decode(b64_data), mime_type=mime_type))
        
        if not current_parts:
            current_parts = ["Hello"]

        response = chat_session.send_message(current_parts)
        return {"response": response.text}
    except Exception as e:
        print(f"Error calling Gemini API: {str(e)}", sys.stderr)
        return {"response": f"I encountered an error processing your request: {str(e)}"}

if __name__ == "__main__":
    port = int(os.environ.get("CHATBOT_PORT", 5005))
    host = os.environ.get("CHATBOT_HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=False)
