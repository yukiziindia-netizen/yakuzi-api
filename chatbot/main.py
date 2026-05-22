import os
import sys
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uvicorn

# Try importing google.genai
try:
    from google import genai
    from google.genai import types
    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False

app = FastAPI(title="PharmaBag AI Chatbot Sidecar")

class ChatMessage(BaseModel):
    role: str # 'user', 'model', 'assistant', etc.
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "has_gemini_sdk": HAS_GEMINI,
        "has_api_key": bool(os.environ.get("GEMINI_API_KEY"))
    }

@app.post("/chat")
async def chat(request: ChatRequest):
    api_key = os.environ.get("GEMINI_API_KEY")
    
    # If Gemini SDK is not installed or API key is not configured, fallback to mock response
    if not HAS_GEMINI or not api_key or api_key.strip() == "":
        return {
            "response": f"[MOCK MODE] Hello! This is a simulated response because GEMINI_API_KEY is not configured or the SDK is missing. You said: '{request.message}'"
        }
        
    try:
        client = genai.Client(api_key=api_key)
        
        # Format history for Gemini SDK
        gemini_history = []
        if request.history:
            for msg in request.history:
                role = "model" if msg.role in ["model", "assistant"] else "user"
                gemini_history.append(
                    types.Content(
                        role=role,
                        parts=[types.Part.from_text(text=msg.content)]
                    )
                )
        
        # Start chat session
        chat_session = client.chats.create(model='gemini-1.5-flash', history=gemini_history)
        
        # Send message
        response = chat_session.send_message(request.message)
        
        return {
            "response": response.text
        }
    except Exception as e:
        print(f"Error calling Gemini API: {str(e)}", sys.stderr)
        # Fail gracefully by returning a readable error message in mock format
        return {
            "response": f"I encountered an error processing your request: {str(e)}"
        }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5005))
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False)
