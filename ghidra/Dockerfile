FROM blacktop/ghidra:latest

USER root

# Install dependencies for FastAPI and headless execution
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-numpy \
    supervisor \
    xvfb \
    x11vnc \
    openbox \
    net-tools \
    novnc \
    websockify \
    git \
    && rm -rf /var/lib/apt/lists/*

# Remove PyGhidra extension to force .py scripts to use native Jython
RUN rm -rf /ghidra/Ghidra/Features/PyGhidra

# Fix novnc link
RUN mkdir -p /usr/share/novnc && ln -sf /usr/share/novnc/vnc_lite.html /usr/share/novnc/index.html

# Set working directory
WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages --ignore-installed -r requirements.txt

# Copy Ghidra scripts from reAIghidra (we'll sync these next)
COPY scripts/ /app/scripts/

# Copy the backend API
COPY main.py /app/main.py

# Setup Supervisor to run Xvfb + VNC + Ghidra API
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Environment variables
ENV DISPLAY=:0
ENV GHIDRA_PROJECTS_DIR=/data/projects
ENV GHIDRA_BINARIES_DIR=/data/binaries

# Create directories
RUN mkdir -p /data/projects /data/binaries /app/scripts

EXPOSE 8000 5900 6080

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
