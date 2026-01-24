
import requests
import json
import time

BASE_URL = "http://localhost:8080"

def test_chat_context():
    print(f"Testing Chat Context awareness on {BASE_URL}...")
    
    # 1. First, check if there are tasks (optional, but good to know)
    try:
        tasks_resp = requests.get(f"{BASE_URL}/tasks")
        if tasks_resp.status_code == 200:
            tasks = tasks_resp.json()
            print(f"Found {len(tasks)} existing tasks.")
        else:
            print("Failed to fetch tasks.")
    except Exception as e:
        print(f"Error checking tasks: {e}")

    # 2. Send a chat message asking about recent files
    payload = {
        "message": "What files have been analyzed recently?",
        "history": []
    }
    
    print("\nSending Chat Request:")
    print(json.dumps(payload, indent=2))
    
    try:
        # Note: This might fail if Ollama is not running, but we are testing the backend code path's ability to construct the prompt.
        # If the backend crashes, we know the SQLx injection failed.
        # If it returns "AI Service Unavailable", it means it tried to call Ollama (success for our code changes).
        resp = requests.post(f"{BASE_URL}/vms/ai/chat", json=payload)
        
        print(f"\nResponse Status: {resp.status_code}")
        try:
            print("Response Body:", resp.json())
        except:
            print("Response Text:", resp.text)
            
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    test_chat_context()
