import asyncio
from utils.scraper.marketplace_scraper import MarketplaceScraper
import json
from db.models import get_connection

def main():
    try:
        conn = get_connection()
        scraper = MarketplaceScraper(conn)
        search_term = "vscode-markdown-paste-image"
        print(f"Querying for: {search_term}")
        
        # Simulating query_extensions
        resp = scraper.query_extensions(search_text=search_term, page_size=1)
        results = scraper.parse_extension_results(resp)
        print("Results:")
        print(json.dumps(results, indent=2))
        
        # Simulate fetch_extension_metadata
        print("Testing fetch_extension_metadata strict equality:")
        if results and results[0]["extension_id"].lower() == search_term.lower():
            print("MATCH FOUND!")
        else:
            if results:
                print(f"FAILED TO MATCH: '{results[0]['extension_id'].lower()}' != '{search_term.lower()}'")
            else:
                print("No results returned.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
