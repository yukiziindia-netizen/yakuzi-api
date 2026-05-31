import requests

url = "http://127.0.0.1:5005/chat"

print("--- Testing E-commerce Question ---")
res1 = requests.post(url, json={"message": "Do you sell anything for a headache?"})
print(res1.json())

print("\n--- Testing Unrelated Question ---")
res2 = requests.post(url, json={"message": "Can you give me a recipe for pancakes?"})
print(res2.json())
