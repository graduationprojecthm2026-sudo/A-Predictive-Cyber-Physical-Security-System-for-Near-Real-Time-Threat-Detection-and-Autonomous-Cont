###############################################################################
# Dockerfile.pac — PAC Pi Agent Container
# ARM64 (Raspberry Pi 5) — Physical Access Control Node
# Build context: /home/pi/mass-pi/
###############################################################################

FROM python:3.11-slim

# System deps — lgpio needs libgpiod, mfrc522 needs SPI access
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        libc6-dev \
        python3-dev \
        libssl-dev \
        curl \
        netcat-traditional \
        libgpiod3 \
        i2c-tools \
        spi-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements-pi.txt .
RUN pip install --no-cache-dir -r requirements-pi.txt

# Copy project source
COPY . .

# Non-root user
#RUN useradd -r -u 1001 -g root massagent \
 #   && chown -R massagent:root /app

# GPIO and SPI access — add user to gpio/spi groups
# Note: on Pi these groups must exist on the HOST, not just in container
USER root

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:${HEALTH_PORT:-8002}/health || exit 1

CMD ["python", "door_process.py"]
