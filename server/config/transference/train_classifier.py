import sys
import json
import pandas as pd
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

def train(csv_path, output_model_path):
    df = pd.read_csv(csv_path)
    if df.empty or 'input_text' not in df.columns or 'target_output' not in df.columns:
        print(json.dumps({"success": False, "error": "Invalid CSV format or empty data"}))
        sys.exit(1)

    model = Pipeline([
        ('tfidf', TfidfVectorizer(max_features=5000, ngram_range=(1, 2))),
        ('clf', LogisticRegression(max_iter=1000))
    ])

    model.fit(df['input_text'].astype(str), df['target_output'].astype(str))
    
    joblib.dump(model, output_model_path)
    
    classes = list(model.classes_)
    print(json.dumps({"success": True, "classes": classes, "samples": len(df)}))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: train_classifier.py <csv_path> <output_model_path>"}))
        sys.exit(1)
        
    train(sys.argv[1], sys.argv[2])
