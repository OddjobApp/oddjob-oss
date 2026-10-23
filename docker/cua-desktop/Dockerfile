# Oddjob's computer-use desktop: the Cua XFCE desktop plus a Chromium that Oddjob can
# attach to over the DevTools protocol (CDP), which is what lets it record a person's
# actions during a takeover and replay them as a skill.
#
#   docker build -t oddjob/cua-desktop:latest docker/cua-desktop
#
# org-desktop.service.ts builds this automatically the first time it is missing.
FROM trycua/cua-xfce@sha256:e188a008084e1034f5ff003e7983c58596d9c0e47adf5c34078b362aad2a57e7

USER root
ENV CUA_TELEMETRY_ENABLED=false

# Current XFCE images ship spacesd. Oddjob's installed Computer SDK uses the
# HTTP/WebSocket computer-server contract, so supply that pinned compatibility
# service in its own environment rather than relying on a removed base script.
RUN uv venv /opt/oddjob-computer --python /usr/local/bin/python \
    && uv pip install --python /opt/oddjob-computer/bin/python 'cua-computer-server[linux]==0.3.46' 'fastapi==0.115.12'
COPY start-computer-server.sh /usr/local/bin/start-computer-server.sh
COPY oddjob-computer-server.conf /etc/supervisor/conf.d/oddjob-computer-server.conf
RUN chmod 0755 /usr/local/bin/start-computer-server.sh
RUN /opt/oddjob-computer/bin/python -c 'from fastapi import FastAPI; FastAPI(websocket_max_size=1024)'

# Debian 12 ships a real chromium package (no snap).
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY oddjob-browser /usr/local/bin/oddjob-browser
COPY oddjob-desktop-init /usr/local/bin/oddjob-desktop-init
COPY oddjob-chromium.desktop /usr/share/xfce4/helpers/oddjob-chromium.desktop
COPY oddjob-chromium-app.desktop /usr/share/applications/oddjob-chromium.desktop
COPY oddjob-cdp-relay.conf /etc/supervisor/conf.d/oddjob-cdp-relay.conf
RUN chmod 0755 /usr/local/bin/oddjob-browser /usr/local/bin/oddjob-desktop-init \
    && sed -i 's/^WebBrowser=.*/WebBrowser=oddjob-chromium/' /etc/xdg/xfce4/helpers.rc \
    && update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/oddjob-browser 300 \
    && update-alternatives --set x-www-browser /usr/local/bin/oddjob-browser

# 9223: CDP relay (Chromium itself only listens on 127.0.0.1:9222 inside the container).
EXPOSE 9223
