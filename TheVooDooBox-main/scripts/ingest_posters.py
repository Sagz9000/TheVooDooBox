
import os
import pypdf
import chromadb
from chromadb.config import Settings
import requests

def ingest_pdfs():
    # Get the directory where the script is located
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # The posters should be at the project root level
    posters_dir = os.path.join(os.path.dirname(current_dir), "sans_posters")
    chroma_url = "http://localhost:8002"
    collection_name = "malware_knowledge"

    print(f"Connecting to ChromaDB at {chroma_url}...")
    client = chromadb.HttpClient(host="localhost", port=8002)

    try:
        collection = client.get_or_create_collection(name=collection_name)
        print(f"Using collection: {collection_name}")
    except Exception as e:
        print(f"Error getting/creating collection: {e}")
        return

    if not os.path.exists(posters_dir):
        print(f"Error: Directory '{posters_dir}' not found.")
        print("Please create the 'sans_posters' directory at the project root and place your PDFs there.")
        return

    pdf_files = [f for f in os.listdir(posters_dir) if f.lower().endswith('.pdf')]
    if not pdf_files:
        print(f"No PDF files found in {posters_dir}")
        print("Please place your SANS Posters (PDFs) in the 'sans_posters' directory.")
        return
        
    print(f"Found {len(pdf_files)} PDF files.")

    for i, filename in enumerate(pdf_files):
        file_path = os.path.join(posters_dir, filename)
        print(f"[{i+1}/{len(pdf_files)}] Processing {filename}...")
        
        try:
            reader = pypdf.PdfReader(file_path)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            
            if not text.strip():
                print(f"  Warning: No text extracted from {filename}")
                continue

            # Split text into chunks to avoid token limits and improve retrieval
            # Simple chunking for now
            chunks = [text[i:i+2000] for i in range(0, len(text), 2000)]
            
            ids = [f"{filename}_{j}" for j in range(len(chunks))]
            metadatas = [{"source": filename, "type": "SANS Poster"} for _ in range(len(chunks))]
            
            collection.add(
                documents=chunks,
                metadatas=metadatas,
                ids=ids
            )
            print(f"  Added {len(chunks)} chunks.")
            
        except Exception as e:
            print(f"  Error processing {filename}: {e}")

    print("Ingestion complete.")

if __name__ == "__main__":
    ingest_pdfs()
