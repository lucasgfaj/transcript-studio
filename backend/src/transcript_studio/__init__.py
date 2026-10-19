def main() -> None:
    """`uv run transcript-studio`: serves the API and the built frontend on http://localhost:8000."""
    import uvicorn

    uvicorn.run("transcript_studio.main:app", host="127.0.0.1", port=8000)
