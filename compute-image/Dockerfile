FROM node:24-slim

RUN apt-get update && apt-get install -y \
    python3 python3-venv python3-dev \
    build-essential curl git ca-certificates \
    chromium chromium-driver xvfb xauth x11-xserver-utils \
    fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 \
    libnss3 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 xdg-utils \
    dbus dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"
ENV DISPLAY=:99
ENV PIBO_BROWSER_USE_CHROME=/usr/bin/chromium

# Repack the installed package without lifecycle scripts, then install that exact
# artifact so its published shrinkwrap controls the production dependency tree.
WORKDIR /opt/pibo-package
COPY . .
RUN mkdir -p /tmp/pibo-package && \
    npm pack --ignore-scripts --pack-destination /tmp/pibo-package >/dev/null

WORKDIR /app
RUN npm init -y >/dev/null && \
    npm install --omit=dev --no-audit --no-fund /tmp/pibo-package/*.tgz && \
    rm -rf /opt/pibo-package /tmp/pibo-package

RUN mkdir -p /root/.pibo/tools/browser-use/home/bin && \
    uv venv /root/.pibo/tools/browser-use/.venv --python 3.12 && \
    uv pip install --python /root/.pibo/tools/browser-use/.venv/bin/python \
    'browser-use[cli]==0.12.6'

RUN mkdir -p /root/.pibo/tools/agent-browser/home/bin \
    /root/.pibo/tools/agent-browser/home/profiles \
    /root/.pibo/tools/agent-browser/node && \
    npm install --prefix /root/.pibo/tools/agent-browser/node agent-browser@0.27.0

WORKDIR /app/node_modules/@pasko70/pibo
RUN sed -i 's/\r$//' scripts/*.sh && \
    chmod +x scripts/*.sh && \
    scripts/prepare-browser-use-wrapper.sh && \
    scripts/prepare-agent-browser-wrapper.sh && \
    mkdir -p /root/.pibo /root/.browser-use /root/.pibo/tools/agent-browser/home

EXPOSE 4788 4789 56663

ENTRYPOINT ["/app/node_modules/@pasko70/pibo/scripts/docker-entrypoint.sh"]
CMD ["gateway:web"]
