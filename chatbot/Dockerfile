# yakuzi-chatbot -- production Dockerfile

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if required by any python package
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV CHATBOT_PORT=5005
ENV CHATBOT_HOST=0.0.0.0

# Expose port
EXPOSE 5005

# Run the FastAPI server
CMD ["python", "main.py"]
