import os
import re
import json
import hashlib
import time
import argparse
from pathlib import Path
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import Json
from qdrant_client import QdrantClient
from qdrant_client.http import models
import google.generativeai as genai

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "knowledge_nodes")
QDRANT_VECTOR_SIZE = int(os.getenv("QDRANT_VECTOR_SIZE", "3072"))

# Configure AI
genai.configure(api_key=GOOGLE_API_KEY)

class SystemIngestion:
    def __init__(self, organization_id=1):
        self.organization_id = organization_id
        self.conn = psycopg2.connect(DATABASE_URL)
        self.qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
        self.ensure_qdrant_collection()
        self.embedding_cache = set()

    def ensure_qdrant_collection(self):
        try:
            self.qdrant.get_collection(QDRANT_COLLECTION)
        except Exception:
            self.qdrant.create_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=models.VectorParams(
                    size=QDRANT_VECTOR_SIZE,
                    distance=models.Distance.COSINE
                )
            )

    def get_embedding(self, text):
        try:
            result = genai.embed_content(
                model="models/text-embedding-004",
                content=text,
                task_type="retrieval_document"
            )
            return result['embedding']
        except Exception as e:
            print(f"[Python Ingestion] Embedding failed: {e}")
            return None

    def create_or_update_node(self, name, label, data=None):
        data = data or {}
        data['source'] = 'system_introspection'
        
        # Build text for embedding (simulating buildNodeText from Node.js)
        node_text = f"Node: {name}\nLabel: {label}\nData: {json.dumps(data)}"
        content_hash = hashlib.sha1(f"{name}:{node_text}".encode()).hexdigest()
        
        if content_hash in self.embedding_cache:
            return None

        cursor = self.conn.cursor()
        
        # Check if exists
        cursor.execute(
            "SELECT id FROM knowledge_nodes WHERE name = %s AND label = %s AND organization_id = %s",
            (name, label, self.organization_id)
        )
        existing = cursor.fetchone()

        if existing:
            node_id = existing[0]
            cursor.execute(
                "UPDATE knowledge_nodes SET data = %s, updated_at = NOW() WHERE id = %s",
                (Json(data), node_id)
            )
        else:
            cursor.execute(
                "INSERT INTO knowledge_nodes (name, label, data, organization_id, verification_status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, 'verified', NOW(), NOW()) RETURNING id",
                (name, label, Json(data), self.organization_id)
            )
            node_id = cursor.fetchone()[0]

        self.conn.commit()
        cursor.close()

        # Handle Vector Embedding
        embedding = self.get_embedding(node_text)
        if embedding:
            self.qdrant.upsert(
                collection_name=QDRANT_COLLECTION,
                points=[
                    models.PointStruct(
                        id=node_id,
                        vector=embedding,
                        payload={
                            "name": name,
                            "label": label,
                            "organizationId": self.organization_id,
                            "data": data
                        }
                    )
                ]
            )
            self.embedding_cache.add(content_hash)
            print(f"[Python Ingestion] Indexed node: {name} ({label})")
        
        return node_id

    def create_edge(self, source_name, source_label, target_name, target_label, relation):
        cursor = self.conn.cursor()
        
        # Find source
        cursor.execute(
            "SELECT id FROM knowledge_nodes WHERE name = %s AND label = %s AND organization_id = %s",
            (source_name, source_label, self.organization_id)
        )
        source = cursor.fetchone()
        
        # Find target
        cursor.execute(
            "SELECT id FROM knowledge_nodes WHERE name = %s AND label = %s AND organization_id = %s",
            (target_name, target_label, self.organization_id)
        )
        target = cursor.fetchone()

        if source and target and source[0] != target[0]:
            source_id, target_id = source[0], target[0]
            
            # Check if edge exists
            cursor.execute(
                "SELECT id FROM knowledge_edges WHERE source_id = %s AND target_id = %s AND relation = %s",
                (source_id, target_id, relation)
            )
            if not cursor.fetchone():
                cursor.execute(
                    "INSERT INTO knowledge_edges (source_id, target_id, relation, organization_id, created_at) "
                    "VALUES (%s, %s, %s, %s, NOW())",
                    (source_id, target_id, relation, self.organization_id)
                )
                self.conn.commit()
                print(f"[Python Ingestion] Linked {source_name} --({relation})--> {target_name}")

        cursor.close()

    def scan_directory(self, root_path, extension):
        files = []
        for p in Path(root_path).rglob(f"*{extension}"):
            if "node_modules" not in str(p) and ".venv" not in str(p):
                files.append(p)
        return files

    def ingest_database_schema(self):
        print("[Python Ingestion] Ingesting Database Schema...")
        # Since we are in Python, we can't easily import the Drizzle schema.
        # Instead, we'll query the Postgres information_schema.
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        tables = cursor.fetchall()
        for (table_name,) in tables:
            self.create_or_update_node(table_name, "Database Table", {"description": f"System table: {table_name}"})
            
            # Columns
            cursor.execute("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = %s
            """, (table_name,))
            columns = cursor.fetchall()
            for col_name, data_type in columns:
                self.create_or_update_node(f"{table_name}.{col_name}", "Database Column", {
                    "table": table_name,
                    "type": data_type
                })
        cursor.close()

    def ingest_frontend(self, client_path):
        print(f"[Python Ingestion] Ingesting Frontend from {client_path}...")
        client_src = Path(client_path) / "src"
        if not client_src.exists():
            return

        # Pages
        pages_dir = client_src / "pages"
        if pages_dir.exists():
            for f in self.scan_directory(pages_dir, ".tsx"):
                page_name = f.stem
                self.create_or_update_node(page_name, "Page", {"path": str(f.relative_to(client_src))})
                self.analyze_imports(f, page_name, "Page")

        # Components
        comp_dir = client_src / "components"
        if comp_dir.exists():
            for d in comp_dir.iterdir():
                if d.is_dir():
                    self.create_or_update_node(d.name, "Component Group", {"path": str(d.relative_to(client_src))})
                    for f in self.scan_directory(d, ".tsx"):
                        comp_name = f.stem
                        if comp_name == "index": continue
                        self.create_or_update_node(comp_name, "Component", {"path": str(f.relative_to(client_src))})
                        self.create_edge(d.name, "Component Group", comp_name, "Component", "CONTAINS")

    def analyze_imports(self, file_path, source_name, source_label):
        try:
            content = file_path.read_text(encoding='utf-8')
            # Look for @/components/X or @/features/X
            matches = re.findall(r"from\s+['\"]@/(components|features)/([^/\"']+)['\"]", content)
            for type_name, target in matches:
                label = "Component Group" if type_name == "components" else "Feature"
                self.create_edge(source_name, source_label, target, label, "USES")
        except Exception:
            pass

    def run_all(self):
        root = Path(__file__).parent.parent.parent
        self.ingest_database_schema()
        self.ingest_frontend(root / "client")
        print("[Python Ingestion] Completed successfully.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--org", type=int, default=1)
    args = parser.parse_args()
    
    ingestor = SystemIngestion(organization_id=args.org)
    ingestor.run_all()
