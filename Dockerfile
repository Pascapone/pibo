FROM node:24-slim

# System-Abhängigkeiten: Python, Chromium, Xvfb, Build-Tools, Fonts
RUN apt-get update && apt-get install -y \
    python3 python3-venv python3-dev \
    build-essential curl git ca-certificates \
    chromium chromium-driver xvfb xauth x11-xserver-utils \
    fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 \
    libnss3 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 xdg-utils \
    dbus dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# uv (Python-Package-Manager) installieren
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Display-Environment für headless/headed Browser
ENV DISPLAY=:99
ENV PIBO_BROWSER_USE_CHROME=/usr/bin/chromium

WORKDIR /app

# Package-Dateien zuerst kopieren (Layer-Caching)
COPY package.json package-lock.json tsconfig.json ./
RUN npm install

# Quellcode kopieren und bauen
COPY . .
RUN npm run build

# Browser tools vorinstallieren (damit sie im Image direkt verfügbar sind)
RUN mkdir -p /root/.pibo/tools/browser-use/home/bin && \
    uv venv /root/.pibo/tools/browser-use/.venv --python 3.12 && \
    uv pip install --python /root/.pibo/tools/browser-use/.venv/bin/python \
    'browser-use[cli]==0.12.6'

RUN mkdir -p /root/.pibo/tools/agent-browser/home/bin \
    /root/.pibo/tools/agent-browser/home/profiles \
    /root/.pibo/tools/agent-browser/node && \
    npm install --prefix /root/.pibo/tools/agent-browser/node agent-browser@0.27.0

# Browser Wrapper vorbereiten (Pibo erwartet sie unter home/bin)
RUN /app/scripts/prepare-browser-use-wrapper.sh && \
    /app/scripts/prepare-agent-browser-wrapper.sh

# Persistente Verzeichnisse für Pibo
RUN mkdir -p /root/.pibo /root/.browser-use /root/.pibo/tools/agent-browser/home

EXPOSE 4788 4789 56663

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["gateway:web"]
