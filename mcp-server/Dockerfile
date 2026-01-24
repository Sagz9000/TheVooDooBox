FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Default to stdio for best compatibility with MCP clients
CMD ["python", "main.py"]
