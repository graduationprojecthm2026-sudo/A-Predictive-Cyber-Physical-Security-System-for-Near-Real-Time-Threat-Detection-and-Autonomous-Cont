FROM python:3.11-slim

# Install system dependencies for Pi 5 hardware
# We use libgpiod-dev and gpiod to ensure compatibility with Trixie/Pi 5
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libssl-dev \
    curl \
    gpiod \
    libgpiod-dev \
    spi-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements-pi.txt .
RUN pip install --no-cache-dir -r requirements-pi.txt

# Copy project source
COPY . .

# Environment defaults
ENV KAFKA_BROKER=192.168.60.10:9092
ENV DOOR_ID=door_acad_f1_d1

CMD ["python", "door_process.py"]
