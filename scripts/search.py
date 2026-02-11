#!/usr/bin/env python3
"""Web search helper using DuckDuckGo. Called by the Next.js API route."""

import json
import sys

from ddgs import DDGS


def search(query: str, max_results: int = 6) -> list[dict]:
    try:
        results = DDGS().text(query, max_results=max_results)
        return [
            {
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "snippet": r.get("body", ""),
            }
            for r in results
        ]
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No query provided"}))
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    results = search(query)
    print(json.dumps(results))
