import sys
import json
import joblib
import os

MODEL_PATH = os.environ.get("TRANSFERENCE_MODEL_PATH")

def main():
    if not MODEL_PATH or not os.path.exists(MODEL_PATH):
        print(json.dumps({"error": "Model file not found"}))
        sys.exit(1)
        
    try:
        model = joblib.load(MODEL_PATH)
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print(json.dumps({"error": "Empty input"}))
            sys.exit(1)
            
        data = json.loads(raw_input)
        input_text = json.dumps(data) if isinstance(data, dict) else str(data)
        
        prediction = model.predict([input_text])[0]
        
        # Check if predict_proba is available for confidence score
        confidence = 1.0
        if hasattr(model, "predict_proba"):
            probs = model.predict_proba([input_text])[0]
            confidence = float(max(probs))
            
        print(json.dumps({
            "result": prediction,
            "confidence": confidence
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
