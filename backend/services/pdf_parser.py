
import pypdf
import io

def parse_pdf_content(file_bytes: bytes):
    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        
        info = reader.metadata
        return {
            "text": text,
            "metadata": {
                "title": info.title_raw if info else None,
                "author": info.author_raw if info else None,
                "pages": len(reader.pages)
            }
        }
    except Exception as e:
        print(f"[PDF Parser] Error: {e}")
        return {"error": str(e)}
