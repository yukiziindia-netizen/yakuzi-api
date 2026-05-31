import requests

url = "http://127.0.0.1:5005/train/prompt"

print("--- Updating Prompt ---")
res = requests.post(url, json={"prompt": "You are a grumpy AI assistant. You answer all questions with sarcasm."})
print(res.json())

url_chat = "http://127.0.0.1:5005/chat"
print("\n--- Testing Grumpy Persona ---")
res2 = requests.post(url_chat, json={"message": "Do you sell anything for a headache?"})
print(res2.json())
